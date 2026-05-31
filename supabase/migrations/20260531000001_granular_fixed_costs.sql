-- Add granular fixed cost columns
ALTER TABLE pnl_entries ADD COLUMN IF NOT EXISTS pg          NUMERIC(10,2) DEFAULT 0;
ALTER TABLE pnl_entries ADD COLUMN IF NOT EXISTS internet    NUMERIC(10,2) DEFAULT 0;
ALTER TABLE pnl_entries ADD COLUMN IF NOT EXISTS garbage     NUMERIC(10,2) DEFAULT 0;
ALTER TABLE pnl_entries ADD COLUMN IF NOT EXISTS repairs     NUMERIC(10,2) DEFAULT 0;
ALTER TABLE pnl_entries ADD COLUMN IF NOT EXISTS marketing   NUMERIC(10,2) DEFAULT 0;
ALTER TABLE pnl_entries ADD COLUMN IF NOT EXISTS misc        NUMERIC(10,2) DEFAULT 0;

-- Backfill: split existing fixed column for May 2026
-- PG ₹6,500 saved on 17 May (original xlsx date)
UPDATE pnl_entries SET pg = 6500, fixed = GREATEST(0, fixed - 6500)
WHERE restaurant_id = 'b77ed758-9a72-4de2-9138-b353589c656d'
AND date = '2026-05-17';

-- Internet ₹600 saved on 11 May
UPDATE pnl_entries SET internet = 600, fixed = GREATEST(0, fixed - 600)
WHERE restaurant_id = 'b77ed758-9a72-4de2-9138-b353589c656d'
AND date = '2026-05-11';

-- Garbage ₹500 saved on 10 May
UPDATE pnl_entries SET garbage = 500, fixed = GREATEST(0, fixed - 500)
WHERE restaurant_id = 'b77ed758-9a72-4de2-9138-b353589c656d'
AND date = '2026-05-10';

-- Note: apply this SQL manually in Supabase dashboard
