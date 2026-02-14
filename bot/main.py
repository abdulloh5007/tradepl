import asyncio
import contextlib
import html
import json
import logging
import signal
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import Command
from aiogram.types import BotCommand, BufferedInputFile, InlineKeyboardButton, InlineKeyboardMarkup

from config import (
    API_BASE_URL,
    BOT_TOKEN,
    INTERNAL_API_TOKEN,
    OWNER_TELEGRAM_ID,
    REVIEW_BATCH_LIMIT,
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
    chat_id = await db.get_deposit_request_notification_target(request_id)
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
    except Exception:
        logger.exception("Failed to notify deposit user for request %s", request_id)


async def send_kyc_user_notification(request_id: str, outcome: dict):
    chat_id = await db.get_kyc_request_notification_target(request_id)
    if not chat_id:
        return
    status = str(outcome.get("status") or "").strip().lower()
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


async def review_listener_loop(stop_event: asyncio.Event, dispatch_event: asyncio.Event, loop):
    def on_review_notify(connection, pid, channel, payload):
        logger.info("Review notify received on %s: %s", channel, payload)
        update_review_health(
            last_notify_at=utc_now_iso(),
            last_notify_payload=str(payload or "")[:180],
        )
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


@dp.message(Command("off"))
async def cmd_off(message: types.Message):
    """Owner-only graceful bot shutdown command."""
    user_id = message.from_user.id
    if user_id != OWNER_TELEGRAM_ID:
        return
    await message.answer("🛑 Shutting down bot...")
    await trigger_shutdown(f"telegram /off by {user_id}")


@dp.callback_query(F.data.startswith("dep:"))
async def callback_deposit_review(query: types.CallbackQuery):
    action, request_id = parse_review_callback_data(query.data, "dep")
    if not action or not request_id:
        await query.answer("Invalid callback data", show_alert=True)
        return
    if not query.message:
        await query.answer("Message context is missing", show_alert=True)
        return

    deposit_chat_raw, _ = await db.get_review_chats()
    deposit_chat_id = parse_chat_id(deposit_chat_raw)
    if not deposit_chat_id or query.message.chat.id != deposit_chat_id:
        await query.answer("Wrong deposit review chat", show_alert=True)
        return

    allowed = await db.is_deposit_reviewer_allowed(query.from_user.id, OWNER_TELEGRAM_ID)
    if not allowed:
        await query.answer("You are not allowed to review deposits", show_alert=True)
        return

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
        await query.answer(error_text[:180], show_alert=True)
        return

    outcome = payload or {}
    with contextlib.suppress(Exception):
        await query.message.edit_reply_markup(reply_markup=None)

    reviewer_label = f"@{query.from_user.username}" if query.from_user.username else str(query.from_user.id)
    icon = "✅"
    outcome_status = str(outcome.get("status") or "").strip()
    if outcome_status.startswith("rejected"):
        icon = "❌"
    text = (
        f"{icon} Deposit <b>{html.escape(outcome_status.upper() or 'UPDATED')}</b>\n"
        f"Ticket: <code>{html.escape(str(outcome.get('ticket') or request_id))}</code>\n"
        f"Amount: <b>{safe_decimal_2(outcome.get('amount_usd'))} USD</b>\n"
        f"Bonus: <b>{safe_decimal_2(outcome.get('bonus_usd'))} USD</b>\n"
        f"Total: <b>{safe_decimal_2(outcome.get('total_usd'))} USD</b>\n"
        f"Reviewer: <b>{html.escape(reviewer_label)}</b>"
    )
    await bot.send_message(chat_id=query.message.chat.id, text=text, parse_mode="HTML")
    await send_deposit_user_notification(request_id, outcome)
    await query.answer("Decision applied", show_alert=False)


@dp.callback_query(F.data.startswith("kyc:"))
async def callback_kyc_review(query: types.CallbackQuery):
    action, request_id = parse_review_callback_data(query.data, "kyc")
    if not action or not request_id:
        await query.answer("Invalid callback data", show_alert=True)
        return
    if not query.message:
        await query.answer("Message context is missing", show_alert=True)
        return

    _, kyc_chat_raw = await db.get_review_chats()
    kyc_chat_id = parse_chat_id(kyc_chat_raw)
    if not kyc_chat_id or query.message.chat.id != kyc_chat_id:
        await query.answer("Wrong KYC review chat", show_alert=True)
        return

    allowed = await db.is_kyc_reviewer_allowed(query.from_user.id, OWNER_TELEGRAM_ID)
    if not allowed:
        await query.answer("You are not allowed to review KYC", show_alert=True)
        return

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
        await query.answer(error_text[:180], show_alert=True)
        return

    outcome = payload or {}
    with contextlib.suppress(Exception):
        await query.message.edit_reply_markup(reply_markup=None)

    reviewer_label = f"@{query.from_user.username}" if query.from_user.username else str(query.from_user.id)
    icon = "✅"
    outcome_status = str(outcome.get("status") or "").strip()
    lines = [
        f"{icon} KYC <b>{html.escape(outcome_status.upper() or 'UPDATED')}</b>",
        f"Ticket: <code>{html.escape(str(outcome.get('ticket') or request_id))}</code>",
        f"Reviewer: <b>{html.escape(reviewer_label)}</b>",
    ]
    if outcome_status.startswith("rejected"):
        lines[0] = f"❌ KYC <b>{html.escape(outcome_status.upper() or 'REJECTED')}</b>"
        blocked_until = outcome.get("blocked_until")
        if blocked_until:
            lines.append(f"Blocked until: <code>{html.escape(str(blocked_until))}</code>")
        if bool(outcome.get("permanent_blocked")):
            lines.append("User KYC state: <b>PERMANENT BLOCK</b>")
        attempts = int(outcome.get("failed_attempts") or 0)
        if attempts > 0:
            lines.append(f"Failed attempts: <b>{attempts}</b>")
    if outcome_status.startswith("approved"):
        lines.append(f"Bonus: <b>{safe_decimal_2(outcome.get('bonus_amount_usd'))} USD</b>")

    await bot.send_message(chat_id=query.message.chat.id, text="\n".join(lines), parse_mode="HTML")
    await send_kyc_user_notification(request_id, outcome)
    await query.answer("Decision applied", show_alert=False)


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
            remaining_seconds = 0
        else:
            if getattr(expires_at, "tzinfo", None) is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            remaining_seconds = max(0, int((expires_at - datetime.now(timezone.utc)).total_seconds()))
        duration_text = humanize_seconds(remaining_seconds)
    else:
        # Parse duration from command arguments only when new token is needed.
        args = message.text.split(maxsplit=1)
        duration_str = args[1] if len(args) > 1 else ""
        duration_seconds, duration_text = parse_duration(duration_str)
        token = await db.create_token("owner", user_id, duration_seconds)

    # Generate link
    link = f"{SITE_URL}/manage-panel?token={token}"

    # Check if local
    is_local = "localhost" in SITE_URL or "127.0.0.1" in SITE_URL

    keyboard = None
    if not is_local:
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🚀 КЛИКНИ ДЛЯ БЫСТРОГО ВХОДА", url=link, style="primary")]
        ])

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
            remaining_seconds = 0
        else:
            if getattr(expires_at, "tzinfo", None) is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            remaining_seconds = max(0, int((expires_at - datetime.now(timezone.utc)).total_seconds()))
        duration_text = humanize_seconds(remaining_seconds)
    else:
        args = message.text.split(maxsplit=1)
        duration_str = args[1] if len(args) > 1 else ""
        duration_seconds, duration_text = parse_duration(duration_str)
        token = await db.create_token("admin", user_id, duration_seconds)
    link = f"{SITE_URL}/manage-panel?token={token}"

    rights = await db.get_admin_rights(user_id)

    keyboard = None
    is_local = "localhost" in SITE_URL or "127.0.0.1" in SITE_URL
    if not is_local:
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🚀 КЛИКНИ ДЛЯ БЫСТРОГО ВХОДА", url=link, style="primary")]
        ])

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

    stop_event = asyncio.Event()
    BOT_STOP_EVENT = stop_event
    dispatch_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    def schedule_shutdown(sig_name: str):
        asyncio.create_task(trigger_shutdown(f"signal {sig_name}"))

    with contextlib.suppress(NotImplementedError):
        loop.add_signal_handler(signal.SIGINT, schedule_shutdown, "SIGINT")
    with contextlib.suppress(NotImplementedError):
        loop.add_signal_handler(signal.SIGTERM, schedule_shutdown, "SIGTERM")

    dispatcher_task = asyncio.create_task(review_dispatch_loop(stop_event, dispatch_event))
    listener_task = asyncio.create_task(review_listener_loop(stop_event, dispatch_event, loop))
    terminal_task = asyncio.create_task(terminal_shutdown_loop(stop_event))

    try:
        await dp.start_polling(bot, handle_signals=False, close_bot_session=False)
    except asyncio.CancelledError:
        logger.info("Polling cancelled")
    finally:
        stop_event.set()
        dispatcher_task.cancel()
        listener_task.cancel()
        terminal_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await dispatcher_task
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await listener_task
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
