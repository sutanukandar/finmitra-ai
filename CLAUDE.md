# FinMitra AI — CLAUDE.md

> This file gives Claude Code instant full context of the project.
> Read this before making any changes.
> Last updated: 27 May 2026 — includes full schema redesign from architecture session.

---

## 1. What This Product Is

**FinMitra AI** (consumer brand: **Hisaab AI**) is a WhatsApp-native AI CFO for Indian restaurant and cafe owners.

Restaurant owners send bill photos, PDFs, and Hinglish text messages via WhatsApp. FinMitra parses them using Claude Vision, saves structured financial data to Supabase, and replies with a real-time P&L summary.

**Pilot customer:** Tea Day Munnekollal, Bengaluru (owner: Sutanu Kandar, +919886962078)
**Full schema design doc in Notion:** https://www.notion.so/36da4e194e4381538028d985c2db96de

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
| Styling | Tailwind CSS v4 |

---

## 3. Project Structure

```
app/
  api/
    webhook/
      route.ts                  ← Twilio WhatsApp webhook entry point
      parser.ts                 ← Claude text + Vision parsing
      types.ts                  ← Shared TypeScript interfaces
      handlers/
        textHandler.ts          ← Text message intent → DB save
        mediaHandler.ts         ← Bill photo/PDF → parse → confirmation flow
        confirmationHandler.ts  ← haan/nahi/hata do logic → save/delete
        queryHandler.ts         ← P&L queries (aaj/kal/MTD/projected)
    backfill/
      route.ts                  ← Backfill API (JSON manual entry + Excel upload)
  backfill/
    page.tsx                    ← Backfill Wizard UI (manual + Excel upload)
  page.tsx                      ← Homepage (NOT BUILT — still default boilerplate)

lib/
  db/
    dataService.ts              ← ⭐ SINGLE SOURCE OF TRUTH for all Supabase operations
                                   All modules must import from here. Never call Supabase directly.
```

---

## 4. Database Schema — TARGET DESIGN (v2)

> ⚠️ The current production DB still uses the OLD schema (pnl_entries, upload_records).
> The schema below is the TARGET. Migration SQL needs to be written and applied.
> Do NOT build new features against the old schema. Build against this target.

The schema has 4 tiers. Full design doc: https://www.notion.so/36da4e194e4381538028d985c2db96de

### TIER 1 — SOURCE

#### `restaurants`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| mobile | text UNIQUE | Format: +91XXXXXXXXXX |
| name | text | |
| owner_name | text | |
| city | text | |
| role | text | default 'owner' |
| digest_enabled | bool | Daily WhatsApp digest toggle |
| timezone | text | default 'Asia/Kolkata' |
| created_at | timestamptz | |

#### `upload_sources`
Every bill/photo/PDF/text/voice that arrives. Written immediately on receipt, before parsing. File is NEVER deleted even after voiding.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | → restaurants |
| source_type | text | `pdf\|photo\|excel\|csv\|text\|voice` |
| doc_category | text | `invoice\|settlement\|manual\|voice_note` |
| vendor_raw | text | Raw string from Claude parse |
| file_url | text | S3/Supabase Storage URL — never deleted |
| parse_status | text | `pending\|success\|failed\|skipped` |
| status | text | `active\|voided` |
| voided_at | timestamptz | Set when owner deletes bill |
| order_reference | text | Links Hyperpure Bill of Supply + Tax Invoice for same order |
| created_at | timestamptz | |

### TIER 2 — FINANCIAL EVENTS

#### `financial_line_items` ⭐ THE CORE TABLE
One row per confirmed financial event (bill, manual entry, rent payment, Swiggy settlement).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| upload_source_id | uuid FK nullable | NULL for manual text entries |
| entry_date | date | Business date the expense occurred — YYYY-MM-DD |
| created_at | timestamptz | When it was logged into system (always NOW()) |
| cost_type | text | `variable\|fixed\|revenue` |
| category | text | See Category Taxonomy section below |
| vendor_canonical | text | Normalised via vendor_map |
| amount | numeric | INR, always positive |
| channel | text | `swiggy\|zomato\|phonepe\|walkin_cash\|walkin_qr\|dine_in` — for revenue rows |
| transaction_type | text | `invoice\|credit_note\|debit_note` |
| is_intercompany | bool | true for Tea Day company → outlet transfers |
| classification_status | text | `classified\|unclassified\|skipped` |
| source_text | text | Raw WhatsApp message e.g. "expense 2000" |
| needs_review | bool | true when category unknown — shows in admin digest |
| cost_type_inferred | bool | true when cost_type was guessed not confirmed |
| entry_method | text | `whatsapp_realtime\|whatsapp_backdate\|backfill_excel\|backfill_manual\|system` |
| deleted_at | timestamptz | Soft delete. NULL = active |
| deleted_by | text | `owner\|system\|admin` |
| delete_reason | text | `owner_correction\|duplicate\|test` |

#### `invoice_items`
Line-by-line item detail for parsed bills. Hangs off financial_line_items.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| line_item_id | uuid FK | → financial_line_items |
| upload_source_id | uuid FK | → upload_sources. CASCADE DELETE key |
| entry_date | date | YYYY-MM-DD |
| item_name | text | Raw name e.g. "Nandini Toned Milk 5L Poly" |
| item_canonical | text | Normalised e.g. "Toned Milk" |
| quantity | numeric | |
| unit | text | Kg, Pc, L, etc. |
| rate | numeric | Per-unit price. NEVER save as 0. Derive: amount/quantity if not on bill |
| amount | numeric | Line total |
| tax_amount | numeric | GST if shown |
| invoice_number | text | |
| food_category | text | `dairy\|produce\|dry\|protein\|beverage\|packaging\|supplies` |
| mapped_category | text | `cogs` for food items. NEVER `fixed` for food |
| deleted_at | timestamptz | Soft deleted when parent bill is deleted |

#### `revenue_entries`
Revenue is structurally different from costs — separate table.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| upload_source_id | uuid FK nullable | |
| entry_date | date | |
| channel | text | `swiggy\|zomato\|phonepe\|walkin_cash\|walkin_qr\|dine_in\|catering` |
| gross_amount | numeric | Before commission |
| commission | numeric | Platform fee (Swiggy/Zomato ~20-25%) |
| net_amount | numeric | gross_amount - commission |
| settlement_date | date | When money hits bank (may differ from entry_date) |
| order_count | int | |
| entry_method | text | Same enum as financial_line_items |
| deleted_at | timestamptz | |

### TIER 3 — AGGREGATION

#### `daily_pnl`
Computed cache. NEVER manually written. Recomputed on every confirmed save or delete.

| Column | Type | Notes |
|---|---|---|
| restaurant_id | uuid FK | |
| date | date | UNIQUE with restaurant_id |
| total_revenue | numeric | |
| total_cogs | numeric | |
| total_fixed | numeric | |
| other_expense | numeric | Unclassified expenses bucket |
| gross_profit | numeric | total_revenue - total_cogs |
| net_profit | numeric | gross_profit - total_fixed |
| margin_pct | numeric | gross_profit / total_revenue × 100 |
| computed_at | timestamptz | When last recomputed |

#### `monthly_item_spend`
Rolled up from invoice_items. Powers ingredient analytics.

| Column | Type | Notes |
|---|---|---|
| restaurant_id | uuid FK | |
| month | text | YYYY-MM |
| item_canonical | text | |
| food_category | text | |
| total_qty | numeric | |
| total_spend | numeric | |
| avg_rate | numeric | total_spend / total_qty |
| vendor_breakdown | jsonb | e.g. {"Hyperpure": 6300, "BigBasket": 2520} |

UNIQUE on (restaurant_id, month, item_canonical).

### TIER 4 — SUPPORT

#### `vendor_map`
Maps raw vendor strings → canonical names → P&L columns. Add new vendors here, no code deploy needed.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| vendor_raw | text | e.g. "Hyperpure by Zomato", "BB B2B" |
| vendor_canonical | text | e.g. "Hyperpure", "BigBasket" |
| cost_type | text | `variable\|fixed\|revenue` |
| pnl_column | text | e.g. `hyperpure`, `bigbasket`, `other` |
| category | text | e.g. `cogs_food_dry`, `cogs_delivery_fee` |
| confidence_score | numeric | 0.0–1.0. Below 0.7 → ask owner to confirm |

#### `item_canonical_map`
Normalises vendor-specific item names for cross-vendor comparison.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| item_raw | text | e.g. "Nandini Toned Milk 5L Poly" |
| item_canonical | text | e.g. "Toned Milk" |
| food_category | text | dairy, produce, dry, protein, beverage |
| unit_normalised | text | Standard unit for comparison |

#### `pending_confirmations`
Temporary. TTL 10 minutes. Cleared on haan/nahi reply.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| payload | jsonb | Full parsed result: vendor, date, total, items[] |
| action | text | `confirm_bill\|confirm_entry\|confirm_delete` |
| expires_at | timestamptz | NOW() + 10 minutes |
| created_at | timestamptz | |

#### `audit_log`
Append-only. NOTHING is ever deleted from here. GST compliance record.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| action | text | `save\|delete\|delete_bill\|reclassify\|backdate` |
| upload_source_id | uuid FK nullable | |
| line_item_id | uuid FK nullable | |
| amount_reversed | numeric | For delete actions |
| item_count_reversed | int | For bill deletes |
| date_affected | date | Business date whose P&L changed |
| performed_by | text | `owner\|system\|admin` |
| performed_at | timestamptz | |

---

## 5. Category Taxonomy

Valid values for `financial_line_items.category`:

```
REVENUE
  delivery_swiggy | delivery_zomato | delivery_other
  walkin_qr | walkin_cash | dine_in | catering

VARIABLE COST (cost_type = 'variable')
  cogs_food_produce      ← vegetables, fruits
  cogs_food_dairy        ← milk, paneer, butter, curd
  cogs_food_dry          ← rice, dal, flour, spices, coffee, tea
  cogs_food_protein      ← chicken, eggs, fish
  cogs_beverage          ← juices, cold drinks, soda, water
  cogs_packaging         ← boxes, bags, cups, straws, napkins
  cogs_supplies          ← dishwash soap, cleaning materials
  cogs_fuel              ← LPG gas cylinder (variable NOT fixed)
  cogs_delivery_fee      ← Hyperpure delivery charges (separate line item on every HP invoice)
  delivery_commission    ← Swiggy/Zomato platform commission
  other_expense          ← Unclassified (pending review)

FIXED COST (cost_type = 'fixed')
  fixed_rent             ← Shop rent (₹20-22k/month)
  fixed_staff_pg         ← Staff accommodation / PG (₹6,500/month) — NOT same as rent
  fixed_salary           ← Staff wages
  fixed_electricity
  fixed_water
  fixed_internet
  fixed_garbage
  fixed_maintenance
  fixed_other
```

**⚠️ Gas = variable (cogs_fuel), NOT fixed.** LPG cylinder scales with usage.
**⚠️ PG ≠ Rent.** Staff accommodation is `fixed_staff_pg`, shop rent is `fixed_rent`.

---

## 6. P&L Formula

```
Revenue      = SUM of all revenue_entries.net_amount for the date
COGS         = SUM of financial_line_items WHERE cost_type = 'variable'
Fixed        = SUM of financial_line_items WHERE cost_type = 'fixed'
Gross Profit = Revenue − COGS
Net Profit   = Gross Profit − Fixed
Margin %     = Gross Profit / Revenue × 100
```

### MTD Query (hits daily_pnl — one fast read):
```sql
SELECT SUM(total_revenue), SUM(total_cogs), SUM(total_fixed),
       SUM(gross_profit), SUM(net_profit)
FROM daily_pnl
WHERE restaurant_id = $1
  AND date >= DATE_TRUNC('month', CURRENT_DATE)
  AND date <= CURRENT_DATE;
```

### Projected P&L (Node.js math, no extra DB call):
```
daily_avg_rev  = MTD_revenue / days_with_data
daily_avg_cogs = MTD_cogs / days_with_data
projected_rev  = daily_avg_rev × days_in_month
projected_cogs = daily_avg_cogs × days_in_month
projected_net  = (projected_rev - projected_cogs) - MTD_fixed
confidence     = days_with_data / days_in_month × 100
```
Use `days_with_data` (actual rows), NOT calendar days. Fixed costs are already fully known — don't project them.

---

## 7. Critical Rules — Never Break These

1. **Date format:** Always `YYYY-MM-DD` in Supabase. Claude returns `DD-MM-YYYY` — always convert.
2. **`entry_date` ≠ `created_at`:** `entry_date` = business date. `created_at` = when logged. Always separate.
3. **Single dataService:** All DB calls go through `lib/db/dataService.ts`. Never the old `app/api/webhook/services/dataService.ts`.
4. **Upsert on daily_pnl:** UNIQUE on `(restaurant_id, date)`. Always `ON CONFLICT DO UPDATE`.
5. **Never hard-delete:** Every financial row has `deleted_at`. NULL = active. All queries: `WHERE deleted_at IS NULL`.
6. **Atomic transactions:** save/delete = line item + daily_pnl recompute + audit_log in ONE transaction. Never partial.
7. **`upload_source_id` is the cascade key:** Bill delete = cascade soft-delete all invoice_items via this FK.
8. **Never hardcode restaurant IDs.** `b77ed758-9a72-4de2-9138-b353589c656d` is pilot-only temp.
9. **Twilio media requires Basic Auth:** `Buffer.from('SID:TOKEN').toString('base64')`.
10. **`mapped_category = 'cogs'` for all food items.** Never `'fixed'` for food.
11. **`rate` in invoice_items is never 0.** Derive: `amount / quantity` if not on bill.

---

## 8. WhatsApp Flow

```
User sends message
  → route.ts reads formData (From, Body, MediaUrl0, MediaContentType0)
  → Look up restaurant by mobile
  → Priority:
      1. 'haan'/'nahi'/'hata do'  → confirmationHandler
      2. MediaUrl0 present         → mediaHandler → parser.parseMedia → pending_confirmations
      3. Text message              → textHandler → parser.parseTextMessage → financial_line_items
```

### Confirmation flow (bills):
- Upload → parsed → `pending_confirmations` → preview sent
- `haan` → save to `invoice_items` + `financial_line_items` + recompute `daily_pnl` → delete confirmation
- `nahi` → delete confirmation, nothing saved

### Delete flow (`hata do`):
- Find entry by vendor + date in `financial_line_items`
- Show impact preview: "Deleting ₹X will change [date] net profit from ₹Y → ₹Z"
- `haan hata do` → soft-delete line_items + invoice_items + void upload_source + reverse daily_pnl + write audit_log (all in one transaction)
- If multiple matches → show numbered list, ask which one

### Unclassified expense flow ("expense 2000" / "kharch 500"):
- Save with `classification_status = 'unclassified'`, `needs_review = true`
- Update `daily_pnl.other_expense` immediately — P&L never blocked
- Send one 5-option clarification: "1→ Vegetables, 2→ Dairy, 3→ Gas, 4→ Staff, 5→ Skip"
- If >₹5,000 single entry → ask fixed vs variable first
- Weekly digest shows total unclassified amount

### Backdated entry flow ("parso sales 3500 tha"):
- Resolve date: kal=-1, parso=-2, "N din pehle"=-N, "last Monday"=most recent Monday
- Reject future dates immediately
- Check if entry exists for that date+category → ask "badlo" (replace) or "jodo" (add)
- If crossing month boundary → warn before saving
- Set `entry_method = 'whatsapp_backdate'`

---

## 9. Environment Variables

```env
ANTHROPIC_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
SUPABASE_URL=               # https://nqjhlzztsaxnzzmkokoj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=  # Server only — bypasses RLS
SUPABASE_ANON_KEY=          # Client side — respects RLS
JWT_SECRET=
MSG91_KEY=
```

---

## 10. What's Built vs Not Built

### ✅ Complete
- Webhook module (text + media + confirmation handlers)
- Claude text parsing (`parseTextMessage`)
- Claude Vision media parsing (`parseMedia` — fixed May 2026, was a stub)
- `MediaContentType0` correctly passed from route.ts to mediaHandler
- Data Layer (`lib/db/dataService.ts`)
- Backfill Wizard (manual entry + Excel upload UI + API)
- Vendor mapping

### ❌ Not Built Yet (P1 priority order)
1. **Schema migration** — current DB uses old schema (pnl_entries). Needs migration to new 11-table design.
2. **Auth** — OTP login via MSG91, JWT session. `app/page.tsx` is still default boilerplate.
3. **Web dashboard** — Upload UI, P&L view, charts, AI insights
4. **Delete flow** — `/api/entry` DELETE with P&L reversal and audit log
5. **`upload_sources` writes** — Every confirmed upload must write here (currently not wired)
6. **`analytics_events` writes** — Not instrumented yet
7. **Admin dashboard** (`/admin`) — DAU/WAU/MAU, parse success rate, unclassified digest
8. **queryHandler wired** — exists but not called from route.ts
9. **MTD + projected P&L queries** — queryHandler needs implementing

---

## 11. Known Issues to Fix

| Issue | File | Priority |
|---|---|---|
| `app/page.tsx` is default boilerplate | app/page.tsx | 🔴 High |
| Old schema in production — migration needed | Supabase | 🔴 High |
| Restaurant ID hardcoded | app/backfill/page.tsx:13 | 🟠 Medium |
| queryHandler not called from route.ts | app/api/webhook/route.ts | 🟠 Medium |
| Duplicate dataService (old in webhook/services/) | app/api/webhook/services/dataService.ts | 🟡 Low |
| `sendMessage()` duplicated in every handler | 4 handler files | 🟡 Low |

---

## 12. Real-World Data Quirks (from Tea Day bills analysis)

These were found by reading 3 months of actual Tea Day invoices from Google Drive:

- **Hyperpure sends 2 PDFs per order** — Bill of Supply (fresh, zero GST) + Tax Invoice (packaged, 5% GST). Link them via `order_reference`.
- **Hyperpure delivery charges** (₹99–116/order) are a separate line item on every invoice → `cogs_delivery_fee`, NOT included in food COGS.
- **Non-food items in Hyperpure/DMart bills** — paper plates, dishwash soap → `cogs_packaging` / `cogs_supplies`.
- **DMart credit notes exist** (returned Amul Fresh Cream ₹222 in April) → `transaction_type = 'credit_note'`.
- **Tea Day company invoices** to the outlet are intercompany transfers → `is_intercompany = true`.
- **Milk price changed 4x** across 3 months — always store `rate + quantity`, never just `amount`.
- **Gas is variable** — LPG cylinder bought periodically, NOT monthly fixed.
- **PG ≠ Rent** — ₹6,500/month staff accommodation separate from ₹20-22k shop rent.

---

## 13. Deployment

- Push to `main` → Vercel auto-deploys (~60 seconds)
- Production URL: `https://finmitra-ai.vercel.app`
- Vercel project: `prj_SnaW1IgfWaPoKxC6FrNCW1FQptGw`
- Team: `sutanu-kandar-s-projects`
- Supabase project: `nqjhlzztsaxnzzmkokoj`

---

## 14. Schema Migration Status

> Current prod DB = OLD schema. Target = 11-table design above.

| Current table | Target table | Status |
|---|---|---|
| `pnl_entries` | `daily_pnl` (computed) | ⏳ Needs migration |
| `upload_records` | `upload_sources` | ⏳ Needs migration |
| `invoice_items` | `invoice_items` (updated) | ⏳ Needs columns added |
| `pending_confirmations` | `pending_confirmations` (updated) | ⏳ Add `action` column |
| `audit_log` | `audit_log` (updated) | ⏳ Add amount_reversed etc. |
| *(none)* | `financial_line_items` | ⏳ Create new |
| *(none)* | `revenue_entries` | ⏳ Create new |
| *(none)* | `monthly_item_spend` | ⏳ Create new |
| *(none)* | `vendor_map` | ⏳ Create new |
| *(none)* | `item_canonical_map` | ⏳ Create new |

Migration strategy: run old + new schema in parallel, backfill `financial_line_items` from `pnl_entries`, switch reads to `daily_pnl` once verified, then deprecate `pnl_entries`.

