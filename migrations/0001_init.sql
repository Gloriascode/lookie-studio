-- Lookie Studio schema. Ids are text UUIDs; timestamps are unix milliseconds.

CREATE TABLE creators (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_creator ON sessions(creator_id);

CREATE TABLE shops (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL UNIQUE REFERENCES creators(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE designs (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  media_type TEXT NOT NULL,
  arcade_reference_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX designs_creator ON designs(creator_id, created_at DESC);

CREATE TABLE patterns (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  design_id TEXT REFERENCES designs(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  arcade_job_id TEXT,
  arcade_pattern_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | succeeded | failed
  image_key TEXT,
  thumb_key TEXT,
  width INTEGER,
  height INTEGER,
  error TEXT,
  polled_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX patterns_creator ON patterns(creator_id, created_at DESC);
CREATE INDEX patterns_pending ON patterns(status, polled_at);

CREATE TABLE shop_products (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  pattern_id TEXT NOT NULL REFERENCES patterns(id),
  arcade_job_id TEXT,
  arcade_product_id TEXT,
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | succeeded | failed
  title TEXT,
  selection_label TEXT,
  unit_price_json TEXT,
  image_key TEXT,
  error TEXT,
  polled_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (shop_id, slot)
);
CREATE INDEX shop_products_shop ON shop_products(shop_id, status);
