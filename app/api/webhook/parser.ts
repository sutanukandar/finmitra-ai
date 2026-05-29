import Anthropic from '@anthropic-ai/sdk';
import { ParsedIntent, MediaParseResult } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export const parser = {

  async parseTextMessage(message: string, todayDate: string): Promise<ParsedIntent> {
    const systemPrompt = `You are FinMitra. Today's date is ${todayDate}.
Parse the user message and return ONLY valid JSON (no markdown, no code blocks, no extra text).

Supported intents: add_entries, query_today, query_mtd, query_lastmonth, query_specific, query_pnl, query_items, query_ingredient, query_vendor_breakdown, query_daily_breakdown, help, unknown.

Categories for add_entries:
- sales / revenue / bika / aaj bika / today sales
- swiggy, phonepe, hyperpure, bigbasket, milk, bread, water, rent, electricity, gas, salary, fixed
- water / bisleri / drinking water → category: "water"

If the message is about sales/revenue, use category: "sales".

Each line of the message may be a separate entry with its own date.
Parse each line independently and return an array of entries.

For each entry, extract the date field explicitly:
- "25th May 2026" or "25 May 2026" → date: "2026-05-25"
- "25 May" (no year) → date: current year, e.g. "2026-05-25"
- "aaj" / "today" / no date mentioned → date: today (${todayDate})
- "kal" / "yesterday" → date: yesterday

Each entry must include its own date field. Never default all entries to today if
dates are explicitly mentioned in the message.

Example multi-line input:
  Milk expense for 25th May 2026 : 456
  Milk Expense for 26th May 2026 : 456
  Milk Expense for 27th May 2026 : 456
  Milk Expense for 28th May 2026 : 456

Expected output:
  {"intent": "add_entries", "entries": [
    {"category": "milk", "amount": 456, "date": "2026-05-25"},
    {"category": "milk", "amount": 456, "date": "2026-05-26"},
    {"category": "milk", "amount": 456, "date": "2026-05-27"},
    {"category": "milk", "amount": 456, "date": "2026-05-28"}
  ]}

CRITICAL RULE — P&L vs single-metric:
- If the user says P&L, profit, loss, summary, report, hisaab → ALWAYS use intent: "query_pnl". Never query_specific.
- query_specific is ONLY for single-number questions: "how much is sales", "total expenses", "kitna bika".
- When in doubt between query_pnl and query_specific: if the message contains P&L, report, or summary → query_pnl.

For query_pnl — full profit & loss summary (revenue + COGS + fixed costs):
- "aaj ka P&L" → {"intent": "query_pnl", "period": "today"}
- "is mahine ka P&L" → {"intent": "query_pnl", "period": "mtd"}
- "P&L for Mar 2026" → {"intent": "query_pnl", "period": "specific_month", "month": "2026-03"}
- "March ka P&L" → {"intent": "query_pnl", "period": "specific_month", "month": "2026-03"}
- "show me March P&L" → {"intent": "query_pnl", "period": "specific_month", "month": "2026-03"}
- "March 2026 profit and loss" → {"intent": "query_pnl", "period": "specific_month", "month": "2026-03"}
- "kal ka P&L" → {"intent": "query_pnl", "period": "yesterday"}
- period: "today" | "yesterday" | "mtd" | "specific_month"
- month: "YYYY-MM" — only when period = "specific_month"

For query_specific — user asks for ONE number only, no full summary:
- "aaj kitna bika", "today ka sale", "how much is today sales", "is mahine ka sale"
  → {"intent": "query_specific", "metric": "sales", "period": "today" or "mtd"}
- "aaj kitna kharch hua", "today ka expense", "is mahine ka kharch"
  → {"intent": "query_specific", "metric": "cogs", "period": "today" or "mtd"}
- "Sales for 25 May 2026"
  → {"intent": "query_specific", "metric": "sales", "period": "specific_date", "date": "2026-05-25"}
- "Sales for 24th May"
  → {"intent": "query_specific", "metric": "sales", "period": "specific_date", "date": "2026-05-24"}
- "25 May ka sales"
  → {"intent": "query_specific", "metric": "sales", "period": "specific_date", "date": "2026-05-25"}
- "Expenses on 15 March"
  → {"intent": "query_specific", "metric": "cogs", "period": "specific_date", "date": "2026-03-15"}
- "Total Expenses for Mar 2026", "March ka total kharch"
  → {"intent": "query_specific", "metric": "cogs", "period": "specific_month", "month": "2026-03"}
- "March 2026 sales", "Mar 26 sales"
  → {"intent": "query_specific", "metric": "sales", "period": "specific_month", "month": "2026-03"}
- "COGS as % of revenue for May", "food cost percentage"
  → {"intent": "query_specific", "metric": "cogs_pct_revenue", "period": "specific_month", "month": "2026-05"}
- "what % of revenue is food cost?"
  → {"intent": "query_specific", "metric": "cogs_pct_revenue", "period": "mtd"}
- "gross margin for March", "March ka gross margin"
  → {"intent": "query_specific", "metric": "gross_margin_pct", "period": "specific_month", "month": "2026-03"}
- "net profit margin", "net margin this month"
  → {"intent": "query_specific", "metric": "net_margin_pct", "period": "mtd"}
- "COGS % for March, April and May 2026"
  → {"intent": "query_specific", "metric": "cogs_pct_revenue", "period": "multi_month", "months": ["2026-03", "2026-04", "2026-05"]}
- "compare gross margin across March April May"
  → {"intent": "query_specific", "metric": "gross_margin_pct", "period": "multi_month", "months": ["2026-03", "2026-04", "2026-05"]}
- "net profit for last 3 months"
  → {"intent": "query_specific", "metric": "net_margin_pct", "period": "multi_month", "months": ["2026-03", "2026-04", "2026-05"]}
- "sales for March and April"
  → {"intent": "query_specific", "metric": "sales", "period": "multi_month", "months": ["2026-03", "2026-04"]}
- multi_month rule: when user mentions 2+ months in one query → period: "multi_month", months: ["YYYY-MM", ...] in chronological order
- metric values: "sales" | "cogs" | "cogs_pct_revenue" | "gross_margin_pct" | "net_margin_pct"
- Period rules:
  specific_date: user mentions a full date (day + month). date field: "YYYY-MM-DD"
  specific_month: user mentions only a month/year with no day. month field: "YYYY-MM"
  "25 May 2026" → specific_date, date: "2026-05-25"
  "May 2026" → specific_month, month: "2026-05"
  "25 May" (no year) → specific_date, assume current year ${todayDate.slice(0, 4)}
  period defaults to "today" if no date or month is mentioned

For query_items — user asks for top items/ingredients by spend, optionally filtered by vendor and/or date:
- "most expensive items this month"
  → {"intent": "query_items", "period": "mtd", "vendor_filter": null, "limit": 5}
- "top 5 items bought from Hyperpure on 27 April"
  → {"intent": "query_items", "period": "specific_date", "date": "2026-04-27", "vendor_filter": "hyperpure", "limit": 5}
- "what did I buy from BigBasket in May?"
  → {"intent": "query_items", "period": "mtd", "vendor_filter": "bigbasket", "limit": 8}
- "top items this month"
  → {"intent": "query_items", "period": "mtd", "vendor_filter": null, "limit": 5}
- period defaults to "mtd" unless user explicitly asks about today
- vendor_filter: "hyperpure" | "bigbasket" | "dmart" | null (null = all vendors)
- limit: use whatever number user says, default 5
- sort_by: "value" (default) | "weight" — "top 5 by value" → "value", "top 5 by weight" → "weight"
- IMPORTANT — month name vs full date:
  "Mar 26", "March 26", "March 2026" = a MONTH → period: "specific_month", month: "YYYY-MM"
  "27 April", "5th March", "April 27" = a full DATE → period: "specific_date", date: "YYYY-MM-DD"
- "top 5 items in Mar 26" → {"intent":"query_items","period":"specific_month","month":"2026-03","vendor_filter":null,"sort_by":"value","limit":5}
- "top items bought in March 2026" → {"intent":"query_items","period":"specific_month","month":"2026-03","vendor_filter":null,"sort_by":"value","limit":5}
- "top 5 items on 27 April" → {"intent":"query_items","period":"specific_date","date":"2026-04-27","vendor_filter":null,"sort_by":"value","limit":5}

For query_ingredient — user asks about a specific ingredient across vendors:
- "how much carrot did I buy this month"
  → {"intent": "query_ingredient", "ingredient": "Carrot", "period": "mtd"}
- "total curd spend in April"
  → {"intent": "query_ingredient", "ingredient": "Curd", "period": "specific_month", "month": "2026-04"}
- "kitna honey kharida is mahine"
  → {"intent": "query_ingredient", "ingredient": "Honey", "period": "mtd"}
- "eggs ka total this month"
  → {"intent": "query_ingredient", "ingredient": "Eggs", "period": "mtd"}
- ingredient: always Capitalised, generic name (Carrot not fresho carrot)
- period: "today" | "mtd" | "specific_month"
- month: "YYYY-MM" — only when period = "specific_month"

For query_daily_breakdown — user wants day-by-day values for one metric over a date range:
- "daily milk expenses for last 7 days"
  → {"intent": "query_daily_breakdown", "metric": "milk", "period": "last_n_days", "days": 7}
- "show me daily sales for last 10 days"
  → {"intent": "query_daily_breakdown", "metric": "sales", "period": "last_n_days", "days": 10}
- "day wise phonepe last 7 days"
  → {"intent": "query_daily_breakdown", "metric": "phonepe", "period": "last_n_days", "days": 7}
- "daily expenses for last 7 days"
  → {"intent": "query_daily_breakdown", "metric": "cogs", "period": "last_n_days", "days": 7}
- "daily water expenses last 7 days"
  → {"intent": "query_daily_breakdown", "metric": "water", "period": "last_n_days", "days": 7}
- "milk expenses in March day by day"
  → {"intent": "query_daily_breakdown", "metric": "milk", "period": "specific_month", "month": "2026-03"}
- "daily revenue for May"
  → {"intent": "query_daily_breakdown", "metric": "revenue", "period": "specific_month", "month": "2026-05"}
- metric: any pnl column ("milk", "sales", "phonepe", "bigbasket", "hyperpure", "bread",
  "other", "rent", "salary") OR computed value "cogs" / "revenue" / "fixed"
- period: "last_n_days" (requires days field) | "specific_month" (requires month field) | "mtd"
- days: number of days for last_n_days, default 7

For query_vendor_breakdown — user asks for expense split by vendor/supplier:
- "how much expense from BigBasket, Hyperpure, DMart"
- "vendor wise expense in March 2026" → {"intent": "query_vendor_breakdown", "period": "specific_month", "month": "2026-03"}
- "supplier wise kharch in Mar 26" → {"intent": "query_vendor_breakdown", "period": "specific_month", "month": "2026-03"}
- "kitna kharcha kiya har vendor pe is mahine" → {"intent": "query_vendor_breakdown", "period": "mtd"}
- period: "today" | "mtd" | "specific_month"; month: "YYYY-MM" only for specific_month

Example outputs:
{"intent": "add_entries", "entries": [{"category": "sales", "amount": 3500, "date_offset": 0}]}
{"intent": "query_specific", "metric": "sales", "period": "today"}
{"intent": "query_pnl", "period": "specific_month", "month": "2026-03"}
{"intent": "query_pnl", "period": "today"}`;

    try {
      const aiResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: "user", content: message }]
      });

      let text = aiResponse.content?.[0]?.type === 'text'
        ? aiResponse.content[0].text.trim()
        : '{}';

      text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      return JSON.parse(text) as ParsedIntent;
    } catch (error) {
      console.error("[Parser] parseTextMessage failed:", error);
      return { intent: "unknown" };
    }
  },

  async parseMediaBase64(base64Data: string, contentType: string): Promise<MediaParseResult> {
    try {
      const isPdf = contentType.includes('pdf');
      console.log(`[Parser] parseMediaBase64: contentType=${contentType}, isPDF=${isPdf}, bytes=${Math.round(base64Data.length * 0.75)}`);

      const mediaBlock = isPdf
        ? {
            type: 'document' as const,
            source: {
              type: 'base64' as const,
              media_type: 'application/pdf' as const,
              data: base64Data
            }
          }
        : {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: contentType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: base64Data
            }
          };

      const prompt = `You are a bill parsing assistant for an Indian restaurant.
Extract all information from this invoice/bill and return ONLY valid JSON (no markdown, no code blocks, no extra text).

Return this exact structure:
{
  "vendor": "vendor name",
  "date": "DD-MM-YYYY",
  "invoice_number": "invoice number or empty string",
  "total": numeric total amount in INR,
  "items": [
    {
      "item_name": "exact product name from invoice",
      "item_canonical": "generic ingredient name",
      "unit_normalised": "Kg or L or Pc",
      "quantity_normalised": numeric quantity in unit_normalised,
      "quantity": numeric quantity,
      "unit": "Kg/Pc/L/etc",
      "rate": numeric per-unit price,
      "amount": numeric line total
    }
  ]
}

Rules:
- date must be in DD-MM-YYYY format
- All amounts are numbers only (no ₹ symbol)
- If a field is unclear, use a sensible default (0 for numbers, empty string for text)
- item_canonical: the generic ingredient name, stripping brand, size, packaging, adjectives. One or two words max. Capitalised. The ingredient, not the brand.
  Examples: 'fresho! Carrot - Orange 1 kg' → 'Carrot', 'Amul Curd - Creamy 900g' → 'Curd',
  'Zomato Hyperpure Eggs 30 Pcs Tray' → 'Eggs', 'VIVI - Honey, 1 Kg' → 'Honey',
  'Heritage Table Butter 500gm' → 'Butter', 'Bru Instant Coffee 500g' → 'Coffee Powder',
  'Bolas Independence Almond 250gm' → 'Almonds', 'Cadbury Oreo Vanilla 125g' → 'Biscuits',
  'Bisleri Drinking Water 24x250ml' → 'Water'
- unit_normalised: standardise to Kg / L / Pc only.
  500g → 'Kg' (quantity_normalised: 0.5), 1kg → 'Kg' (quantity_normalised: 1.0),
  500ml → 'L' (quantity_normalised: 0.5), 1 Tray (30 eggs) → 'Pc' (quantity_normalised: 30),
  1 Pack → 'Pc' (quantity_normalised: 1)
- quantity_normalised: the quantity expressed in unit_normalised units`;

      console.log('[Parser] Sending to Claude Vision...');
      const aiResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [
          {
            role: 'user',
            content: [
              mediaBlock,
              { type: 'text', text: prompt }
            ]
          }
        ]
      });

      let responseText = aiResponse.content?.[0]?.type === 'text'
        ? aiResponse.content[0].text.trim()
        : '';

      console.log('[Parser] Claude response:', responseText.substring(0, 300));

      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      const parsed = JSON.parse(responseText);

      // Convert date DD-MM-YYYY → YYYY-MM-DD
      let isoDate = parsed.date;
      if (parsed.date && /^\d{2}-\d{2}-\d{4}$/.test(parsed.date)) {
        const [dd, mm, yyyy] = parsed.date.split('-');
        isoDate = `${yyyy}-${mm}-${dd}`;
      }
      console.log(`[Parser] Date converted: ${parsed.date} → ${isoDate}`);

      const allItems = (parsed.items || []).map((item: any) => ({
        ...item,
        name: item.item_name || item.name || 'Unknown Item',
        mapped_category: 'cogs'
      }));

      const DELIVERY_RE = /delivery|shipping|freight|pay on delivery/i;
      const foodItems     = allItems.filter((i: any) => !DELIVERY_RE.test(i.item_name || ''));
      const deliveryItems = allItems.filter((i: any) =>  DELIVERY_RE.test(i.item_name || ''));
      const deliveryFee   = deliveryItems.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);

      if (deliveryFee > 0) {
        console.log(`[Parser] Separated delivery fee: ₹${deliveryFee} (${deliveryItems.length} line item(s))`);
      }
      console.log(`[Parser] Done. Vendor: ${parsed.vendor}, Total: ${parsed.total}, Food items: ${foodItems.length}`);

      return {
        success: true,
        vendor: parsed.vendor,
        date: isoDate,
        total: parsed.total,
        items: foodItems,
        delivery_fee: deliveryFee,
        extracted: responseText
      };

    } catch (error: any) {
      console.error('[Parser] parseMediaBase64 failed:', error);
      return { success: false, extracted: error.message || 'Unknown error' };
    }
  },

  async parseMedia(mediaUrl: string, mediaType: string | null): Promise<MediaParseResult> {
    console.log(`[Parser] Starting media parse. URL: ${mediaUrl}, Type: ${mediaType}`);

    try {
      const auth = Buffer.from(
        `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
      ).toString('base64');

      console.log('[Parser] Downloading media from Twilio...');
      const mediaResponse = await fetch(mediaUrl, {
        headers: { Authorization: `Basic ${auth}` }
      });

      if (!mediaResponse.ok) {
        throw new Error(`Twilio download failed: ${mediaResponse.status} ${mediaResponse.statusText}`);
      }

      const mediaBuffer = await mediaResponse.arrayBuffer();
      const base64Data = Buffer.from(mediaBuffer).toString('base64');
      console.log(`[Parser] Downloaded ${mediaBuffer.byteLength} bytes`);

      const contentType = mediaType || 'image/jpeg';
      return await this.parseMediaBase64(base64Data, contentType);

    } catch (error: any) {
      console.error('[Parser] parseMedia failed:', error);
      return { success: false, extracted: error.message || 'Unknown error' };
    }
  }
};
