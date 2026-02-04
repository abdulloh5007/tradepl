#!/usr/bin/env bash
set -euo pipefail
DB_DSN=${DB_DSN:-postgres://postgres:postgres@localhost:5432/lvtrade?sslmode=disable}
psql "$DB_DSN" -f db/seeds/001_seed.sql
