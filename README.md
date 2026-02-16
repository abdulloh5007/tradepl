LV Trade Platform Prototype

Scope
- Backend only
- Auth, ledger, order placement, matching engine skeleton
- PostgreSQL only
- Modular monolith

Run
1) Apply migration in db/migrations/001_init.sql
2) Insert assets and trading_pairs
3) Set env vars
   - HTTP_ADDR
   - DB_DSN
   - JWT_ISSUER
   - JWT_SECRET
   - JWT_TTL
   - INTERNAL_API_TOKEN
   - WS_ORIGIN
   - PROFECT_MODE (development or production)
   - TELEGRAM_RUNTIME_MODE (internal or external; default: `internal` in development, `external` in production. `external` disables polling/review flows in Go server and expects external bot process)
   - TELEGRAM_BOT_TOKEN (optional, required for Telegram Mini App auth)
   - TELEGRAM_BOT_USERNAME (optional, used to build referral share deep-link; if empty backend will try Telegram `getMe` by token)
   - APP_VERSION (optional, shown in owner System panel)
   - APP_UPDATED_AT (optional RFC3339 time, shown in owner System panel as deploy/update time)
   - API_BASE_URL (optional, used by `bot` process for internal review callbacks; default http://localhost:8080)
   - BOT_REVIEW_NOTIFY_CHANNEL (optional, Postgres NOTIFY channel for bot review dispatch; default review_dispatch)
   - BOT_REVIEW_FALLBACK_SECONDS (optional, fallback resync interval when no notify; default 60)
   - BOT_REVIEW_LISTENER_RETRY_SECONDS (optional, retry interval for DB listener reconnect; default 10)
   - BOT_REVIEW_BATCH_LIMIT (optional, max pending review docs sent in one pass; default 20)
   - FAUCET_ENABLED (optional, default true)
   - FAUCET_MAX (optional, default 10000)
   - MARKETDATA_DIR (optional, default empty, example db/marketdata)
4) Optional: copy .env.example to .env
5) Start
   - make api
   - or: make run-env (loads .env)
   - or: go run ./cmd/api
6) Dev auto-reload (optional)
   - go install github.com/air-verse/air@latest
   - make dev
7) Telegram bot process (optional, for external Telegram runtime mode)
   - cd bot
   - python3 -m venv venv && source venv/bin/activate
   - pip install -r requirements.txt
   - python main.py

Notes
- `GET /health/live` is liveness (fast, no DB check).
- `GET /health` and `GET /health/ready` are readiness summary (DB ping; HTTP 503 when DB is unreachable).
- `GET /health/admin` returns full JSON diagnostics (runtime, memory, DB pool snapshot) and requires `X-Internal-Token`.
- `GET /metrics` returns Prometheus-style metrics and requires `X-Internal-Token`.
- Owner panel API proxies: `GET /v1/admin/system/health` and `GET /v1/admin/system/metrics` (owner-auth, no internal token exposed to UI).
- Market orders are IOC only
- FOK is rejected
- WebSocket endpoint is /v1/ws and broadcasts trade events
- Internal deposits and withdrawals require X-Internal-Token header
- Faucet endpoint: POST /v1/faucet (auth required)

UI
- cd ui
- npm install
- npm run dev
- Open http://localhost:5173
- Faucet UI: http://localhost:5173/faucet or http://localhost:5173/#faucet
- Swagger UI loads from ui/public/openapi.yaml
- OpenAPI sync runs automatically on dev/build (source: docs/openapi.yaml)
- Vite proxy uses VITE_API_BASE (default http://localhost:8080)
- Leave Base URL empty in UI to use Vite proxy
- Optional: build and serve from Go
  - npm run build
  - set UI_DIST=ui/dist
  - start backend and open http://localhost:8080

Docker Compose
- docker compose up -d db
- docker compose up api

Seed data
- scripts/seed.sh uses DB_DSN (default postgres://postgres:postgres@localhost:5432/lvtrade?sslmode=disable)
- Seed now includes UZS-USD for local testing

Makefile shortcuts
- make db
- make migrate
- make seed
- make api
- make ui
- make run
