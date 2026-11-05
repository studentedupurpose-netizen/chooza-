CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS accounts (
  user_id UUID NOT NULL REFERENCES users(id),
  asset TEXT NOT NULL,
  available NUMERIC(36,18) NOT NULL DEFAULT 0 CHECK (available >= 0),
  locked NUMERIC(36,18) NOT NULL DEFAULT 0 CHECK (locked >= 0),
  PRIMARY KEY(user_id, asset)
);
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  type TEXT NOT NULL CHECK (type IN ('limit')),
  price NUMERIC(36,18) NOT NULL CHECK (price > 0),
  quantity NUMERIC(36,18) NOT NULL CHECK (quantity > 0),
  remaining NUMERIC(36,18) NOT NULL CHECK (remaining >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','filled','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_book_idx ON orders(symbol, side, price, created_at) WHERE status IN ('open','partial');
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  maker_order_id UUID NOT NULL REFERENCES orders(id),
  taker_order_id UUID NOT NULL REFERENCES orders(id),
  maker_user_id UUID NOT NULL REFERENCES users(id),
  taker_user_id UUID NOT NULL REFERENCES users(id),
  price NUMERIC(36,18) NOT NULL,
  quantity NUMERIC(36,18) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  asset TEXT NOT NULL,
  amount NUMERIC(36,18) NOT NULL,
  entry_type TEXT NOT NULL,
  reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Authenticated customer wallet requests. These records do NOT move or credit funds.
CREATE TABLE IF NOT EXISTS wallet_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  request_type TEXT NOT NULL CHECK (request_type IN ('deposit','withdrawal')),
  asset TEXT NOT NULL CHECK (asset IN ('USDT','BTC','ETH')),
  network TEXT NOT NULL CHECK (network IN ('TRC20','ERC20','BEP20','Bitcoin','Ethereum')),
  amount NUMERIC(36,18) NOT NULL CHECK (amount > 0),
  wallet_address TEXT,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','under_review','rejected','completed_recorded')),
  admin_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((request_type='deposit' AND tx_hash IS NOT NULL AND wallet_address IS NULL) OR (request_type='withdrawal' AND wallet_address IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS wallet_requests_user_idx ON wallet_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_requests_status_idx ON wallet_requests(status, created_at);
