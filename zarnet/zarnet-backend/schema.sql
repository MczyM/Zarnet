-- Zarnet token-based captive portal — multi-site schema (Postgres)
-- One deployment serves every client site (hostel / school / business).
-- Every operational table is scoped by site_id so sites never see each other's data.

CREATE TABLE IF NOT EXISTS sites (
  id                        SERIAL PRIMARY KEY,
  slug                      TEXT UNIQUE NOT NULL,           -- e.g. 'sunset-backpackers'
  name                      TEXT NOT NULL,                  -- e.g. 'Sunset Backpackers'
  contact_email             TEXT,
  status                    TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','paused')),

  -- Branding shown on that site's captive portal / pricing page
  brand_accent_color        TEXT NOT NULL DEFAULT '#B6FF3C',
  brand_logo_text           TEXT,

  -- This site's own Omada controller (each client has their own hardware)
  omada_base_url            TEXT,
  omada_controller_id       TEXT,
  omada_site_id             TEXT,
  omada_operator_username   TEXT,
  omada_operator_password   TEXT,
  omada_allow_self_signed   BOOLEAN NOT NULL DEFAULT true,

  -- Solana wallet this site's operator controls. Every redemption settles
  -- an on-chain ZRT transfer to this address — it is the client's own
  -- auditable revenue/access ledger, never the end customer's wallet.
  solana_wallet_address     TEXT,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS packages (
  id              SERIAL PRIMARY KEY,
  site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,                -- unique per site, not globally
  name            TEXT NOT NULL,
  device_limit    INTEGER NOT NULL,
  duration_hours  INTEGER NOT NULL,
  speed_mbps      INTEGER NOT NULL DEFAULT 100,
  price_zar_cents INTEGER NOT NULL,
  zrt_amount      NUMERIC(20,6) NOT NULL,        -- ZRT settled on-chain per redemption of this package
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (site_id, slug)
);

CREATE TABLE IF NOT EXISTS vouchers (
  id                 SERIAL PRIMARY KEY,
  site_id            INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  code               TEXT UNIQUE NOT NULL,        -- human-entered code, e.g. ZN-8F2K-93QX
  package_id         INTEGER NOT NULL REFERENCES packages(id),
  status             TEXT NOT NULL DEFAULT 'unused'
                       CHECK (status IN ('unused','active','expired','revoked')),
  payment_method     TEXT NOT NULL DEFAULT 'solana'
                       CHECK (payment_method IN ('solana','cash_reseller')),
  solana_tx_sig      TEXT,                        -- customer's own wallet payment, if they paid live
  payment_reference  TEXT,                        -- Solana Pay reference pubkey used to find the tx
  reseller_batch     TEXT,                        -- batch id if sold offline via a reseller/store
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  redeemed_at        TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devices (
  id              SERIAL PRIMARY KEY,
  site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  mac_address     TEXT NOT NULL,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, mac_address)
);

CREATE TABLE IF NOT EXISTS sessions (
  id              SERIAL PRIMARY KEY,
  site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  voucher_id      INTEGER NOT NULL REFERENCES vouchers(id),
  device_id       INTEGER NOT NULL REFERENCES devices(id),
  authorized_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  UNIQUE (voucher_id, device_id)
);

-- Async on-chain settlement queue. A row is inserted in the SAME transaction
-- that activates a voucher, so a redemption is never lost even if the process
-- crashes before it reaches the chain. The settlement worker drains this table.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id                 SERIAL PRIMARY KEY,
  site_id            INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  voucher_id         INTEGER NOT NULL REFERENCES vouchers(id),
  zrt_amount         NUMERIC(20,6) NOT NULL,
  destination_wallet TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','confirmed','failed')),
  tx_signature       TEXT,
  attempts           INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS admin_users (
  id              SERIAL PRIMARY KEY,
  site_id         INTEGER REFERENCES sites(id) ON DELETE CASCADE,  -- NULL = super admin (sees every site)
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'operator'
                    CHECK (role IN ('super_admin','operator')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_packages_site ON packages(site_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_site ON vouchers(site_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);
CREATE INDEX IF NOT EXISTS idx_sessions_voucher ON sessions(voucher_id);
CREATE INDEX IF NOT EXISTS idx_ledger_status ON ledger_entries(status);
CREATE INDEX IF NOT EXISTS idx_ledger_site ON ledger_entries(site_id);

-- A demo/pilot site so the API works out of the box after migrate + seed.
INSERT INTO sites (slug, name, contact_email, brand_logo_text, solana_wallet_address)
VALUES ('demo', 'Zarnet Demo Site', 'pilot@zarnet.online', 'Zarnet', NULL)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO packages (site_id, slug, name, device_limit, duration_hours, speed_mbps, price_zar_cents, zrt_amount)
SELECT id, v.slug, v.name, v.device_limit, v.duration_hours, v.speed_mbps, v.price_zar_cents, v.zrt_amount
FROM sites, (VALUES
  ('solo-day',       'Solo Day',       1, 24,   100,   500,  5.0),
  ('home-day',       'Home Day',       5, 24,   100,  1500, 15.0),
  ('solo-month',     'Solo Month',     1, 720,  100, 12000, 120.0),
  ('home-month',     'Home Month',     5, 720,  100, 20000, 200.0),
  ('business-month', 'Business Month', 10, 720, 100, 35000, 350.0)
) AS v(slug, name, device_limit, duration_hours, speed_mbps, price_zar_cents, zrt_amount)
WHERE sites.slug = 'demo'
ON CONFLICT (site_id, slug) DO NOTHING;
