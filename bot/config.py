import os
from dotenv import load_dotenv

# Load .env from parent directory
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# Telegram Bot
BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
OWNER_TELEGRAM_ID = int(os.getenv('OWNER_TELEGRAM_ID', '0'))

# Site URL
SITE_URL = os.getenv('SITE_URL', 'http://localhost:5173')
API_BASE_URL = os.getenv('API_BASE_URL', 'http://localhost:8080').rstrip('/')
INTERNAL_API_TOKEN = os.getenv('INTERNAL_API_TOKEN', '')
REVIEW_BATCH_LIMIT = int(os.getenv('BOT_REVIEW_BATCH_LIMIT', '20'))
REVIEW_NOTIFY_CHANNEL = os.getenv('BOT_REVIEW_NOTIFY_CHANNEL', 'review_dispatch')
REVIEW_FALLBACK_SECONDS = int(os.getenv('BOT_REVIEW_FALLBACK_SECONDS', '60'))
REVIEW_LISTENER_RETRY_SECONDS = int(os.getenv('BOT_REVIEW_LISTENER_RETRY_SECONDS', '10'))

# Database (uses same as Go backend)
DATABASE_URL = os.getenv('DB_DSN', 'postgres://postgres:postgres@localhost:5432/lv_tradepl?sslmode=disable')
