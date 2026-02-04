create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists user_credentials (
  user_id uuid primary key references users(id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,
  precision int not null
);

create table if not exists trading_pairs (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,
  base_asset_id uuid not null references assets(id),
  quote_asset_id uuid not null references assets(id),
  price_precision int not null,
  qty_precision int not null,
  min_qty numeric not null default 0,
  min_notional numeric not null default 0,
  status text not null
);

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null,
  owner_user_id uuid null references users(id) on delete cascade,
  asset_id uuid not null references assets(id),
  kind text not null,
  created_at timestamptz not null default now(),
  unique (owner_type, owner_user_id, asset_id, kind)
);

create table if not exists ledger_txs (
  id uuid primary key default gen_random_uuid(),
  ref text,
  created_at timestamptz not null
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  tx_id uuid not null references ledger_txs(id),
  account_id uuid not null references accounts(id),
  amount numeric not null,
  entry_type text not null,
  created_at timestamptz not null,
  sequence bigserial not null,
  prev_hash bytea,
  hash bytea
);

create index if not exists idx_ledger_entries_account on ledger_entries(account_id);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  pair_id uuid not null references trading_pairs(id),
  side text not null,
  type text not null,
  status text not null,
  price numeric,
  qty numeric not null,
  remaining_qty numeric not null,
  quote_amount numeric,
  remaining_quote numeric,
  reserved_amount numeric not null,
  spent_amount numeric not null,
  time_in_force text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_orders_match_sell on orders(pair_id, side, price, created_at, id) where side = 'sell';
create index if not exists idx_orders_match_buy on orders(pair_id, side, price, created_at, id) where side = 'buy';
create index if not exists idx_orders_status on orders(status);

create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references trading_pairs(id),
  price numeric not null,
  qty numeric not null,
  taker_order_id uuid not null references orders(id),
  maker_order_id uuid not null references orders(id),
  created_at timestamptz not null,
  sequence bigserial not null
);

create index if not exists idx_trades_pair on trades(pair_id, sequence);

create table if not exists order_fills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  trade_id uuid not null references trades(id),
  qty numeric not null,
  price numeric not null,
  created_at timestamptz not null
);

create index if not exists idx_order_fills_order on order_fills(order_id);
