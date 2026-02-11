DB_DSN ?= postgres://postgres:postgres@localhost:5432/lvtrade?sslmode=disable
HTTP_ADDR ?= :8080
JWT_ISSUER ?= lv-tradepl
JWT_SECRET ?= change_me_now
JWT_TTL ?= 24h
INTERNAL_API_TOKEN ?= internal_dev_token
WS_ORIGIN ?= http://localhost:5173
UI_DIST ?=
MARKETDATA_DIR ?= db/marketdata
TELEGRAM_BOT_TOKEN ?=

.PHONY: db api migrate seed run ui env run-env dev

AIR_BIN := $(shell command -v air 2>/dev/null)
ifeq ($(AIR_BIN),)
GOBIN := $(shell go env GOBIN)
GOPATH := $(shell go env GOPATH)
AIR_BIN := $(if $(GOBIN),$(GOBIN)/air,$(GOPATH)/bin/air)
endif

db:
	docker compose up -d db

migrate:
	@set -e; \
	if [ -f .env ]; then set -a; . ./.env; set +a; fi; \
	for f in $$(ls db/migrations/*.sql | sort); do \
		echo "Applying $$f"; \
		psql "$${DB_DSN:-$(DB_DSN)}" -v ON_ERROR_STOP=1 -f "$$f"; \
	done

seed:
	DB_DSN="$(DB_DSN)" ./scripts/seed.sh

api:
	HTTP_ADDR="$(HTTP_ADDR)" DB_DSN="$(DB_DSN)" JWT_ISSUER="$(JWT_ISSUER)" JWT_SECRET="$(JWT_SECRET)" JWT_TTL="$(JWT_TTL)" INTERNAL_API_TOKEN="$(INTERNAL_API_TOKEN)" WS_ORIGIN="$(WS_ORIGIN)" TELEGRAM_BOT_TOKEN="$(TELEGRAM_BOT_TOKEN)" UI_DIST="$(UI_DIST)" MARKETDATA_DIR="$(MARKETDATA_DIR)" go run ./cmd/api

env:
	@set -a; . ./.env; set +a

run-env:
	@set -a; . ./.env; set +a; go run ./cmd/api

ui:
	cd ui && npm install && npm run dev

run: db migrate seed api

dev:
	@test -x "$(AIR_BIN)" || (echo "air not found. Install: go install github.com/air-verse/air@latest"; exit 1)
	@fuser -k 8080/tcp || true
	"$(AIR_BIN)"

build-ui:
	cd ui && npm install && npm run build

build-api:
	go build -o bin/server ./cmd/api

build: build-ui build-api
