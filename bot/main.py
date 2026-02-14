import asyncio
import html
import logging
import sys
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command, CommandStart
from aiogram.types import BotCommand, InlineKeyboardMarkup, InlineKeyboardButton

from config import BOT_TOKEN, OWNER_TELEGRAM_ID, SITE_URL
from database import Database
from utils import parse_duration, format_rights

# Configure logging
logging.basicConfig(level=logging.INFO, stream=sys.stdout)
logger = logging.getLogger(__name__)

# Initialize bot and dispatcher
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# Database
from config import DATABASE_URL
db = Database(DATABASE_URL)


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
            "  Examples:\n"
            "  • /getownerpanel 600 (600 seconds)\n"
            "  • /getownerpanel 60m (60 minutes)\n"
            "  • /getownerpanel 24h (24 hours)\n"
        )
    elif is_admin:
        help_text += (
            "\n<b>👤 Admin Commands:</b>\n"
            "/getadminpanel [time] - Get admin panel link\n"
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


@dp.message(Command("getownerpanel"))
async def cmd_getownerpanel(message: types.Message):
    """Handle /getownerpanel command - generate owner panel link."""
    user_id = message.from_user.id
    
    if user_id != OWNER_TELEGRAM_ID:
        # Don't reveal this command exists
        return
    
    # Parse duration from command arguments
    args = message.text.split(maxsplit=1)
    duration_str = args[1] if len(args) > 1 else ""
    duration_seconds, duration_text = parse_duration(duration_str)
    
    # Create token
    token = await db.create_token("owner", user_id, duration_seconds)
    
    # Generate link
    link = f"{SITE_URL}/manage-panel?token={token}"
    
    # Check if local
    is_local = "localhost" in SITE_URL or "127.0.0.1" in SITE_URL
    
    keyboard = None
    if not is_local:
        # Create inline keyboard with clickable button
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🚀 КЛИКНИ ДЛЯ БЫСТРОГО ВХОДА", url=link)]
        ])
    
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
    
    # Check if user is an admin (not owner - owner uses /getownerpanel)
    is_admin = await db.is_panel_admin(user_id)
    
    if not is_admin:
        # Don't reveal this command exists
        return
    
    # Parse duration from command arguments
    args = message.text.split(maxsplit=1)
    duration_str = args[1] if len(args) > 1 else ""
    duration_seconds, duration_text = parse_duration(duration_str)
    
    # Create token
    token = await db.create_token("admin", user_id, duration_seconds)
    
    # Generate link
    link = f"{SITE_URL}/manage-panel?token={token}"
    
    # Get rights info
    rights = await db.get_admin_rights(user_id)
    
    # Create inline keyboard with clickable button
    keyboard = None
    is_local = "localhost" in SITE_URL or "127.0.0.1" in SITE_URL
    
    if not is_local:
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🚀 КЛИКНИ ДЛЯ БЫСТРОГО ВХОДА", url=link)]
        ])
        
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
    ]
    await bot.set_my_commands(commands)


async def main():
    """Main function to start the bot."""
    logger.info("Starting bot...")
    
    # Connect to database
    await db.connect()
    logger.info("Connected to database")
    
    # Set bot commands
    await set_bot_commands()
    
    # Start polling
    try:
        await dp.start_polling(bot)
    finally:
        await db.close()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
