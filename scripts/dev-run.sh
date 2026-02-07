#!/usr/bin/env sh
set -a
. ./.env
set +a
# Kill any existing process on port 8080
fuser -k 8080/tcp 2>/dev/null || true
sleep 0.5
exec ./tmp/lv-tradepl
