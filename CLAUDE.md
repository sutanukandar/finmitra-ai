# FinMitra AI — CLAUDE.md

> This file gives Claude Code instant full context of the project.
> Read this before making any changes.

---

## 1. What This Product Is

**FinMitra AI** (consumer brand: **Hisaab AI**) is a WhatsApp-native AI CFO for Indian restaurant and cafe owners.

Restaurant owners send bill photos, PDFs, and Hinglish text messages via WhatsApp. FinMitra parses them using Claude Vision, saves structured financial data to Supabase, and replies with a real-time P&L summary.

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
        confirmationHandler.ts  ← haan/nahi logic → save to DB
        queryHandler.ts         ← P&L queries (aaj/kal/this month)
    backfill/
      route.ts                  ← Backfill API (JSON manual entry + Excel upload)
  backfill/
    page.tsx                    ← Backfill Wizard UI (manual + Excel upload)
  page.tsx                      ← Homepage (currently default Next.js boilerplate — NOT BUILT YET)

lib/
  db/
    dataService.ts              ← ⭐ SINGLE SOURCE OF TRUTH for all Supabase operations
                                   All modules must import from here. Never call Supabase directly.
```

---

## 4. Database Schema (Supabase)

### `restaurants`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK, gen_random_uuid() |
| mobile | text | UNIQUE, format: +91XXXXXXXXXX |
| name | text | Restaurant name |
| owner_name | text | |
| city | text | |
| role | text | default 'owner' |
| digest_enabled | bool | Daily digest toggle |
| timezone | text | default 'Asia/Kolkata' |

### `pnl_entries`
One row per restaurant per day. All amounts in INR (numeric).

| Column | Notes |
|---|---|
| restaurant_id | FK → restaurants.id |
| date | DATE — always store as **YYYY-MM-DD** |
| sales | Daily revenue (QR + cash walk-in) |
| swiggy | Swiggy net sales |
| zomato | Zomato net sales |
| phonepe | PhonePe completed credits |
| hyperpure | Hyperpure invoice total |
| bigbasket | BigBasket invoice total |
| milk | Milk expense |
| bread | Bread expense |
| other | Catch-all for unknown vendors (DMart, Metro, local market, etc.) |
| rent | Fixed cost |
| electricity | Fixed cost |
| gas | Fixed cost |
| salary | Fixed cost |
| fixed | Misc fixed cost |

**UNIQUE constraint on (restaurant_id, date) — always use upsert, never insert.**

### `invoice_items`
Item-level detail for every parsed bill.

| Column | Notes |
|---|---|
| restaurant_id | FK → restaurants.id |
| upload_record_id | FK → upload_records.id (nullable) |
| date | DATE — YYYY-MM-DD |
| vendor | Vendor name (Hyperpure, BigBasket, DMart, etc.) |
| item_name | Product name |
| quantity | numeric |
| unit | Kg, Pc, L, etc. |
| rate | Per-unit price |
| amount | Line total |
| mapped_category | **Must be 'cogs' for food items, 'fixed' for overhead** |

### Other tables
- `upload_records` — audit trail of every upload (currently not being written to — needs implementation)
- `pending_confirmations` — temporary store for unconfirmed media parses (TTL: 7 days)
- `analytics_events` — append-only event stream (not yet instrumented)
- `audit_log` — append-only deletion log (not yet wired)

---

## 5. Critical Rules — Never Break These

1. **Date format:** Always use `YYYY-MM-DD` when writing to Supabase. Claude returns `DD-MM-YYYY` — always convert before saving.

2. **Single dataService:** All DB calls go through `lib/db/dataService.ts`. Do NOT use the old `app/api/webhook/services/dataService.ts` — it's outdated and missing methods.

3. **Upsert, never insert:** For `pnl_entries`, always use `.upsert({ ... }, { onConflict: 'restaurant_id,date' })`.

4. **Never hardcode restaurant IDs.** The current hardcoded ID `b77ed758-9a72-4de2-9138-b353589c656d` in `app/backfill/page.tsx` is temporary pilot-only. Remove when auth is built.

5. **Twilio media requires auth:** When downloading media from Twilio URLs, always use Basic Auth: `Buffer.from('ACCOUNT_SID:AUTH_TOKEN').toString('base64')`.

6. **mapped_category:** Food/ingredient items = `'cogs'`. Rent/electricity/gas/salary = `'fixed'`.

7. **P&L formula:**
   - Revenue = sales + swiggy + zomato + phonepe
   - COGS = hyperpure + bigbasket + milk + bread + other
   - Gross Profit = Revenue − COGS
   - Net Profit = Gross Profit − (rent + electricity + gas + salary + fixed)

---

## 6. WhatsApp Flow

```
User sends message
  → route.ts reads formData (From, Body, MediaUrl0, MediaContentType0)
  → Looks up restaurant by mobile number
  → Priority order:
      1. Is it 'haan'/'nahi'? → confirmationHandler
      2. Is there a MediaUrl0? → mediaHandler → parser.parseMedia → pending_confirmations
      3. Otherwise → textHandler → parser.parseTextMessage → pnl_entries
```

**Confirmation flow:**
- User uploads bill → parsed → saved to `pending_confirmations` → preview sent to user
- User replies `haan` → save to `invoice_items` + `pnl_entries` → delete from `pending_confirmations`
- User replies `nahi` → delete from `pending_confirmations`

---

## 7. Environment Variables

```env
ANTHROPIC_API_KEY=          # Claude API key
TWILIO_ACCOUNT_SID=         # Twilio account SID
TWILIO_AUTH_TOKEN=          # Twilio auth token
SUPABASE_URL=               # https://nqjhlzztsaxnzzmkokoj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=  # Service role key (bypasses RLS — server only)
SUPABASE_ANON_KEY=          # Anon key (for client-side, respects RLS)
JWT_SECRET=                 # For session tokens (auth not built yet)
MSG91_KEY=                  # OTP SMS (auth not built yet)
```

---

## 8. What's Built vs Not Built

### ✅ Complete
- Webhook module (text + media + confirmation handlers)
- Claude text parsing (`parseTextMessage`)
- Claude Vision media parsing (`parseMedia` — fixed May 2026)
- Data Layer (`lib/db/dataService.ts`)
- Backfill Wizard (manual entry + Excel upload UI + API)
- Vendor mapping (Hyperpure/Zomato, BigBasket/BBNow, DMart → correct DB column)

### ❌ Not Built Yet (P1 priority)
- **Auth** — OTP login via MSG91, JWT session, no homepage yet (`app/page.tsx` is default boilerplate)
- **Web Dashboard** — Upload UI, P&L view, charts, AI insights
- **`/api/claude` proxy** — Claude API calls should go through a server-side proxy, not client-direct
- **`/api/entry` DELETE** — Data deletion with P&L reversal
- **`upload_records` writes** — Every confirmed upload should write an audit record
- **`analytics_events` writes** — Event instrumentation not wired
- **Admin dashboard** (`/admin`) — Founder analytics: DAU/WAU/MAU, parse success rate

---

## 9. Known Issues to Fix

| Issue | File | Priority |
|---|---|---|
| `app/page.tsx` is default Next.js boilerplate | app/page.tsx | 🔴 High |
| Restaurant ID hardcoded in backfill UI | app/backfill/page.tsx line 13 | 🟠 Medium |
| Duplicate dataService (old one in webhook/services/) | app/api/webhook/services/dataService.ts | 🟡 Low |
| `sendMessage()` duplicated in every handler | 4 handler files | 🟡 Low |
| `queryHandler.ts` not called from route.ts | app/api/webhook/route.ts | 🟡 Low |
| `rate` not being saved in invoice_items | backfill/route.ts | 🟡 Low |

---

## 10. Deployment

- **Push to `main`** → Vercel auto-deploys (usually ~60 seconds)
- Production URL: `https://finmitra-ai.vercel.app`
- Vercel project: `prj_SnaW1IgfWaPoKxC6FrNCW1FQptGw`
- Team: `sutanu-kandar-s-projects`

To check deployment status after a push:
```bash
# Check latest deployment
vercel ls --prod
```
