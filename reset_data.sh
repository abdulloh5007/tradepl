#!/bin/bash

# Database Connection (Adjust if needed)
DB_URL="postgres://lvuser:lvpass@localhost:5432/lvtrade?sslmode=disable"

echo "⚠️  WARNING: This will DELETE all users, orders, trades, and candle history."
echo "Config (Sessions, Admin Users, Volatility) will be PRESERVED."
echo "Press Ctrl+C to cancel or wait 3 seconds..."
sleep 3

echo "🗑️  Cleaning Database..."
# Truncate users (Cascade will clean accounts, orders, ledger, etc.)
# We do NOT touch admin_users, assets, trading_pairs, sessions, volatility_settings
psql "$DB_URL" -c "TRUNCATE TABLE users CASCADE;"

echo "🗑️  Removing Candle Data..."
# Remove the JSON persistence file
rm -f "db/marketdata/1m.ndjson"

echo "✅  Reset Complete!"
echo "➡️  Please RESTART the server now to regenerate fresh candles."
