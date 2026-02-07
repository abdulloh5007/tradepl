import os
from dotenv import load_dotenv

# Load .env from parent directory
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# Telegram Bot
BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
OWNER_TELEGRAM_ID = int(os.getenv('OWNER_TELEGRAM_ID', '0'))

# Site URL
SITE_URL = os.getenv('SITE_URL', 'http://localhost:5173')

# Database (uses same as Go backend)
DATABASE_URL = os.getenv('DB_DSN', 'postgres://postgres:postgres@localhost:5432/lv_tradepl?sslmode=disable')
