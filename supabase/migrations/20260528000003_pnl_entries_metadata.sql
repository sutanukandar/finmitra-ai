-- Add metadata JSONB column to pnl_entries for source tracking
-- Run this in the Supabase dashboard SQL editor (project: nqjhlzztsaxnzzmkokoj)
-- No Supabase CLI needed — one statement only.

ALTER TABLE pnl_entries ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- metadata structure per pnl column:
-- { "phonepe_sources": ["csv", "whatsapp"], "rent_sources": ["backfill"] }
-- Each column tracks its own sources array independently.
