-- ============================================================
-- FinMitra AI — Schema v2 Migration
-- 27 May 2026
--
-- Strategy: additive / parallel. Old tables (pnl_entries,
-- upload_records) are NOT dropped. New tables are created
-- alongside them. Existing tables get new columns added.
-- Switch reads to new tables once backfill is verified.
-- ============================================================


-- ============================================================
-- TIER 1 — SOURCE
-- ============================================================

-- restaurants: add created_at if missing (table already exists)
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();


-- upload_sources: replaces upload_records
CREATE TABLE IF NOT EXISTS upload_sources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  source_type      text NOT NULL CHECK (source_type IN ('pdf','photo','excel','csv','text','voice')),
  doc_category     text NOT NULL CHECK (doc_category IN ('invoice','settlement','manual','voice_note')),
  vendor_raw       text,
  file_url         text,
  parse_status     text NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending','success','failed','skipped')),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','voided')),
  voided_at        timestamptz,
  order_reference  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_sources_restaurant
  ON upload_sources(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_upload_sources_created_at
  ON upload_sources(created_at DESC);


-- ============================================================
-- TIER 2 — FINANCIAL EVENTS
-- ============================================================

-- financial_line_items: core table — one row per confirmed event
CREATE TABLE IF NOT EXISTS financial_line_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id          uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  upload_source_id       uuid REFERENCES upload_sources(id) ON DELETE SET NULL,
  entry_date             date NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  cost_type              text NOT NULL CHECK (cost_type IN ('variable','fixed','revenue')),
  category               text NOT NULL,
  vendor_canonical       text,
  amount                 numeric(12,2) NOT NULL CHECK (amount >= 0),
  channel                text CHECK (channel IN ('swiggy','zomato','phonepe','walkin_cash','walkin_qr','dine_in','catering')),
  transaction_type       text NOT NULL DEFAULT 'invoice' CHECK (transaction_type IN ('invoice','credit_note','debit_note')),
  is_intercompany        bool NOT NULL DEFAULT false,
  classification_status  text NOT NULL DEFAULT 'classified' CHECK (classification_status IN ('classified','unclassified','skipped')),
  source_text            text,
  needs_review           bool NOT NULL DEFAULT false,
  cost_type_inferred     bool NOT NULL DEFAULT false,
  entry_method           text NOT NULL CHECK (entry_method IN ('whatsapp_realtime','whatsapp_backdate','backfill_excel','backfill_manual','system')),
  deleted_at             timestamptz,
  deleted_by             text CHECK (deleted_by IN ('owner','system','admin')),
  delete_reason          text CHECK (delete_reason IN ('owner_correction','duplicate','test'))
);

CREATE INDEX IF NOT EXISTS idx_fli_restaurant_date
  ON financial_line_items(restaurant_id, entry_date)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fli_restaurant_cost_type
  ON financial_line_items(restaurant_id, cost_type)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fli_needs_review
  ON financial_line_items(restaurant_id)
  WHERE needs_review = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fli_upload_source
  ON financial_line_items(upload_source_id);


-- invoice_items: add new v2 columns alongside existing ones
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS line_item_id      uuid REFERENCES financial_line_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS upload_source_id  uuid REFERENCES upload_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entry_date        date,
  ADD COLUMN IF NOT EXISTS item_canonical    text,
  ADD COLUMN IF NOT EXISTS tax_amount        numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_number    text,
  ADD COLUMN IF NOT EXISTS food_category     text CHECK (food_category IN ('dairy','produce','dry','protein','beverage','packaging','supplies')),
  ADD COLUMN IF NOT EXISTS deleted_at        timestamptz;

CREATE INDEX IF NOT EXISTS idx_invoice_items_line_item
  ON invoice_items(line_item_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_upload_source
  ON invoice_items(upload_source_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_active
  ON invoice_items(restaurant_id, entry_date)
  WHERE deleted_at IS NULL;


-- revenue_entries: revenue is structurally separate from costs
CREATE TABLE IF NOT EXISTS revenue_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  upload_source_id  uuid REFERENCES upload_sources(id) ON DELETE SET NULL,
  entry_date        date NOT NULL,
  channel           text NOT NULL CHECK (channel IN ('swiggy','zomato','phonepe','walkin_cash','walkin_qr','dine_in','catering')),
  gross_amount      numeric(12,2) NOT NULL DEFAULT 0,
  commission        numeric(12,2) NOT NULL DEFAULT 0,
  net_amount        numeric(12,2) GENERATED ALWAYS AS (gross_amount - commission) STORED,
  settlement_date   date,
  order_count       int,
  entry_method      text NOT NULL CHECK (entry_method IN ('whatsapp_realtime','whatsapp_backdate','backfill_excel','backfill_manual','system')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_revenue_restaurant_date
  ON revenue_entries(restaurant_id, entry_date)
  WHERE deleted_at IS NULL;


-- ============================================================
-- TIER 3 — AGGREGATION
-- ============================================================

-- daily_pnl: computed cache — NEVER manually written
-- Recomputed on every confirmed save or delete via application logic
CREATE TABLE IF NOT EXISTS daily_pnl (
  restaurant_id  uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  date           date NOT NULL,
  total_revenue  numeric(12,2) NOT NULL DEFAULT 0,
  total_cogs     numeric(12,2) NOT NULL DEFAULT 0,
  total_fixed    numeric(12,2) NOT NULL DEFAULT 0,
  other_expense  numeric(12,2) NOT NULL DEFAULT 0,
  gross_profit   numeric(12,2) GENERATED ALWAYS AS (total_revenue - total_cogs) STORED,
  net_profit     numeric(12,2) GENERATED ALWAYS AS (total_revenue - total_cogs - total_fixed) STORED,
  margin_pct     numeric(6,2)  GENERATED ALWAYS AS (
                   CASE WHEN total_revenue = 0 THEN 0
                        ELSE ROUND((total_revenue - total_cogs) / total_revenue * 100, 2)
                   END
                 ) STORED,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_pnl_restaurant_date
  ON daily_pnl(restaurant_id, date DESC);


-- monthly_item_spend: ingredient analytics rollup
CREATE TABLE IF NOT EXISTS monthly_item_spend (
  restaurant_id     uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  month             text NOT NULL,  -- YYYY-MM
  item_canonical    text NOT NULL,
  food_category     text,
  total_qty         numeric(12,3) NOT NULL DEFAULT 0,
  total_spend       numeric(12,2) NOT NULL DEFAULT 0,
  avg_rate          numeric(12,2) GENERATED ALWAYS AS (
                      CASE WHEN total_qty = 0 THEN 0
                           ELSE ROUND(total_spend / total_qty, 2)
                      END
                    ) STORED,
  vendor_breakdown  jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (restaurant_id, month, item_canonical)
);


-- ============================================================
-- TIER 4 — SUPPORT
-- ============================================================

-- vendor_map: raw vendor string → canonical name → P&L column
-- Add rows here instead of deploying code for new vendors
CREATE TABLE IF NOT EXISTS vendor_map (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_raw       text NOT NULL,
  vendor_canonical text NOT NULL,
  cost_type        text NOT NULL CHECK (cost_type IN ('variable','fixed','revenue')),
  pnl_column       text NOT NULL,
  category         text NOT NULL,
  confidence_score numeric(3,2) NOT NULL DEFAULT 1.0 CHECK (confidence_score BETWEEN 0 AND 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_map_raw
  ON vendor_map(lower(vendor_raw));

-- Seed known vendors
INSERT INTO vendor_map (vendor_raw, vendor_canonical, cost_type, pnl_column, category, confidence_score) VALUES
  ('Zomato Hyperpure Private Limited', 'Hyperpure', 'variable', 'hyperpure',  'cogs_food_dry',    1.0),
  ('Hyperpure by Zomato',              'Hyperpure', 'variable', 'hyperpure',  'cogs_food_dry',    1.0),
  ('Hyperpure',                        'Hyperpure', 'variable', 'hyperpure',  'cogs_food_dry',    1.0),
  ('BigBasket',                        'BigBasket', 'variable', 'bigbasket',  'cogs_food_dry',    1.0),
  ('BB B2B',                           'BigBasket', 'variable', 'bigbasket',  'cogs_food_dry',    1.0),
  ('BBNow',                            'BigBasket', 'variable', 'bigbasket',  'cogs_food_dry',    1.0),
  ('Innovative Retail Concepts',       'BigBasket', 'variable', 'bigbasket',  'cogs_food_dry',    1.0),
  ('DMart',                            'DMart',     'variable', 'other',      'other_expense',    0.8),
  ('Metro',                            'Metro',     'variable', 'other',      'other_expense',    0.8),
  ('Swiggy',                           'Swiggy',    'revenue',  'swiggy',     'delivery_swiggy',  1.0),
  ('Zomato',                           'Zomato',    'revenue',  'zomato',     'delivery_zomato',  1.0)
ON CONFLICT DO NOTHING;


-- item_canonical_map: normalise vendor item names for cross-vendor comparison
CREATE TABLE IF NOT EXISTS item_canonical_map (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_raw         text NOT NULL,
  item_canonical   text NOT NULL,
  food_category    text CHECK (food_category IN ('dairy','produce','dry','protein','beverage','packaging','supplies')),
  unit_normalised  text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_item_canonical_map_raw
  ON item_canonical_map(lower(item_raw));


-- pending_confirmations: add action column (TTL logic unchanged — enforced in app)
ALTER TABLE pending_confirmations
  ADD COLUMN IF NOT EXISTS action text
    CHECK (action IN ('confirm_bill','confirm_entry','confirm_delete'))
    DEFAULT 'confirm_bill';


-- audit_log: add v2 columns
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS upload_source_id    uuid REFERENCES upload_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS line_item_id        uuid REFERENCES financial_line_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amount_reversed     numeric(12,2),
  ADD COLUMN IF NOT EXISTS item_count_reversed int,
  ADD COLUMN IF NOT EXISTS date_affected       date,
  ADD COLUMN IF NOT EXISTS performed_by        text CHECK (performed_by IN ('owner','system','admin')),
  ADD COLUMN IF NOT EXISTS performed_at        timestamptz NOT NULL DEFAULT now();
