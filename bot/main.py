import asyncio
import contextlib
import html
import json
import logging
import signal
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from aiogram import Bot, Dispatcher, F, types
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError
from aiogram.filters import Command
from aiogram.types import BotCommand, BufferedInputFile, InlineKeyboardButton, InlineKeyboardMarkup

from config import (
    API_BASE_URL,
    BOT_TOKEN,
    INTERNAL_API_TOKEN,
    OWNER_TELEGRAM_ID,
    REVIEW_BATCH_LIMIT,
    REVIEW_CHAT_LINK_TTL_SECONDS,
    REVIEW_FALLBACK_SECONDS,
    REVIEW_LISTENER_RETRY_SECONDS,
    REVIEW_NOTIFY_CHANNEL,
    SITE_URL,
)
from database import Database
from utils import format_rights, parse_duration

# Configure logging
logging.basicConfig(level=logging.INFO, stream=sys.stdout)
logger = logging.getLogger(__name__)

# Initialize bot and dispatcher
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# Database
from config import DATABASE_URL

db = Database(DATABASE_URL)

REVIEW_HEALTH = {
    "listener_connected": False,
    "listener_channel": REVIEW_NOTIFY_CHANNEL,
    "listener_connected_at": "",
    "last_listener_error_at": "",
    "last_listener_error": "",
    "last_notify_at": "",
    "last_notify_payload": "",
    "last_dispatch_started_at": "",
    "last_dispatch_finished_at": "",
    "last_dispatch_deposit_sent": 0,
    "last_dispatch_kyc_sent": 0,
    "last_dispatch_error": "",
}

BOT_STOP_EVENT: asyncio.Event | None = None
SHUTDOWN_IN_PROGRESS = False
LAST_DEPOSIT_REVIEW_ACCESS: dict[int, bool] = {}
LAST_DEPOSIT_REVIEW_CHAT_ID = 0
ACCESS_SYNC_NOTIFY_PREFIX = "access_sync:"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def update_review_health(**kwargs):
    REVIEW_HEALTH.update(kwargs)


def safe_decimal_2(value) -> str:
    try:
        return f"{float(value):.2f}"
    except Exception:
        return "0.00"


def request_lag_seconds(created_at):
    if not created_at:
        return None
    ts = created_at
    if getattr(ts, "tzinfo", None) is None:
        ts = ts.replace(tzinfo=timezone.utc)
    lag = (datetime.now(timezone.utc) - ts).total_seconds()
    if lag < 0:
        return 0.0
    return lag


def local_ticket_seed_number(seed: str) -> int:
    h = 0
    for ch in seed:
        h = (h * 33 + ord(ch)) % 9000000
    if h < 1000000:
        h += 1000000
    return h


def normalize_local_ticket_number(value: int, seed: str) -> str:
    v = int(value or 0)
    if v < 0:
        v = -v
    if v <= 0:
        v = local_ticket_seed_number(seed)
    v = v % 10000000
    if v <= 0:
        v = local_ticket_seed_number(seed) % 10000000
    if v < 1000000:
        v += 1000000
    return f"{v:07d}"


def local_ticket_seed_letters(seed: str) -> str:
    h = 0
    for ch in seed:
        h = (h * 131 + ord(ch)) % (26 * 26)
    first = chr(ord("a") + ((h // 26) % 26))
    second = chr(ord("a") + (h % 26))
    return f"{first}{second}"


def format_deposit_ticket(ticket_no: int, request_id: str) -> str:
    digits = normalize_local_ticket_number(ticket_no, request_id)
    letters = local_ticket_seed_letters(f"real_deposit:{ticket_no}:{request_id}")
    return f"BXdep{digits}{letters}"


def format_kyc_ticket(ticket_no: int, request_id: str) -> str:
    digits = normalize_local_ticket_number(ticket_no, request_id)
    letters = local_ticket_seed_letters(f"kyc:{ticket_no}:{request_id}")
    return f"BXkyc{digits}{letters}"


def parse_chat_id(raw: str):
    try:
        value = int(str(raw).strip())
    except Exception:
        return None
    return value if value != 0 else None


async def get_deposit_review_chat_id():
    deposit_chat_raw, _ = await db.get_review_chats()
    return parse_chat_id(deposit_chat_raw)


async def kick_deposit_review_chat_member(chat_id: int, telegram_id: int, reason: str):
    if chat_id <= 0 or telegram_id <= 0:
        return
    try:
        until = datetime.now(timezone.utc) + timedelta(seconds=45)
        await bot.ban_chat_member(chat_id=chat_id, user_id=telegram_id, until_date=until, revoke_messages=False)
        await bot.unban_chat_member(chat_id=chat_id, user_id=telegram_id, only_if_banned=True)
        logger.info("Review chat member removed user=%s reason=%s", telegram_id, reason)
    except TelegramBadRequest as err:
        text = str(err).lower()
        if "participant" in text or "not enough rights" in text or "user not found" in text:
            logger.info("Skip review chat kick user=%s: %s", telegram_id, err)
            return
        logger.exception("Failed to revoke review chat access user=%s", telegram_id)
    except Exception:
        logger.exception("Failed to revoke review chat access user=%s", telegram_id)


async def clear_deposit_review_chat_blacklist(chat_id: int, telegram_id: int, reason: str):
    if chat_id <= 0 or telegram_id <= 0:
        return
    try:
        await bot.unban_chat_member(chat_id=chat_id, user_id=telegram_id, only_if_banned=True)
        logger.info("Review chat blacklist cleared user=%s reason=%s", telegram_id, reason)
    except TelegramBadRequest as err:
        text = str(err).lower()
        if "participant" in text or "not enough rights" in text or "user not found" in text:
            logger.info("Skip review chat unban user=%s: %s", telegram_id, err)
            return
        logger.exception("Failed to clear review chat blacklist user=%s", telegram_id)
    except Exception:
        logger.exception("Failed to clear review chat blacklist user=%s", telegram_id)


async def sync_deposit_review_chat_access_once():
    global LAST_DEPOSIT_REVIEW_ACCESS, LAST_DEPOSIT_REVIEW_CHAT_ID
    chat_id = await get_deposit_review_chat_id()
    if not chat_id:
        LAST_DEPOSIT_REVIEW_ACCESS = {}
        LAST_DEPOSIT_REVIEW_CHAT_ID = 0
        return

    rows = await db.list_panel_admin_deposit_review_rights()
    current: dict[int, bool] = {}
    for row in rows:
        telegram_id = int(row.get("telegram_id") or 0)
        if telegram_id <= 0 or telegram_id == OWNER_TELEGRAM_ID:
            continue
        current[telegram_id] = bool(row.get("deposit_review"))

    force_full_scan = chat_id != LAST_DEPOSIT_REVIEW_CHAT_ID
    revoke_ids: set[int] = set()
    restore_ids: set[int] = set()
    if force_full_scan:
        revoke_ids.update(uid for uid, allowed in current.items() if not allowed)
        restore_ids.update(uid for uid, allowed in current.items() if allowed)
    else:
        for uid, allowed in current.items():
            prev_allowed = LAST_DEPOSIT_REVIEW_ACCESS.get(uid)
            if not allowed and (prev_allowed is None or prev_allowed):
                revoke_ids.add(uid)
            if allowed and (prev_allowed is None or not prev_allowed):
                restore_ids.add(uid)

    removed_from_admins = set(LAST_DEPOSIT_REVIEW_ACCESS.keys()) - set(current.keys())
    revoke_ids.update(removed_from_admins)

    for telegram_id in sorted(revoke_ids):
        await kick_deposit_review_chat_member(chat_id, telegram_id, "deposit_review_revoked")
    for telegram_id in sorted(restore_ids):
        await clear_deposit_review_chat_blacklist(chat_id, telegram_id, "deposit_review_restored")

    LAST_DEPOSIT_REVIEW_ACCESS = current
    LAST_DEPOSIT_REVIEW_CHAT_ID = chat_id


def humanize_seconds(total_seconds: int) -> str:
    seconds = max(0, int(total_seconds))
    if seconds >= 86400:
        days = seconds // 86400
        hours = (seconds % 86400) // 3600
        if hours > 0:
            return f"{days}d {hours}h"
        return f"{days}d"
    if seconds >= 3600:
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        if minutes > 0:
            return f"{hours}h {minutes}m"
        return f"{hours}h"
    if seconds >= 60:
        minutes = seconds // 60
        rem = seconds % 60
        if rem > 0:
            return f"{minutes}m {rem}s"
        return f"{minutes}m"
    return f"{seconds}s"


def panel_action_callback(action: str, token_type: str, telegram_id: int, duration_seconds: int) -> str:
    action_short = "rg" if action == "regen" else "dl"
    kind_short = "o" if token_type == "owner" else "a"
    safe_duration = max(60, int(duration_seconds or 3600))
    return f"pt:{action_short}:{kind_short}:{int(telegram_id)}:{safe_duration}"


def parse_panel_action_callback(raw: str):
    parts = str(raw or "").strip().split(":")
    if len(parts) != 5 or parts[0] != "pt":
        return None
    action_short = parts[1].strip().lower()
    kind_short = parts[2].strip().lower()
    try:
        telegram_id = int(parts[3])
        duration_seconds = int(parts[4])
    except Exception:
        return None
    if action_short not in ("rg", "dl"):
        return None
    if kind_short not in ("o", "a"):
        return None
    token_type = "owner" if kind_short == "o" else "admin"
    action = "regen" if action_short == "rg" else "delete"
    return action, token_type, telegram_id, max(60, duration_seconds)


def build_panel_keyboard(
    link: str,
    token_type: str,
    telegram_id: int,
    duration_seconds: int,
    is_local: bool,
    show_management_buttons: bool,
):
    rows: list[list[InlineKeyboardButton]] = []
    if not is_local:
        rows.append([
            InlineKeyboardButton(text="🚀 КЛИКНИ ДЛЯ БЫСТРОГО ВХОДА", url=link, style="primary")
        ])
    if show_management_buttons:
        rows.append([
            InlineKeyboardButton(
                text="🔁 Удалить и создать новый",
                callback_data=panel_action_callback("regen", token_type, telegram_id, duration_seconds),
                style="success",
            )
        ])
        rows.append([
            InlineKeyboardButton(
                text="🗑 Удалить текущий",
                callback_data=panel_action_callback("delete", token_type, telegram_id, duration_seconds),
                style="danger",
            )
        ])
    if not rows:
        return None
    return InlineKeyboardMarkup(inline_keyboard=rows)


def format_deposit_review_caption(req: dict, ticket: str) -> str:
    voucher = str(req.get("voucher_kind") or "none").strip().lower() or "none"
    account_name = str(req.get("account_name") or "").strip() or str(req.get("trading_account_id") or "")
    account_mode = str(req.get("account_mode") or "").strip() or "real"
    plan_id = str(req.get("plan_id") or "").strip() or "standard"
    review_due_at = req.get("review_due_at")
    due_text = review_due_at.isoformat(sep=" ", timespec="seconds") if review_due_at else "N/A"
    return (
        "<b>Real Deposit Review</b>\n"
        f"Ticket: <code>{html.escape(ticket)}</code>\n"
        f"User: <code>{html.escape(str(req.get('user_id') or ''))}</code>\n"
        f"Email: <code>{html.escape(str(req.get('user_email') or ''))}</code>\n"
        f"Account: <code>{html.escape(account_name)}</code> ({html.escape(account_mode)}/{html.escape(plan_id)})\n"
        f"Amount: <b>{safe_decimal_2(req.get('amount_usd'))} USD</b>\n"
        f"Voucher: <b>{html.escape(voucher)}</b>\n"
        f"Bonus: <b>{safe_decimal_2(req.get('bonus_amount_usd'))} USD</b>\n"
        f"Total credit: <b>{safe_decimal_2(req.get('total_credit_usd'))} USD</b>\n"
        f"Review by: <code>{html.escape(due_text)}</code>\n"
        f"Request ID: <code>{html.escape(str(req.get('id') or ''))}</code>"
    )


def format_kyc_review_caption(req: dict, ticket: str) -> str:
    account_name = str(req.get("account_name") or "").strip() or str(req.get("trading_account_id") or "")
    account_mode = str(req.get("account_mode") or "").strip() or "real"
    plan_id = str(req.get("plan_id") or "").strip() or "standard"
    notes = str(req.get("notes") or "").strip() or "-"
    review_due_at = req.get("review_due_at")
    due_text = review_due_at.isoformat(sep=" ", timespec="seconds") if review_due_at else "N/A"
    return (
        "<b>KYC Review</b>\n"
        f"Ticket: <code>{html.escape(ticket)}</code>\n"
        f"User: <code>{html.escape(str(req.get('user_id') or ''))}</code>\n"
        f"Email: <code>{html.escape(str(req.get('user_email') or ''))}</code>\n"
        f"Account: <code>{html.escape(account_name)}</code> ({html.escape(account_mode)}/{html.escape(plan_id)})\n"
        f"Document type: <b>{html.escape(str(req.get('document_type') or '-'))}</b>\n"
        f"Full name: <b>{html.escape(str(req.get('full_name') or '-'))}</b>\n"
        f"Document number: <b>{html.escape(str(req.get('document_number') or '-'))}</b>\n"
        f"Address: <b>{html.escape(str(req.get('residence_address') or '-'))}</b>\n"
        f"Notes: <b>{html.escape(notes)}</b>\n"
        f"Review by: <code>{html.escape(due_text)}</code>\n"
        f"Request ID: <code>{html.escape(str(req.get('id') or ''))}</code>"
    )


def parse_review_callback_data(raw: str, prefix: str):
    parts = str(raw or "").strip().split(":", 2)
    if len(parts) != 3:
        return None, None
    if parts[0] != prefix:
        return None, None
    action = parts[1].strip().lower()
    request_id = parts[2].strip()
    if action not in ("approve", "reject") or not request_id:
        return None, None
    return action, request_id


async def safe_callback_answer(query: types.CallbackQuery, text: str, show_alert: bool = False) -> bool:
    try:
        await query.answer(text, show_alert=show_alert)
        return True
    except TelegramBadRequest as err:
        msg = str(err).lower()
        if (
            "query is too old" in msg
            or "query id is invalid" in msg
            or "response timeout expired" in msg
        ):
            logger.info("Callback answer skipped (expired callback query): %s", err)
            return False
        logger.exception("Failed to answer callback query: %s", err)
        return False
    except Exception as err:
        logger.exception("Failed to answer callback query: %s", err)
        return False


def _append_caption_block(base_caption: str, block_lines: list[str]) -> str:
    base = str(base_caption or "").strip()
    block = "\n".join([str(x) for x in block_lines if str(x).strip()]).strip()
    if not block:
        return base[:1024]

    sep = "\n\n"
    max_caption = 1024

    if len(block) >= max_caption:
        return f"{block[: max_caption - 3]}..."

    if not base:
        return block

    budget_for_base = max_caption - len(sep) - len(block)
    if budget_for_base <= 0:
        return block
    if len(base) > budget_for_base:
        if budget_for_base > 3:
            base = f"{base[: budget_for_base - 3]}..."
        else:
            base = base[:budget_for_base]
    return f"{base}{sep}{block}"


async def append_review_result_to_message(message: types.Message, block_lines: list[str]):
    if not message:
        return
    base = str(message.caption or "").strip()
    updated_caption = _append_caption_block(base, block_lines)
    await message.edit_caption(caption=updated_caption, reply_markup=None)


def _internal_post_sync(path: str, payload: dict):
    if not INTERNAL_API_TOKEN:
        return 500, {"error": "INTERNAL_API_TOKEN is not configured"}
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url=f"{API_BASE_URL}{path}",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Internal-Token": INTERNAL_API_TOKEN,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8") if resp else ""
            parsed = json.loads(raw) if raw else {}
            return int(resp.status), parsed
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8") if err else ""
        try:
            parsed = json.loads(raw) if raw else {}
        except Exception:
            parsed = {"error": raw or str(err)}
        return int(err.code), parsed
    except Exception as err:
        return 500, {"error": str(err)}


async def internal_post(path: str, payload: dict):
    return await asyncio.to_thread(_internal_post_sync, path, payload)


async def send_deposit_user_notification(request_id: str, outcome: dict):
    chat_id = await db.get_deposit_request_notification_target(request_id, kind="deposit")
    if not chat_id:
        return
    status = str(outcome.get("status") or "").strip().lower()
    ticket = str(outcome.get("ticket") or request_id)
    amount = safe_decimal_2(outcome.get("amount_usd"))
    bonus = safe_decimal_2(outcome.get("bonus_usd"))
    total = safe_decimal_2(outcome.get("total_usd"))
    if status == "approved":
        text = (
            "<b>Deposit request approved</b>\n"
            f"Ticket: <code>{html.escape(ticket)}</code>\n"
            f"Amount: <b>{amount} USD</b>\n"
            f"Bonus: <b>{bonus} USD</b>\n"
            f"Total credit: <b>{total} USD</b>"
        )
    elif status == "rejected":
        text = (
            "<b>Deposit request rejected</b>\n"
            f"Ticket: <code>{html.escape(ticket)}</code>"
        )
    else:
        text = (
            "<b>Deposit request already reviewed</b>\n"
            f"Ticket: <code>{html.escape(ticket)}</code>\n"
            f"Status: <b>{html.escape(status)}</b>"
        )
    try:
        await bot.send_message(chat_id=chat_id, text=text, parse_mode="HTML")
    except TelegramForbiddenError:
        await db.disable_user_write_access(chat_id)
        logger.info("Deposit notify skipped: user blocked bot chat_id=%s request=%s", chat_id, request_id)
    except TelegramBadRequest as err:
        lowered = str(err).lower()
        if "bot was blocked by the user" in lowered or "chat not found" in lowered or "forbidden" in lowered:
            await db.disable_user_write_access(chat_id)
            logger.info("Deposit notify skipped: user unavailable chat_id=%s request=%s", chat_id, request_id)
            return
        logger.exception("Failed to notify deposit user for request %s", request_id)
    except Exception:
        logger.exception("Failed to notify deposit user for request %s", request_id)


async def send_kyc_user_notification(request_id: str, outcome: dict):
    status = str(outcome.get("status") or "").strip().lower()
    kind = "bonus" if status == "approved" else "system"
    chat_id = await db.get_kyc_request_notification_target(request_id, kind=kind)
    if not chat_id:
        return
    ticket = str(outcome.get("ticket") or request_id)
    if status == "approved":
        bonus = safe_decimal_2(outcome.get("bonus_amount_usd"))
        text = (
            "<b>KYC approved</b>\n"
            f"Ticket: <code>{html.escape(ticket)}</code>\n"
            f"Bonus: <b>{bonus} USD</b>"
        )
    elif status == "rejected":
        text = (
            "<b>KYC request rejected</b>\n"
            f"Ticket: <code>{html.escape(ticket)}</code>"
        )
        blocked_until = outcome.get("blocked_until")
        if blocked_until:
            text += f"\nBlocked until: <code>{html.escape(str(blocked_until))}</code>"
        if bool(outcome.get("permanent_blocked")):
            text += "\n<b>Permanent block applied.</b>"
    else:
        text = (
            "<b>KYC request already reviewed</b>\n"
            f"Ticket: <code>{html.escape(ticket)}</code>\n"
            f"Status: <b>{html.escape(status)}</b>"
        )
    try:
        await bot.send_message(chat_id=chat_id, text=text, parse_mode="HTML")
    except TelegramForbiddenError:
        await db.disable_user_write_access(chat_id)
        logger.info("KYC notify skipped: user blocked bot chat_id=%s request=%s", chat_id, request_id)
    except TelegramBadRequest as err:
        lowered = str(err).lower()
        if "bot was blocked by the user" in lowered or "chat not found" in lowered or "forbidden" in lowered:
            await db.disable_user_write_access(chat_id)
            logger.info("KYC notify skipped: user unavailable chat_id=%s request=%s", chat_id, request_id)
            return
        logger.exception("Failed to notify KYC user for request %s", request_id)
    except Exception:
        logger.exception("Failed to notify KYC user for request %s", request_id)


async def dispatch_pending_deposit_reviews() -> int:
    deposit_chat_raw, _ = await db.get_review_chats()
    deposit_chat_id = parse_chat_id(deposit_chat_raw)
    if not deposit_chat_id:
        return 0

    requests = await db.fetch_pending_deposit_reviews(REVIEW_BATCH_LIMIT)
    if not requests:
        return 0

    dispatched = 0
    for req in requests:
        try:
            request_id = str(req.get("id") or "").strip()
            if not request_id:
                continue
            lag_sec = request_lag_seconds(req.get("created_at"))
            ticket = format_deposit_ticket(int(req.get("ticket_no") or 0), request_id)
            caption = format_deposit_review_caption(req, ticket)
            keyboard = InlineKeyboardMarkup(
                inline_keyboard=[[
                    InlineKeyboardButton(text="✅ Accept", callback_data=f"dep:approve:{request_id}", style="success"),
                    InlineKeyboardButton(text="❌ Reject", callback_data=f"dep:reject:{request_id}", style="danger"),
                ]]
            )
            proof_blob = bytes(req.get("proof_blob") or b"")
            if not proof_blob:
                continue
            proof_name = str(req.get("proof_file_name") or "").strip() or "deposit-proof.bin"
            sent = await bot.send_document(
                chat_id=deposit_chat_id,
                document=BufferedInputFile(file=proof_blob, filename=proof_name),
                caption=caption,
                parse_mode="HTML",
                reply_markup=keyboard,
            )
            claimed = await db.mark_deposit_review_dispatched(request_id, sent.chat.id, sent.message_id)
            if claimed:
                dispatched += 1
                if lag_sec is not None:
                    logger.info("Deposit review dispatched request=%s lag=%.2fs", request_id, lag_sec)
                else:
                    logger.info("Deposit review dispatched request=%s", request_id)
            else:
                logger.info("Deposit review dispatch skipped (already claimed) request=%s", request_id)
        except Exception:
            logger.exception("Failed to dispatch deposit review request %s", req.get("id"))
    return dispatched


async def dispatch_pending_kyc_reviews() -> int:
    _, kyc_chat_raw = await db.get_review_chats()
    kyc_chat_id = parse_chat_id(kyc_chat_raw)
    if not kyc_chat_id:
        return 0

    requests = await db.fetch_pending_kyc_reviews(REVIEW_BATCH_LIMIT)
    if not requests:
        return 0

    dispatched = 0
    for req in requests:
        try:
            request_id = str(req.get("id") or "").strip()
            if not request_id:
                continue
            lag_sec = request_lag_seconds(req.get("created_at"))
            ticket = format_kyc_ticket(int(req.get("ticket_no") or 0), request_id)
            caption = format_kyc_review_caption(req, ticket)
            keyboard = InlineKeyboardMarkup(
                inline_keyboard=[[
                    InlineKeyboardButton(text="✅ Approve KYC", callback_data=f"kyc:approve:{request_id}", style="success"),
                    InlineKeyboardButton(text="❌ Reject KYC", callback_data=f"kyc:reject:{request_id}", style="danger"),
                ]]
            )
            proof_blob = bytes(req.get("proof_blob") or b"")
            if not proof_blob:
                continue
            proof_name = str(req.get("proof_file_name") or "").strip() or "kyc-proof.bin"
            sent = await bot.send_document(
                chat_id=kyc_chat_id,
                document=BufferedInputFile(file=proof_blob, filename=proof_name),
                caption=caption,
                parse_mode="HTML",
                reply_markup=keyboard,
            )
            claimed = await db.mark_kyc_review_dispatched(request_id, sent.chat.id, sent.message_id)
            if claimed:
                dispatched += 1
                if lag_sec is not None:
                    logger.info("KYC review dispatched request=%s lag=%.2fs", request_id, lag_sec)
                else:
                    logger.info("KYC review dispatched request=%s", request_id)
            else:
                logger.info("KYC review dispatch skipped (already claimed) request=%s", request_id)
        except Exception:
            logger.exception("Failed to dispatch KYC review request %s", req.get("id"))
    return dispatched


async def review_dispatch_loop(stop_event: asyncio.Event, dispatch_event: asyncio.Event):
    dispatch_event.set()
    while not stop_event.is_set():
        stop_task = asyncio.create_task(stop_event.wait())
        dispatch_task = asyncio.create_task(dispatch_event.wait())
        try:
            done, pending = await asyncio.wait(
                {stop_task, dispatch_task},
                timeout=max(5, REVIEW_FALLBACK_SECONDS),
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            if stop_task in done and stop_event.is_set():
                break
            if dispatch_task in done and dispatch_event.is_set():
                dispatch_event.clear()
            try:
                update_review_health(last_dispatch_started_at=utc_now_iso(), last_dispatch_error="")
                deposit_sent = await dispatch_pending_deposit_reviews()
                kyc_sent = await dispatch_pending_kyc_reviews()
                update_review_health(
                    last_dispatch_finished_at=utc_now_iso(),
                    last_dispatch_deposit_sent=deposit_sent,
                    last_dispatch_kyc_sent=kyc_sent,
                    last_dispatch_error="",
                )
            except Exception:
                update_review_health(
                    last_dispatch_finished_at=utc_now_iso(),
                    last_dispatch_error="dispatch_failed",
                )
                logger.exception("Review dispatch loop failed")
        finally:
            if not stop_task.done():
                stop_task.cancel()
            if not dispatch_task.done():
                dispatch_task.cancel()


async def review_access_event_loop(stop_event: asyncio.Event, access_event: asyncio.Event):
    while not stop_event.is_set():
        stop_task = asyncio.create_task(stop_event.wait())
        access_task = asyncio.create_task(access_event.wait())
        try:
            done, pending = await asyncio.wait(
                {stop_task, access_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            if stop_task in done and stop_event.is_set():
                break
            if access_task in done and access_event.is_set():
                access_event.clear()
            try:
                await sync_deposit_review_chat_access_once()
            except Exception:
                logger.exception("Review chat access sync failed")
        finally:
            if not stop_task.done():
                stop_task.cancel()
            if not access_task.done():
                access_task.cancel()


async def review_listener_loop(stop_event: asyncio.Event, dispatch_event: asyncio.Event, access_event: asyncio.Event, loop):
    def on_review_notify(connection, pid, channel, payload):
        payload_text = str(payload or "").strip()
        logger.info("Review notify received on %s: %s", channel, payload_text)
        update_review_health(
            last_notify_at=utc_now_iso(),
            last_notify_payload=payload_text[:180],
        )
        if payload_text.lower().startswith(ACCESS_SYNC_NOTIFY_PREFIX):
            loop.call_soon_threadsafe(access_event.set)
            return
        loop.call_soon_threadsafe(dispatch_event.set)

    listener_online = False
    while not stop_event.is_set():
        try:
            if not db.listener_alive():
                await db.start_listener(REVIEW_NOTIFY_CHANNEL, on_review_notify)
                if listener_online:
                    logger.info("Review listener reconnected: %s", REVIEW_NOTIFY_CHANNEL)
                else:
                    logger.info("Listening review channel: %s", REVIEW_NOTIFY_CHANNEL)
                listener_online = True
                update_review_health(
                    listener_connected=True,
                    listener_connected_at=utc_now_iso(),
                    last_listener_error="",
                )
                dispatch_event.set()
                access_event.set()
        except Exception:
            if listener_online:
                logger.exception("Review listener lost, retrying...")
            else:
                logger.exception("Failed to start review listener, retrying...")
            listener_online = False
            update_review_health(
                listener_connected=False,
                last_listener_error_at=utc_now_iso(),
                last_listener_error="listener_connect_failed",
            )
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=max(3, REVIEW_LISTENER_RETRY_SECONDS))
        except asyncio.TimeoutError:
            pass


async def run_token_cleanup_once():
    """Remove expired panel access tokens on-demand."""
    try:
        removed = await db.delete_expired_tokens()
        if removed > 0:
            logger.info("Token cleanup removed %d expired access token(s)", removed)
    except Exception:
        logger.exception("Token cleanup failed")


async def trigger_shutdown(reason: str):
    global SHUTDOWN_IN_PROGRESS
    if SHUTDOWN_IN_PROGRESS:
        return
    SHUTDOWN_IN_PROGRESS = True
    logger.info("Shutdown requested: %s", reason)
    if BOT_STOP_EVENT is not None and not BOT_STOP_EVENT.is_set():
        BOT_STOP_EVENT.set()
    with contextlib.suppress(Exception):
        await dp.stop_polling()


async def terminal_shutdown_loop(stop_event: asyncio.Event):
    """Allow graceful stop from terminal by typing q/quit/exit + Enter."""
    if not sys.stdin or not sys.stdin.isatty():
        return
    logger.info("Terminal stop enabled: type 'q' and press Enter to stop bot")
    while not stop_event.is_set():
        try:
            line = await asyncio.to_thread(sys.stdin.readline)
        except Exception:
            return
        if line is None:
            continue
        cmd = str(line).strip().lower()
        if cmd in ("q", "quit", "exit", "off", "stop"):
            await trigger_shutdown(f"terminal command '{cmd}'")
            return


@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    """Handle /start command."""
    await message.answer(
        "👋 Welcome to LV TradePL Bot!\n\n"
        "Use /help to see available commands."
    )


@dp.message(Command("help", "h"))
async def cmd_help(message: types.Message):
    """Handle /help command."""
    user_id = message.from_user.id
    is_owner = user_id == OWNER_TELEGRAM_ID
    is_admin = await db.is_panel_admin(user_id)
    rights = await db.get_admin_rights(user_id) if is_admin and not is_owner else {}
    has_deposit_review = is_owner or bool((rights or {}).get("deposit_review"))

    help_text = (
        "📚 <b>Available Commands</b>\n\n"
        "/me - Get your Telegram ID\n"
        "/chid - Get current chat ID\n"
        "/info - Get chat/user technical info\n"
        "/help - Show this help message\n"
    )

    if is_owner:
        help_text += (
            "\n<b>🔐 Owner Commands:</b>\n"
            "/getownerpanel [time] - Get owner panel link\n"
            "/deladminpanel - Delete all admin panel links\n"
            "/review_chat - Get deposit review chat join link\n"
            "/health - Bot review listener health\n"
            "/off - Graceful shutdown bot\n"
            "  Examples:\n"
            "  • /getownerpanel 600 (600 seconds)\n"
            "  • /getownerpanel 60m (60 minutes)\n"
            "  • /getownerpanel 24h (24 hours)\n"
        )
    elif is_admin:
        help_text += (
            "\n<b>👤 Admin Commands:</b>\n"
            "/getadminpanel [time] - Get admin panel link\n"
            "/health - Bot review listener health\n"
            "  Examples:\n"
            "  • /getadminpanel 60m (60 minutes)\n"
            "  • /getadminpanel 24h (24 hours)\n"
        )
        if has_deposit_review:
            help_text += "/review_chat - Get deposit review chat join link\n"

    await message.answer(help_text, parse_mode="HTML")


@dp.message(Command("me"))
async def cmd_me(message: types.Message):
    """Handle /me command - show user's Telegram ID."""
    user = message.from_user
    user_id = user.id
    is_owner = user_id == OWNER_TELEGRAM_ID
    is_admin = await db.is_panel_admin(user_id)

    role = "👑 Owner" if is_owner else ("👤 Admin" if is_admin else "👤 User")

    text = (
        f"<b>Your Information</b>\n\n"
        f"🆔 <b>Telegram ID:</b> <code>{user_id}</code>\n"
        f"👤 <b>Username:</b> @{user.username or 'N/A'}\n"
        f"📛 <b>Name:</b> {user.full_name}\n"
        f"🎭 <b>Role:</b> {role}\n"
    )

    if is_admin and not is_owner:
        rights = await db.get_admin_rights(user_id)
        text += f"🔑 <b>Rights:</b> {format_rights(rights)}\n"

    await message.answer(text, parse_mode="HTML")


@dp.message(Command("chid"))
async def cmd_chid(message: types.Message):
    """Handle /chid command - show current chat ID."""
    await message.answer(
        f"Chat ID: <code>{message.chat.id}</code>\n"
        f"Type: <b>{message.chat.type}</b>",
        parse_mode="HTML",
    )


@dp.message(Command("info"))
async def cmd_info(message: types.Message):
    """Handle /info command - show chat/user technical info without duplicating /me fields."""
    chat = message.chat
    user = message.from_user

    chat_title = html.escape(chat.title) if chat.title else "N/A"
    chat_username = html.escape(f"@{chat.username}") if chat.username else "N/A"
    thread_id = str(message.message_thread_id) if message.message_thread_id else "N/A"
    msg_time = message.date.astimezone().strftime("%Y-%m-%d %H:%M:%S %Z") if message.date else "N/A"

    user_lang = html.escape(user.language_code) if user and user.language_code else "N/A"
    user_is_bot = "yes" if user and user.is_bot else "no"
    user_is_premium = "yes" if user and user.is_premium else "no"

    text = (
        "<b>Chat Info</b>\n"
        f"🆔 Chat ID: <code>{chat.id}</code>\n"
        f"💬 Chat Type: <b>{chat.type}</b>\n"
        f"🏷 Title: <b>{chat_title}</b>\n"
        f"🔗 Chat Username: <b>{chat_username}</b>\n"
        f"🧵 Thread ID: <code>{thread_id}</code>\n"
        f"📩 Message ID: <code>{message.message_id}</code>\n"
        f"🕒 Message Time: <b>{msg_time}</b>\n"
        f"🏛 Forum Chat: <b>{'yes' if getattr(chat, 'is_forum', False) else 'no'}</b>\n\n"
        "<b>User Extra</b>\n"
        f"🌐 Language: <b>{user_lang}</b>\n"
        f"🤖 Sender Is Bot: <b>{user_is_bot}</b>\n"
        f"💎 Telegram Premium: <b>{user_is_premium}</b>"
    )
    await message.answer(text, parse_mode="HTML")


@dp.message(Command("health"))
async def cmd_health(message: types.Message):
    """Show bot listener health for owner/admin."""
    user_id = message.from_user.id
    if user_id != OWNER_TELEGRAM_ID and not await db.is_panel_admin(user_id):
        return

    listener_live = REVIEW_HEALTH.get("listener_connected", False) and db.listener_alive()
    listener_status = "online" if listener_live else "offline"

    def show(key: str, default: str = "N/A") -> str:
        value = REVIEW_HEALTH.get(key, "")
        if value is None:
            return default
        text = str(value).strip()
        return text if text else default

    text = (
        "<b>Bot Review Health</b>\n\n"
        f"Listener: <b>{listener_status}</b>\n"
        f"Channel: <code>{html.escape(show('listener_channel'))}</code>\n"
        f"Connected at: <code>{html.escape(show('listener_connected_at'))}</code>\n"
        f"Last notify at: <code>{html.escape(show('last_notify_at'))}</code>\n"
        f"Last notify payload: <code>{html.escape(show('last_notify_payload', '-'))}</code>\n\n"
        f"Last dispatch start: <code>{html.escape(show('last_dispatch_started_at'))}</code>\n"
        f"Last dispatch finish: <code>{html.escape(show('last_dispatch_finished_at'))}</code>\n"
        f"Last dispatched: <b>deposit {int(REVIEW_HEALTH.get('last_dispatch_deposit_sent', 0) or 0)}</b>, "
        f"<b>kyc {int(REVIEW_HEALTH.get('last_dispatch_kyc_sent', 0) or 0)}</b>\n"
        f"Dispatch error: <code>{html.escape(show('last_dispatch_error', '-'))}</code>\n"
        f"Listener error: <code>{html.escape(show('last_listener_error', '-'))}</code>\n"
        f"Listener error at: <code>{html.escape(show('last_listener_error_at'))}</code>"
    )
    await message.answer(text, parse_mode="HTML")


@dp.message(Command("review_chat"))
async def cmd_review_chat(message: types.Message):
    """Return deposit review chat join link for owner/deposit reviewers."""
    user_id = int(message.from_user.id)
    allowed = await db.is_deposit_reviewer_allowed(user_id, OWNER_TELEGRAM_ID)
    if not allowed:
        return

    chat_id = await get_deposit_review_chat_id()
    if not chat_id:
        await message.answer("Deposit review chat is not configured in owner panel.")
        return

    await sync_deposit_review_chat_access_once()

    ttl_seconds = max(60, int(REVIEW_CHAT_LINK_TTL_SECONDS))
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    link_name = f"review-{user_id}-{int(datetime.now(timezone.utc).timestamp())}"
    try:
        invite = await bot.create_chat_invite_link(
            chat_id=chat_id,
            name=link_name,
            expire_date=expires_at,
            creates_join_request=True,
        )
    except Exception:
        logger.exception("Failed to create review chat invite for user=%s chat=%s", user_id, chat_id)
        await message.answer(
            "Failed to create review chat link. Check that bot is admin in the review chat "
            "and has rights to manage invite links and join requests."
        )
        return

    text = (
        "<b>Deposit Review Chat Access</b>\n\n"
        f"Link valid for: <b>{humanize_seconds(ttl_seconds)}</b>\n"
        "Join request will be approved only if you have <b>deposit_review</b> right.\n\n"
        f"{invite.invite_link}"
    )
    await message.answer(text, parse_mode="HTML")


@dp.message(Command("off"))
async def cmd_off(message: types.Message):
    """Owner-only graceful bot shutdown command."""
    user_id = message.from_user.id
    if user_id != OWNER_TELEGRAM_ID:
        return
    await message.answer("🛑 Shutting down bot...")
    await trigger_shutdown(f"telegram /off by {user_id}")


@dp.message(Command("delallpanel"))
async def cmd_delallpanel(message: types.Message):
    """Owner-only command: revoke all panel access links with confirmation."""
    user_id = int(message.from_user.id)
    if user_id != OWNER_TELEGRAM_ID:
        return

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ Разрешить", callback_data="pt:delall:yes", style="success"),
            InlineKeyboardButton(text="❌ Отклонить", callback_data="pt:delall:no", style="danger"),
        ]
    ])
    await message.answer(
        "⚠️ <b>Delete all panel links?</b>\n\n"
        "This will immediately revoke ALL owner/admin panel tokens.",
        parse_mode="HTML",
        reply_markup=keyboard,
    )


@dp.message(Command("deladminpanel"))
async def cmd_deladminpanel(message: types.Message):
    """Owner-only command: revoke all admin panel access links with confirmation."""
    user_id = int(message.from_user.id)
    if user_id != OWNER_TELEGRAM_ID:
        return

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ Разрешить", callback_data="pt:deladmin:yes", style="success"),
            InlineKeyboardButton(text="❌ Отклонить", callback_data="pt:deladmin:no", style="danger"),
        ]
    ])
    await message.answer(
        "⚠️ <b>Delete all admin panel links?</b>\n\n"
        "Owner panel links will stay active.\n"
        "Only admin panel tokens will be removed.",
        parse_mode="HTML",
        reply_markup=keyboard,
    )


@dp.callback_query(F.data.startswith("pt:delall:"))
async def callback_delallpanel(query: types.CallbackQuery):
    user_id = int(query.from_user.id)
    if user_id != OWNER_TELEGRAM_ID:
        await safe_callback_answer(query, "Owner only", show_alert=True)
        return
    if not query.message:
        await safe_callback_answer(query, "Message context is missing", show_alert=True)
        return

    action = str(query.data or "").split(":")[-1].strip().lower()
    if action == "no":
        with contextlib.suppress(Exception):
            await query.message.edit_text("❎ /delallpanel cancelled.")
        await safe_callback_answer(query, "Cancelled", show_alert=False)
        return
    if action != "yes":
        await safe_callback_answer(query, "Invalid callback", show_alert=True)
        return

    removed = await db.delete_all_panel_tokens()
    with contextlib.suppress(Exception):
        await query.message.edit_text(
            f"✅ All panel links were deleted.\nRemoved tokens: <b>{removed}</b>",
            parse_mode="HTML",
        )
    await safe_callback_answer(query, "All panel links deleted", show_alert=False)


@dp.callback_query(F.data.startswith("pt:deladmin:"))
async def callback_deladminpanel(query: types.CallbackQuery):
    user_id = int(query.from_user.id)
    if user_id != OWNER_TELEGRAM_ID:
        await safe_callback_answer(query, "Owner only", show_alert=True)
        return
    if not query.message:
        await safe_callback_answer(query, "Message context is missing", show_alert=True)
        return

    action = str(query.data or "").split(":")[-1].strip().lower()
    if action == "no":
        with contextlib.suppress(Exception):
            await query.message.edit_text("❎ /deladminpanel cancelled.")
        await safe_callback_answer(query, "Cancelled", show_alert=False)
        return
    if action != "yes":
        await safe_callback_answer(query, "Invalid callback", show_alert=True)
        return

    removed = await db.delete_tokens_by_type("admin")
    with contextlib.suppress(Exception):
        await query.message.edit_text(
            f"✅ Admin panel links were deleted.\nRemoved tokens: <b>{removed}</b>",
            parse_mode="HTML",
        )
    await safe_callback_answer(query, "Admin panel links deleted", show_alert=False)


@dp.callback_query(F.data.startswith("pt:"))
async def callback_panel_token_actions(query: types.CallbackQuery):
    parsed = parse_panel_action_callback(query.data)
    if not parsed:
        return
    if not query.message:
        await safe_callback_answer(query, "Message context is missing", show_alert=True)
        return

    action, token_type, telegram_id, duration_seconds = parsed
    caller_id = int(query.from_user.id)

    if token_type == "owner":
        if caller_id != OWNER_TELEGRAM_ID or telegram_id != OWNER_TELEGRAM_ID:
            await safe_callback_answer(query, "Owner only", show_alert=True)
            return
    else:
        if caller_id != telegram_id:
            await safe_callback_answer(query, "This button is not for your account", show_alert=True)
            return
        is_admin = await db.is_panel_admin(caller_id)
        if not is_admin:
            await safe_callback_answer(query, "Admin access required", show_alert=True)
            return

    await safe_callback_answer(query, "Processing...", show_alert=False)

    if action == "delete":
        removed = await db.delete_user_tokens(token_type, telegram_id)
        role_name = "Owner" if token_type == "owner" else "Admin"
        with contextlib.suppress(Exception):
            await query.message.edit_text(
                f"🗑 <b>{role_name} panel link deleted.</b>\nRemoved tokens: <b>{removed}</b>",
                parse_mode="HTML",
            )
        await safe_callback_answer(query, "Link deleted", show_alert=False)
        return

    # action == regen
    await db.delete_user_tokens(token_type, telegram_id)
    token = await db.create_token(token_type, telegram_id, duration_seconds)
    duration_text = humanize_seconds(duration_seconds)
    link = f"{SITE_URL}/manage-panel?token={token}"
    is_local = "localhost" in SITE_URL or "127.0.0.1" in SITE_URL
    keyboard = build_panel_keyboard(
        link=link,
        token_type=token_type,
        telegram_id=telegram_id,
        duration_seconds=duration_seconds,
        is_local=is_local,
        show_management_buttons=True,
    )

    if token_type == "owner":
        text = (
            f"🔐 <b>Owner Panel Access (new link)</b>\n\n"
            f"⏱ <b>Valid for:</b> {duration_text}\n\n"
            f"⚠️ <i>Previous link was removed and replaced.</i>"
        )
    else:
        rights = await db.get_admin_rights(telegram_id)
        text = (
            f"👤 <b>Admin Panel Access (new link)</b>\n\n"
            f"⏱ <b>Valid for:</b> {duration_text}\n"
            f"🔑 <b>Your Rights:</b> {format_rights(rights)}\n\n"
            f"⚠️ <i>Previous link was removed and replaced.</i>"
        )
    if is_local:
        text += f"\n\n🔗 {link}"

    with contextlib.suppress(Exception):
        await query.message.edit_text(text, parse_mode="HTML", reply_markup=keyboard)
    await safe_callback_answer(query, "New link created", show_alert=False)


@dp.chat_join_request()
async def on_chat_join_request(req: types.ChatJoinRequest):
    """Approve join requests only for owner/admins with deposit_review in configured deposit chat."""
    chat_id = await get_deposit_review_chat_id()
    if not chat_id:
        return
    if req.chat.id != chat_id:
        return

    telegram_id = int(req.from_user.id)
    allowed = await db.is_deposit_reviewer_allowed(telegram_id, OWNER_TELEGRAM_ID)
    if allowed:
        try:
            await bot.approve_chat_join_request(chat_id=chat_id, user_id=telegram_id)
            logger.info("Approved review chat join request user=%s", telegram_id)
            with contextlib.suppress(Exception):
                await bot.send_message(
                    chat_id=telegram_id,
                    text="✅ Access granted to deposit review chat.",
                )
        except Exception:
            logger.exception("Failed to approve review chat join request user=%s", telegram_id)
        LAST_DEPOSIT_REVIEW_ACCESS[telegram_id] = True
        return

    try:
        await bot.decline_chat_join_request(chat_id=chat_id, user_id=telegram_id)
        logger.info("Declined review chat join request user=%s", telegram_id)
    except Exception:
        logger.exception("Failed to decline review chat join request user=%s", telegram_id)
    with contextlib.suppress(Exception):
        await bot.send_message(
            chat_id=telegram_id,
            text="❌ Access denied. You need panel right: deposit_review.",
        )
    LAST_DEPOSIT_REVIEW_ACCESS[telegram_id] = False


@dp.callback_query(F.data.startswith("dep:"))
async def callback_deposit_review(query: types.CallbackQuery):
    action, request_id = parse_review_callback_data(query.data, "dep")
    if not action or not request_id:
        await safe_callback_answer(query, "Invalid callback data", show_alert=True)
        return
    if not query.message:
        await safe_callback_answer(query, "Message context is missing", show_alert=True)
        return

    deposit_chat_raw, _ = await db.get_review_chats()
    deposit_chat_id = parse_chat_id(deposit_chat_raw)
    if not deposit_chat_id or query.message.chat.id != deposit_chat_id:
        await safe_callback_answer(query, "Wrong deposit review chat", show_alert=True)
        return

    allowed = await db.is_deposit_reviewer_allowed(query.from_user.id, OWNER_TELEGRAM_ID)
    if not allowed:
        await safe_callback_answer(query, "You are not allowed to review deposits", show_alert=True)
        return

    # Ack early to avoid Telegram callback timeout while decision is processed.
    await safe_callback_answer(query, "Processing decision...", show_alert=False)

    status, payload = await internal_post(
        "/v1/internal/telegram/reviews/deposit/decision",
        {
            "request_id": request_id,
            "action": action,
            "reviewer_telegram_id": query.from_user.id,
        },
    )
    if status != 200:
        error_text = str((payload or {}).get("error") or "Review decision failed")
        await safe_callback_answer(query, error_text[:180], show_alert=True)
        return

    outcome = payload or {}
    reviewer_label = f"@{query.from_user.username}" if query.from_user.username else str(query.from_user.id)
    icon = "✅"
    outcome_status = str(outcome.get("status") or "").strip()
    if outcome_status.startswith("rejected"):
        icon = "❌"
    lines = [
        f"{icon} Deposit {outcome_status.upper() or 'UPDATED'}",
        f"Ticket: {str(outcome.get('ticket') or request_id)}",
        f"Amount: {safe_decimal_2(outcome.get('amount_usd'))} USD",
        f"Bonus: {safe_decimal_2(outcome.get('bonus_usd'))} USD",
        f"Total: {safe_decimal_2(outcome.get('total_usd'))} USD",
        f"Reviewer: {reviewer_label}",
    ]
    with contextlib.suppress(Exception):
        await append_review_result_to_message(query.message, lines)
    await send_deposit_user_notification(request_id, outcome)
    await safe_callback_answer(query, "Decision applied", show_alert=False)


@dp.callback_query(F.data.startswith("kyc:"))
async def callback_kyc_review(query: types.CallbackQuery):
    action, request_id = parse_review_callback_data(query.data, "kyc")
    if not action or not request_id:
        await safe_callback_answer(query, "Invalid callback data", show_alert=True)
        return
    if not query.message:
        await safe_callback_answer(query, "Message context is missing", show_alert=True)
        return

    _, kyc_chat_raw = await db.get_review_chats()
    kyc_chat_id = parse_chat_id(kyc_chat_raw)
    if not kyc_chat_id or query.message.chat.id != kyc_chat_id:
        await safe_callback_answer(query, "Wrong KYC review chat", show_alert=True)
        return

    allowed = await db.is_kyc_reviewer_allowed(query.from_user.id, OWNER_TELEGRAM_ID)
    if not allowed:
        await safe_callback_answer(query, "You are not allowed to review KYC", show_alert=True)
        return

    # Ack early to avoid Telegram callback timeout while decision is processed.
    await safe_callback_answer(query, "Processing decision...", show_alert=False)

    status, payload = await internal_post(
        "/v1/internal/telegram/reviews/kyc/decision",
        {
            "request_id": request_id,
            "action": action,
            "reviewer_telegram_id": query.from_user.id,
        },
    )
    if status != 200:
        error_text = str((payload or {}).get("error") or "Review decision failed")
        await safe_callback_answer(query, error_text[:180], show_alert=True)
        return

    outcome = payload or {}
    reviewer_label = f"@{query.from_user.username}" if query.from_user.username else str(query.from_user.id)
    icon = "✅"
    outcome_status = str(outcome.get("status") or "").strip()
    lines = [
        f"{icon} KYC {outcome_status.upper() or 'UPDATED'}",
        f"Ticket: {str(outcome.get('ticket') or request_id)}",
        f"Reviewer: {reviewer_label}",
    ]
    if outcome_status.startswith("rejected"):
        lines[0] = f"❌ KYC {outcome_status.upper() or 'REJECTED'}"
        blocked_until = outcome.get("blocked_until")
        if blocked_until:
            lines.append(f"Blocked until: {str(blocked_until)}")
        if bool(outcome.get("permanent_blocked")):
            lines.append("User KYC state: PERMANENT BLOCK")
        attempts = int(outcome.get("failed_attempts") or 0)
        if attempts > 0:
            lines.append(f"Failed attempts: {attempts}")
    if outcome_status.startswith("approved"):
        lines.append(f"Bonus: {safe_decimal_2(outcome.get('bonus_amount_usd'))} USD")

    with contextlib.suppress(Exception):
        await append_review_result_to_message(query.message, lines)
    await send_kyc_user_notification(request_id, outcome)
    await safe_callback_answer(query, "Decision applied", show_alert=False)


@dp.message(Command("getownerpanel"))
async def cmd_getownerpanel(message: types.Message):
    """Handle /getownerpanel command - generate owner panel link."""
    user_id = message.from_user.id

    if user_id != OWNER_TELEGRAM_ID:
        # Don't reveal this command exists
        return

    await run_token_cleanup_once()

    active = await db.get_active_token("owner", user_id)
    reused_active = active is not None
    if reused_active:
        token = str(active.get("token") or "")
        expires_at = active.get("expires_at")
        if not expires_at:
            remaining_seconds = 3600
        else:
            if getattr(expires_at, "tzinfo", None) is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            remaining_seconds = max(0, int((expires_at - datetime.now(timezone.utc)).total_seconds()))
            if remaining_seconds <= 0:
                remaining_seconds = 3600
        duration_text = humanize_seconds(remaining_seconds)
    else:
        # Parse duration from command arguments only when new token is needed.
        args = message.text.split(maxsplit=1)
        duration_str = args[1] if len(args) > 1 else ""
        remaining_seconds, duration_text = parse_duration(duration_str)
        remaining_seconds = max(60, int(remaining_seconds or 3600))
        token = await db.create_token("owner", user_id, remaining_seconds)

    # Generate link
    link = f"{SITE_URL}/manage-panel?token={token}"

    # Check if local
    is_local = "localhost" in SITE_URL or "127.0.0.1" in SITE_URL

    keyboard = build_panel_keyboard(
        link=link,
        token_type="owner",
        telegram_id=user_id,
        duration_seconds=remaining_seconds,
        is_local=is_local,
        show_management_buttons=reused_active,
    )

    if reused_active:
        msg_text = (
            f"♻️ <b>Owner Panel Access (active link reused)</b>\n\n"
            f"⏳ <b>Remaining:</b> {duration_text}\n\n"
            f"⚠️ <i>New link was not created because previous one is still active.</i>"
        )
    else:
        msg_text = (
            f"🔐 <b>Owner Panel Access</b>\n\n"
            f"⏱ <b>Valid for:</b> {duration_text}\n\n"
            f"⚠️ <i>This link will expire after the specified time.</i>"
        )

    if is_local:
        msg_text += f"\n\n🔗 {link}"

    await message.answer(
        msg_text,
        parse_mode="HTML",
        reply_markup=keyboard
    )


@dp.message(Command("getadminpanel"))
async def cmd_getadminpanel(message: types.Message):
    """Handle /getadminpanel command - generate admin panel link."""
    user_id = message.from_user.id

    is_admin = await db.is_panel_admin(user_id)
    if not is_admin:
        return

    await run_token_cleanup_once()

    active = await db.get_active_token("admin", user_id)
    reused_active = active is not None
    if reused_active:
        token = str(active.get("token") or "")
        expires_at = active.get("expires_at")
        if not expires_at:
            remaining_seconds = 3600
        else:
            if getattr(expires_at, "tzinfo", None) is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            remaining_seconds = max(0, int((expires_at - datetime.now(timezone.utc)).total_seconds()))
            if remaining_seconds <= 0:
                remaining_seconds = 3600
        duration_text = humanize_seconds(remaining_seconds)
    else:
        args = message.text.split(maxsplit=1)
        duration_str = args[1] if len(args) > 1 else ""
        remaining_seconds, duration_text = parse_duration(duration_str)
        remaining_seconds = max(60, int(remaining_seconds or 3600))
        token = await db.create_token("admin", user_id, remaining_seconds)
    link = f"{SITE_URL}/manage-panel?token={token}"

    rights = await db.get_admin_rights(user_id)

    is_local = "localhost" in SITE_URL or "127.0.0.1" in SITE_URL
    keyboard = build_panel_keyboard(
        link=link,
        token_type="admin",
        telegram_id=user_id,
        duration_seconds=remaining_seconds,
        is_local=is_local,
        show_management_buttons=reused_active,
    )

    if reused_active:
        msg_text = (
            f"♻️ <b>Admin Panel Access (active link reused)</b>\n\n"
            f"⏳ <b>Remaining:</b> {duration_text}\n"
            f"🔑 <b>Your Rights:</b> {format_rights(rights)}\n\n"
            f"⚠️ <i>New link was not created because previous one is still active.</i>"
        )
    else:
        msg_text = (
            f"👤 <b>Admin Panel Access</b>\n\n"
            f"⏱ <b>Valid for:</b> {duration_text}\n"
            f"🔑 <b>Your Rights:</b> {format_rights(rights)}\n\n"
            f"⚠️ <i>This link will expire after the specified time.</i>"
        )

    if is_local:
        msg_text += f"\n\n🔗 {link}"

    await message.answer(
        msg_text,
        parse_mode="HTML",
        reply_markup=keyboard
    )


async def set_bot_commands():
    """Set bot commands for autocomplete."""
    commands = [
        BotCommand(command="help", description="Show help message"),
        BotCommand(command="me", description="Get your Telegram ID"),
        BotCommand(command="chid", description="Get current chat ID"),
        BotCommand(command="info", description="Get chat/user technical info"),
        BotCommand(command="review_chat", description="Get deposit review chat link"),
        BotCommand(command="health", description="Bot review listener health"),
        BotCommand(command="off", description="Graceful shutdown (owner only)"),
    ]
    await bot.set_my_commands(commands)


async def main():
    """Main function to start the bot."""
    global BOT_STOP_EVENT, SHUTDOWN_IN_PROGRESS
    SHUTDOWN_IN_PROGRESS = False
    logger.info("Starting bot...")

    await db.connect()
    logger.info("Connected to database")

    await set_bot_commands()

    if not INTERNAL_API_TOKEN:
        logger.warning("INTERNAL_API_TOKEN is empty. Review callbacks will fail.")

    try:
        await sync_deposit_review_chat_access_once()
    except Exception:
        logger.exception("Initial review chat access sync failed")

    stop_event = asyncio.Event()
    BOT_STOP_EVENT = stop_event
    dispatch_event = asyncio.Event()
    access_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    def schedule_shutdown(sig_name: str):
        asyncio.create_task(trigger_shutdown(f"signal {sig_name}"))

    with contextlib.suppress(NotImplementedError):
        loop.add_signal_handler(signal.SIGINT, schedule_shutdown, "SIGINT")
    with contextlib.suppress(NotImplementedError):
        loop.add_signal_handler(signal.SIGTERM, schedule_shutdown, "SIGTERM")

    dispatcher_task = asyncio.create_task(review_dispatch_loop(stop_event, dispatch_event))
    listener_task = asyncio.create_task(review_listener_loop(stop_event, dispatch_event, access_event, loop))
    access_task = asyncio.create_task(review_access_event_loop(stop_event, access_event))
    terminal_task = asyncio.create_task(terminal_shutdown_loop(stop_event))

    try:
        await dp.start_polling(bot, handle_signals=False, close_bot_session=False)
    except asyncio.CancelledError:
        logger.info("Polling cancelled")
    finally:
        stop_event.set()
        dispatcher_task.cancel()
        listener_task.cancel()
        access_task.cancel()
        terminal_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await dispatcher_task
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await listener_task
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await access_task
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await terminal_task
        with contextlib.suppress(NotImplementedError, Exception):
            loop.remove_signal_handler(signal.SIGINT)
        with contextlib.suppress(NotImplementedError, Exception):
            loop.remove_signal_handler(signal.SIGTERM)
        BOT_STOP_EVENT = None
        await db.close()
        await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
