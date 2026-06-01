# FinMitra AI — CLAUDE.md

> Describes the **actual codebase state as of 31 May 2026**.
> What exists and works today — not a target design.
> Read this before making any changes.

---

## 1. What This Product Is

**FinMitra AI** (consumer brand: **Hisaab AI**) is a WhatsApp-native AI CFO for Indian restaurant owners. Owners send bill photos, PDFs, and Hinglish text messages via WhatsApp. FinMitra parses them using Claude Vision, saves structured financial data to Supabase, and replies with real-time P&L summaries.

**Pilot customer:** Tea Day Munnekollal, Bengaluru (owner: Sutanu Kandar, +919886962078)

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.6 (App Router, TypeScript) |
| Hosting | Vercel (auto-deploys on push to `main`) |
| Database | Supabase (Postgres) — project ID: `nqjhlzztsaxnzzmkokoj` |
| WhatsApp | Twilio (sandbox: `whatsapp:+14155238886`) |
| AI | Anthropic Claude (`claude-sonnet-4-6`) |
| Excel parsing | SheetJS (`xlsx`) |
| CSV parsing | PapaParse (`papaparse`) |
| Styling | Tailwind CSS v4 |

---

## 3. Project Structure

```
app/
  api/
    webhook/
      route.ts                    ← Twilio WhatsApp entry point
      parser.ts                   ← Claude text intent parsing + Vision bill parsing
      types.ts                    ← Shared TypeScript interfaces
      handlers/
        textHandler.ts            ← Text intent → DB save or query dispatch
        mediaHandler.ts           ← Bill photo/PDF → parse → pending confirmation
        confirmationHandler.ts    ← haan/nahi/1/2/3 → save or delete
        queryHandler.ts           ← All P&L + item queries (11 intent types)
        queryFreeformHandler.ts   ← Layer 2 freeform: second Claude call with 90-day data
        deleteHandler.ts          ← "hata do" → pick entry → confirm_delete flow
      guards/
        contextGuard.ts           ← Keyword allowlist — blocks off-topic messages
        rateLimiter.ts            ← In-memory 30 msg/hr per phone (resets on cold start)
      services/
        dataService.ts            ← OLD STUB — DO NOT USE. Superseded by lib/db/dataService.ts
    backfill/
      route.ts                    ← POST: parse a bill file via Claude Vision
      confirm/route.ts            ← POST: save confirmed bill → upload_records + invoice_items + pnl_entries
      parse-excel/route.ts        ← POST: parse .xlsx → mapped entries (fixed or variable)
      parse-csv/route.ts          ← POST: parse PhonePe CSV → daily totals
      save-entries/route.ts       ← POST: bulk-save entries to pnl_entries via accumulatePnlEntry
    templates/
      [type]/route.ts             ← GET: sample Excel downloads (type=pnl or type=invoice)
  backfill/
    page.tsx                      ← Backfill Portal UI (3 tabs: Bills / Expenses / Sales)
  layout.tsx                      ← Default Next.js layout (title still "Create Next App")
  page.tsx                        ← Homepage — STILL DEFAULT BOILERPLATE, not built

lib/
  db/
    dataService.ts                ← ⭐ SINGLE SOURCE OF TRUTH for all Supabase operations
  data/
    pnlService.ts                 ← UNUSED / STALE helper — missing swiggy/zomato/sales. Do not use.

scripts/
  backfill-canonical.ts           ← One-time item_canonical backfill script

supabase/
  migrations/
    20260527000000_schema_v2.sql              ← Created v2 tables (financial_line_items, daily_pnl, etc.)
    20260528000001_add_item_canonical.sql     ← item_canonical + unit_normalised + quantity_normalised on invoice_items
    20260528000002_normalise_vendor_names.sql ← One-time vendor name normalisation on invoice_items
    20260528000003_pnl_entries_metadata.sql   ← Adds metadata JSONB column to pnl_entries
    20260531000001_granular_fixed_costs.sql   ← Adds pg/internet/garbage/repairs/marketing/misc to pnl_entries
```

---

## 4. Actual Database Schema

**The app reads and writes to the old schema** (`pnl_entries`, `upload_records`, `invoice_items`). The v2 tables (`financial_line_items`, `daily_pnl`, etc.) were created by migration 20260527 but **no application code writes to them yet**.

### `pnl_entries` — the primary working table

One row per `(restaurant_id, date)`. All monetary values are additive — rows are upserted with `ON CONFLICT (restaurant_id, date) DO UPDATE`.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | → restaurants |
| date | date | Business date YYYY-MM-DD; part of UNIQUE key |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| **sales** | numeric | Walk-in / cash / card / non-PhonePe revenue |
| **phonepe** | numeric | PhonePe QR revenue |
| **swiggy** | numeric | Swiggy delivery revenue or settlement |
| **zomato** | numeric | Zomato delivery revenue or settlement |
| **hyperpure** | numeric | Hyperpure food cost (excl. delivery fee) |
| **bigbasket** | numeric | BigBasket food cost |
| **milk** | numeric | Milk expense |
| **bread** | numeric | Bread expense |
| **water** | numeric | Water/Bisleri expense |
| **other** | numeric | Unclassified COGS + Hyperpure/BB delivery fees |
| **rent** | numeric | Shop rent |
| **electricity** | numeric | Electricity bill |
| **salary** | numeric | Staff wages |
| **gas** | numeric | LPG cylinders (variable, not fixed) |
| **fixed** | numeric | Legacy fixed bucket — use specific columns instead |
| **pg** | numeric | Staff PG / accommodation |
| **internet** | numeric | Internet / WiFi |
| **garbage** | numeric | Garbage / waste collection |
| **repairs** | numeric | Repairs / maintenance / AMC |
| **marketing** | numeric | Ads / promotions |
| **misc** | numeric | Miscellaneous fixed costs |
| **metadata** | jsonb | Source tracking per column: `{ "phonepe_sources": ["csv","whatsapp"] }` |

### `invoice_items` — line-item detail from parsed bills

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| vendor | text | Normalised name (see `normaliseVendor()` in dataService) |
| date | date | Bill date |
| item_name | text | Exact product name from invoice |
| item_canonical | text | Generic ingredient name set by Claude Vision (e.g. "Carrot") |
| unit_normalised | text | Kg / L / Pc |
| quantity_normalised | numeric | Qty in normalised unit |
| quantity | numeric | Raw quantity |
| unit | text | Raw unit string |
| rate | numeric | Per-unit price — never 0; derive `amount/quantity` if missing |
| amount | numeric | Line total |
| mapped_category | text | Always `"cogs"` for food items |
| upload_record_id | uuid FK | → upload_records (populated since 31 May 2026) |
| metadata | jsonb | `{ invoice_number: "..." }` |
| line_item_id | uuid FK nullable | → financial_line_items (v2, not yet populated) |
| upload_source_id | uuid FK nullable | → upload_sources (v2, not yet populated) |
| entry_date | date | v2 alias for date, not yet populated |
| tax_amount | numeric | GST if shown |
| invoice_number | text | |
| food_category | text | dairy / produce / dry / protein / beverage / packaging / supplies |
| deleted_at | timestamptz | Soft delete (delete flow not yet wired to this column) |

### `upload_records` — audit trail for confirmed bill uploads

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| date | date | Bill date (not upload time) |
| doc_type | text | `"invoice"` |
| source | text | `"whatsapp"` or `"backfill"` |
| amount | numeric | Full bill total including delivery |
| pnl_field | text | `"hyperpure"` / `"bigbasket"` / `"other"` |
| file_url | text | Original Twilio media URL |
| metadata | jsonb | `{ vendor: "...", delivery_fee: N }` |
| deleted_at | timestamptz | Soft delete |
| created_at | timestamptz | When uploaded — used to order `query_upload_history` |

### `pending_confirmations` — multi-step state (TTL: 10 min)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| action | text | One of the 5 values below |
| payload | jsonb | Varies by action |
| expires_at | timestamptz | now() + 10 minutes |
| created_at | timestamptz | |

**Action values used by the app** (⚠️ the DB migration's CHECK constraint only covers `confirm_bill|confirm_entry|confirm_delete` — the app writes 5 values; verify the constraint allows them all):
- `confirm_bill` — bill preview waiting for haan/nahi
- `confirm_text_entry` — duplicate text entry waiting for haan/nahi
- `confirm_delete` — specific delete entry waiting for haan/nahi
- `delete_pick` — multiple matches shown, waiting for 1/2/3
- `pnl_context` — stores `{ startDate, endDate, periodLabel }` for Level 2 P&L; **never a confirmation action** — confirmationHandler returns `false` immediately for this action

### `audit_log` — append-only event log

| Column | Type |
|---|---|
| id | uuid PK |
| restaurant_id | uuid FK |
| action | text (save / delete / duplicate_override / backfill / backfill_duplicate_override) |
| date_affected | date |
| pnl_field | text |
| amount_reversed | numeric |
| item_count_reversed | int |
| performed_by | text (owner / system / admin) |
| performed_at | timestamptz |
| upload_source_id | uuid FK nullable |
| line_item_id | uuid FK nullable |

### `restaurants`

| Column | Type |
|---|---|
| id | uuid PK |
| mobile | text UNIQUE (format: `+91XXXXXXXXXX`) |
| name | text |
| owner_name | text |
| created_at | timestamptz |

### V2 tables (exist in DB, no app code uses them yet)

Created by `20260527000000_schema_v2.sql`. No reads or writes from app code:
- `upload_sources` — planned replacement for `upload_records`
- `financial_line_items` — planned replacement for `pnl_entries`
- `revenue_entries` — separate revenue table
- `daily_pnl` — computed aggregation cache
- `monthly_item_spend` — ingredient analytics rollup
- `vendor_map` — seeded with known vendors, but no app code queries it
- `item_canonical_map` — no app code queries it

---

## 5. P&L Formula (actual column names)

```
Revenue      = sales + phonepe + swiggy + zomato
COGS         = hyperpure + bigbasket + milk + bread + water + other
Fixed        = rent + electricity + salary + gas + fixed
             + pg + internet + garbage + repairs + marketing + misc
Gross Profit = Revenue − COGS
Net Profit   = Gross Profit − Fixed
Margin %     = Gross Profit / Revenue × 100
```

**Two-level P&L display:**
- **Level 1** (`query_pnl`): 4-line summary — Total Sales / Item Cost / Fixed Cost / Profit. Also saves `pnl_context` to `pending_confirmations` so Level 2 can reuse the same period.
- **Level 2** (`query_pnl_detail`): full per-channel revenue, per-vendor COGS, per-line fixed costs. Fixed items ≥ ₹2,000 shown individually; smaller ones clubbed as "Others" (threshold constant `FIXED_THRESHOLD = 2000`).

`query_pnl_detail` resolves dates in two ways:
1. If `parsed.period` is present — resolves directly (no prior context needed)
2. If absent — falls back to `pnl_context` from `pending_confirmations`

---

## 6. WhatsApp Message Flow

```
POST /api/webhook
  ↓
Look up restaurant by mobile in restaurants table
  ↓
Guards (text messages only; media always bypasses):
  • Rate limiter: 30 msg/hr per phone (in-memory Map, resets on Vercel cold start)
  • Context guard: financial keyword allowlist (see contextGuard.ts)
  ↓
Priority dispatch:
  1. confirmationHandler  — body matches haan/nahi/yes/no/ha/nhi/1/2/3
     (pnl_context action returns false immediately — never confirmed)
  2. deleteHandler        — body matches /hata\s*do|hatao|\bdelete\b/i
  3. mediaHandler         — MediaUrl0 is present
  4. textHandler          — everything else
```

### Confirmation flow (bills)
- Photo/PDF → `mediaHandler` → `parser.parseMedia` → duplicate check (pending + upload_records) → send preview → `createPendingConfirmation('confirm_bill')`
- `haan` → `confirmationHandler` → `createUploadRecord` → `saveInvoiceItems` → `upsertPnlEntry` (food → vendor column, deliveryFee → `other`) → `writeAuditLog` → delete pending
- `nahi` → delete pending, nothing saved

### Text entry flow
- `textHandler` → `parser.parseTextMessage` → `checkDuplicateTextEntry`
- Duplicate found → `createPendingConfirmation('confirm_text_entry')` → warn user
- No duplicate → `accumulatePnlEntry` (adds to existing value, tracks source in metadata.`${column}_sources`)

### Delete flow
- `deleteHandler` — "hata do milk"
  - Date mentioned → single `confirm_delete` prompt
  - No date → fetch last 3 entries for that category → `delete_pick` picker (numbered list)
- `1`/`2`/`3` → `confirmationHandler` re-queues as `confirm_delete`
- `haan` → `zeroPnlColumn` → `writeAuditLog`

### P&L query flow
- `textHandler` → `parser.parseTextMessage` → structured intent → `queryHandler`
- Unknown / unmatched → `queryFreeformHandler` (second Claude call, 90-day data, `OUT_OF_SCOPE` sentinel)

### Delivery fee handling
- `parser.parseMedia` strips items matching `/delivery|shipping|freight|pay on delivery/i`
- Returns `delivery_fee` separately from `items[]`
- On confirm: `foodTotal = total − deliveryFee` → vendor pnl column; `deliveryFee` → accumulates in `other`

---

## 7. Intent Types (types.ts)

```typescript
intent:
  'add_entries'            // save text entries to pnl_entries
  'query_today'            // legacy — handled by query_pnl path
  'query_mtd'              // legacy — handled by query_pnl path
  'query_lastmonth'        // legacy — handled by query_pnl path
  'query_specific'         // single metric: sales/cogs/margins, multi-month support
  'query_pnl'              // Level 1: 4-line P&L summary for a period
  'query_pnl_detail'       // Level 2: full itemised breakdown
  'query_items'            // top ingredients by spend, optional vendor + date filter
  'query_ingredient'       // single ingredient deep-dive (invoice_items + pnl direct entries)
  'query_vendor_breakdown' // expense split by vendor from invoice_items
  'query_daily_breakdown'  // day-by-day values for one metric over a range
  'query_upload_history'   // recent bill uploads ordered by created_at DESC
  'query_freeform'         // Layer 2 fallback — second Claude call with 90-day P&L
  'help'
  'unknown'
```

---

## 8. lib/db/dataService.ts — the only DB layer

All modules must import from here. Never call Supabase directly from handlers.

| Method | What it does |
|---|---|
| `upsertPnlEntry(restaurantId, entry)` | SET columns in pnl_entries (not additive) |
| `getPnlData(restaurantId, start, end?)` | fetch pnl_entries rows for a date range |
| `accumulatePnlEntry(restaurantId, category, date, amount, source?)` | ADD to existing value; tracks source in metadata |
| `checkDuplicateTextEntry(restaurantId, category, date, amount)` | detects same amount already saved; checks metadata for csv source |
| `checkDuplicatePending(restaurantId, vendor, date, amount)` | checks pending_confirmations for in-flight duplicate bill (±5% tolerance) |
| `checkDuplicateBill(restaurantId, vendor, date, amount)` | checks upload_records for already-confirmed bill (±5% tolerance) |
| `createPendingConfirmation(restaurantId, payload, action)` | insert with 10-min TTL |
| `getPendingConfirmation(restaurantId)` | latest pending row (any action, ordered by created_at DESC) |
| `deletePendingConfirmation(restaurantId)` | deletes ALL pending rows for the restaurant |
| `createUploadRecord(restaurantId, data)` | insert into upload_records, returns `id` |
| `saveInvoiceItems(restaurantId, vendor, date, items[], uploadRecordId?)` | bulk insert with normalised vendor name |
| `zeroPnlColumn(restaurantId, category, date)` | sets one column to 0 (used by delete flow) |
| `writeAuditLog(restaurantId, data)` | append-only audit record |
| `getTopItemsBySpend(restaurantId, start, end?)` | aggregates invoice_items by item_name (not currently called by queryHandler) |

**`normaliseVendor(raw)`** (internal to dataService): maps Hyperpure/Zomato variants → `"Zomato Hyperpure Private Limited"`, BigBasket variants → `"BigBasket Now"`, DMart variants → `"DMart"`.

---

## 9. Backfill Portal (`/backfill`)

Three-tab React UI at `app/backfill/page.tsx`. **Restaurant ID is hardcoded** — no auth.

| Tab | Sub-tabs | APIs | What it does |
|---|---|---|---|
| Bills (PDF/Photo) | — | `/api/backfill` → `/api/backfill/confirm` | Claude Vision parses each file; review table; batch save |
| Expenses (Excel) | Fixed Costs / Variable+Daily | `/api/backfill/parse-excel` → `/api/backfill/save-entries` | .xlsx with Date/Item/Amount; maps item strings to pnl columns |
| Sales (CSV) | PhonePe / Swiggy (disabled) | `/api/backfill/parse-csv` → `/api/backfill/save-entries` | PhonePe only; aggregates completed transactions by date |

**Excel fixed cost mapping** (`mapFixedItem` in `parse-excel/route.ts`):
`rent`, `salary`/wages/arup/staff, `electricity`/bescom/current, `gas`/lpg/cylinder, `pg`/accommodation/hostel, `internet`/wifi/broadband, `garbage`/waste/cleaning, `repairs`/maintenance/amc, `marketing`/ads/promotion → anything else → `misc`

**Excel variable mapping** (`mapVariableItem`):
milk/doodh → `milk`, bread/bun/pav → `bread`, water/bisleri → `water` → anything else → `other`

**PhonePe CSV**: aggregates rows where `Transaction Status === "COMPLETED"`, grouped by date → `pnl_field: "phonepe"`. Handles `YYYY-MM-DD HH:MM:SS` and `DD/MM/YYYY HH:MM:SS` date formats.

Template downloads: `GET /api/templates/pnl` and `GET /api/templates/invoice` generate sample .xlsx files.

---

## 10. Key Rules — Never Break These

1. **Date format:** Always `YYYY-MM-DD` in Supabase. Claude Vision returns `DD-MM-YYYY` — always convert.
2. **IST date offset:** Vercel runs UTC. Use `new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0]` for today's date in queryHandler. Without this, pre-5:30 AM queries return yesterday's data.
3. **Single dataService:** All DB calls go through `lib/db/dataService.ts`. Never the old `app/api/webhook/services/dataService.ts`.
4. **pnl_entries upsert:** UNIQUE on `(restaurant_id, date)`. Always `ON CONFLICT DO UPDATE`.
5. **Accumulate vs set:** Text and backfill entries use `accumulatePnlEntry` (adds to existing). Only use `upsertPnlEntry` (sets/replaces) when you want to overwrite.
6. **Twilio media requires Basic Auth:** `Buffer.from('SID:TOKEN').toString('base64')`.
7. **pnl_context is read-only:** `confirmationHandler` returns `false` immediately for `action === 'pnl_context'`. Never treat it as a haan/nahi confirmation.
8. **Zomato ≠ Hyperpure:** Text entry "zomato 1800" → `pnl_entries.zomato` (revenue). Hyperpure bills come via photo and go to `pnl_entries.hyperpure` (COGS). Never conflate.
9. **Delivery fees go to `other`:** `foodTotal = total − deliveryFee` → vendor column; `deliveryFee` accumulates in `other`.
10. **`rate` in invoice_items is never 0.** Claude Vision is instructed to derive `amount / quantity` if rate is not on the bill.
11. **Duplicate detection has two layers:** (1) `pending_confirmations` check for in-flight duplicate (bill sent twice before confirming); (2) `upload_records` check for already-confirmed bills with ±5% amount tolerance.
12. **Never hardcode restaurant IDs in new code.** `b77ed758-9a72-4de2-9138-b353589c656d` appears only in legacy backfill UI and migration backfill SQL.

---

## 11. Environment Variables

```env
ANTHROPIC_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
SUPABASE_URL=               # https://nqjhlzztsaxnzzmkokoj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=  # Server only — bypasses RLS
SUPABASE_ANON_KEY=          # Client side — respects RLS (not currently used)
JWT_SECRET=
MSG91_KEY=
```

---

## 12. What's Built and Working

- WhatsApp webhook with full handler chain (text / media / confirmation / delete)
- Claude text intent parsing — 13 intent types in parser.ts
- Claude Vision media parsing (`parseMedia` + `parseMediaBase64`) for PDF and image
- Delivery fee separation from food COGS
- Two-layer duplicate detection (pending + upload_records, ±5% tolerance)
- `upload_records` row written on every confirmed bill
- `invoice_items` with `upload_record_id` FK on every confirmed bill
- P&L queries: today / yesterday / MTD / specific month / multi-month
- Two-level P&L: Level 1 (4-line summary) + Level 2 (full breakdown)
- `query_pnl_detail` with direct period resolution — no prior context required
- `query_specific`: single metrics, margin %, multi-month comparisons
- `query_items`: top ingredients by value/weight, vendor + date filtering
- `query_ingredient`: single ingredient across invoice_items + pnl direct entries
- `query_vendor_breakdown`: expense split by vendor
- `query_daily_breakdown`: day-by-day values for any metric (sales sums all revenue columns)
- `query_upload_history`: recent bill uploads ordered by `created_at`
- `query_freeform`: second Claude call with 90-day P&L data, `OUT_OF_SCOPE` sentinel
- Delete flow: "hata do" + single or multi-match picker
- Context guard: keyword allowlist blocks off-topic messages before token spend
- Rate limiter: 30 msg/hr per phone (in-memory)
- Backfill portal: bills (PDF/photo batch), fixed/variable expenses (Excel), PhonePe CSV
- Template downloads: `/api/templates/pnl` and `/api/templates/invoice`
- Granular fixed cost columns: pg, internet, garbage, repairs, marketing, misc
- Fixed cost smart display: items ≥ ₹2,000 shown individually; rest clubbed as "Others"
- Swiggy and Zomato revenue text entries map to their own pnl columns (not hyperpure)

---

## 13. What's Not Built Yet

| Feature | Notes |
|---|---|
| Homepage (`app/page.tsx`) | Still default Next.js boilerplate |
| Auth (OTP + JWT) | `JWT_SECRET` and `MSG91_KEY` defined but unused |
| Web dashboard | No P&L view, charts, or insights UI |
| Migration to v2 schema | v2 tables exist in DB but app still reads/writes pnl_entries |
| Rate limiter persistence | In-memory Map resets on Vercel cold start — needs Redis or Supabase |
| Swiggy CSV import | Backfill "Sales" tab has Swiggy sub-tab disabled ("Coming Soon") |
| Admin dashboard | |

---

## 14. Known Issues

| Issue | Location | Impact |
|---|---|---|
| Restaurant ID hardcoded | `app/backfill/page.tsx:6` | Backfill portal only works for pilot customer |
| Homepage is default boilerplate | `app/page.tsx` | Production URL shows "Create Next App" |
| `lib/data/pnlService.ts` is stale | Revenue formula missing swiggy/zomato/sales columns | Do not use — safe to delete |
| Old dataService not deleted | `app/api/webhook/services/dataService.ts` | Confusion risk; superseded by `lib/db/dataService.ts` |
| `pending_confirmations.action` CHECK constraint mismatch | v2 migration vs app code | Migration only lists `confirm_bill\|confirm_entry\|confirm_delete`; app also uses `confirm_text_entry`, `delete_pick`, `pnl_context` — verify constraint in Supabase dashboard |
| `deletePendingConfirmation` deletes ALL rows | `lib/db/dataService.ts` | Deletes every pending row for the restaurant at once — could interfere if two flows overlap |
| Rate limiter resets on cold start | `guards/rateLimiter.ts` | Each Vercel function instance has its own counter |
| `queryFreeformHandler` system prompt missing granular fixed columns | `handlers/queryFreeformHandler.ts:40` | Fixed column definition covers only rent/electricity/salary/fixed/gas — missing pg/internet/garbage/repairs/marketing/misc |
| `layout.tsx` title not updated | `app/layout.tsx` | Page title still shows "Create Next App" |
| Gas shown under fixed in P&L display | `queryHandler.ts FIXED_COLUMNS` | Gas (LPG, variable cost) is summed under Fixed in both Level 1 and Level 2 P&L |

---

## 15. Deployment

- Push to `main` → Vercel auto-deploys (~60 seconds)
- Production URL: `https://finmitra-ai.vercel.app`
- Vercel project: `prj_SnaW1IgfWaPoKxC6FrNCW1FQptGw`
- Supabase project: `nqjhlzztsaxnzzmkokoj`
- Twilio webhook URL: `https://finmitra-ai.vercel.app/api/webhook`
