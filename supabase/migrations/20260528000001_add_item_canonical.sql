-- Add item_canonical column to invoice_items
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS item_canonical TEXT;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS unit_normalised TEXT;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS quantity_normalised NUMERIC;

-- Index for fast ingredient queries
CREATE INDEX IF NOT EXISTS idx_invoice_items_canonical
ON invoice_items (restaurant_id, item_canonical, date);

-- Backfill existing rows using item_name as a fallback
-- (will be properly populated by Claude going forward)
UPDATE invoice_items
SET item_canonical = TRIM(
  REGEXP_REPLACE(
    REGEXP_REPLACE(item_name, '\d+(\.\d+)?\s*(g|kg|ml|l|gm|GM|KG|ML|L|Kg|Gm|pcs|Pcs|PCS|pc|Pc|PC|pack|Pack|PACK)\b', '', 'gi'),
    '\s*[-–]\s*\w+.*$', '', 'g'
  )
)
WHERE item_canonical IS NULL;
