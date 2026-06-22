import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { sendMessage } from '../../../../lib/sendMessage';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Month name → 1-based month number
const MONTH_MAP: Record<string, number> = {
  jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
  jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
};

/**
 * Detect the earliest calendar month mentioned in the question.
 * Returns the first day of that month as a YYYY-MM-DD string.
 * Falls back to 90 days ago if no months are mentioned.
 */
function getStartDate(question: string, nowIST: Date): string {
  const lower = question.toLowerCase();
  const tokens = lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/g) || [];

  let earliest: Date | null = null;
  const currentYear  = nowIST.getFullYear();
  const currentMonth = nowIST.getMonth() + 1; // 1-based

  for (const token of tokens) {
    const mo = MONTH_MAP[token.slice(0, 3)];
    if (!mo) continue;
    // If the month is later than current month, it belongs to the previous year
    const year = mo > currentMonth ? currentYear - 1 : currentYear;
    const d = new Date(year, mo - 1, 1); // First day of that month
    if (!earliest || d < earliest) earliest = d;
  }

  if (earliest) {
    // Use first day of the earliest mentioned month
    return earliest.toISOString().split('T')[0];
  }

  // Default: 90 days ago
  return new Date(nowIST.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

export async function handleFreeformQuery(
  from: string,
  restaurantId: string,
  question: string,
  restaurantName = 'this restaurant'
) {
  console.log(`[FreeformHandler] Question: "${question}"`);

  const nowIST   = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayIST = nowIST.toISOString().split('T')[0];

  // FIX: dynamic start date — uses first day of earliest mentioned month
  // so "Mar, April, May, June" correctly starts from 2026-03-01 not 90 days ago
  const startDate = getStartDate(question, nowIST);
  console.log(`[FreeformHandler] Date range: ${startDate} → ${todayIST}`);

  // STEP 1 — Fetch raw rows
  const { data: entries } = await supabase
    .from('pnl_entries')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .gte('date', startDate)
    .order('date', { ascending: true });

  if (!entries || entries.length === 0) {
    await sendMessage(from, "No P&L data found yet to answer this question.", restaurantId);
    return;
  }

  // STEP 1b — Fetch invoice_items (last 30 days only to avoid timeout)
  const thirtyDaysAgo = new Date(nowIST.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];
  let items: any[] | null = null;
  try {
    const { data } = await supabase
      .from('invoice_items')
      .select('date, item_canonical, quantity, unit_normalised, amount, vendor')
      .eq('restaurant_id', restaurantId)
      .gte('date', thirtyDaysAgo)
      .lte('date', todayIST)
      .order('date', { ascending: true });
    items = data;
  } catch (err) {
    console.warn('[FreeformHandler] invoice_items fetch failed, continuing without it:', err);
  }

  // STEP 2 — Pre-compute daily totals
  // FIX: include local_market in itemCost throughout
  const dailySummary = (entries as any[]).map(e => ({
    date:       e.date,
    totalSales: (Number(e.sales)||0) + (Number(e.phonepe)||0) +
                (Number(e.swiggy)||0) + (Number(e.zomato)||0),
    itemCost:   (Number(e.hyperpure)||0) + (Number(e.bigbasket)||0) + (Number(e.dmart)||0) +
                (Number(e.milk)||0) + (Number(e.bread)||0) + (Number(e.water)||0) +
                (Number(e.other)||0) + (Number(e.local_market)||0),
    fixedCost:  (Number(e.rent)||0) + (Number(e.salary)||0) +
                (Number(e.electricity)||0) + (Number(e.gas)||0) +
                (Number(e.pg)||0) + (Number(e.internet)||0) +
                (Number(e.garbage)||0) + (Number(e.repairs)||0) +
                (Number(e.marketing)||0) + (Number(e.misc)||0) +
                (Number(e.fixed)||0),
    breakdown: {
      qrSales:     (Number(e.sales)||0) + (Number(e.phonepe)||0),
      swiggy:      Number(e.swiggy)||0,
      zomato:      Number(e.zomato)||0,
      hyperpure:   Number(e.hyperpure)||0,
      bigbasket:   Number(e.bigbasket)||0,
      dmart:       Number(e.dmart)||0,
      milk:        Number(e.milk)||0,
      bread:       Number(e.bread)||0,
      water:       Number(e.water)||0,
      other:       Number(e.other)||0,
      localMarket: Number(e.local_market)||0,
      rent:        Number(e.rent)||0,
      salary:      Number(e.salary)||0,
      electricity: Number(e.electricity)||0,
      pg:          Number(e.pg)||0,
    },
  }));

  // STEP 3 — Monthly aggregation (includes local_market)
  const initialMonth = () => ({
    totalSales: 0, itemCost: 0, fixedCost: 0, profit: 0, days: 0,
    qrSales: 0, swiggy: 0, zomato: 0,
    hyperpure: 0, bigbasket: 0, dmart: 0, milk: 0, bread: 0,
    water: 0, other: 0, localMarket: 0,
    rent: 0, salary: 0, electricity: 0, gas: 0, pg: 0,
    internet: 0, garbage: 0, repairs: 0, marketing: 0, misc: 0,
  });

  const months: Record<string, ReturnType<typeof initialMonth>> = {};

  (entries as any[]).forEach(e => {
    const mo = e.date.slice(0, 7);
    if (!months[mo]) months[mo] = initialMonth();

    const rowSales = (Number(e.sales)||0)+(Number(e.phonepe)||0)+
                     (Number(e.swiggy)||0)+(Number(e.zomato)||0);
    const rowItem  = (Number(e.hyperpure)||0)+(Number(e.bigbasket)||0)+(Number(e.dmart)||0)+
                     (Number(e.milk)||0)+(Number(e.bread)||0)+(Number(e.water)||0)+
                     (Number(e.other)||0)+(Number(e.local_market)||0); // FIX: +local_market
    const rowFixed = (Number(e.rent)||0)+(Number(e.salary)||0)+
                     (Number(e.electricity)||0)+(Number(e.gas)||0)+
                     (Number(e.pg)||0)+(Number(e.internet)||0)+
                     (Number(e.garbage)||0)+(Number(e.repairs)||0)+
                     (Number(e.marketing)||0)+(Number(e.misc)||0)+
                     (Number(e.fixed)||0);

    months[mo].totalSales  += rowSales;
    months[mo].itemCost    += rowItem;
    months[mo].fixedCost   += rowFixed;
    months[mo].profit      += rowSales - rowItem - rowFixed;
    months[mo].days++;

    months[mo].qrSales    += (Number(e.sales)||0)+(Number(e.phonepe)||0);
    months[mo].swiggy     += Number(e.swiggy)||0;
    months[mo].zomato     += Number(e.zomato)||0;
    months[mo].hyperpure  += Number(e.hyperpure)||0;
    months[mo].bigbasket  += Number(e.bigbasket)||0;
    months[mo].dmart      += Number(e.dmart)||0;
    months[mo].milk       += Number(e.milk)||0;
    months[mo].bread      += Number(e.bread)||0;
    months[mo].water      += Number(e.water)||0;
    months[mo].other      += Number(e.other)||0;
    months[mo].localMarket += Number(e.local_market)||0;
    months[mo].rent       += Number(e.rent)||0;
    months[mo].salary     += Number(e.salary)||0;
    months[mo].electricity += Number(e.electricity)||0;
    months[mo].gas        += Number(e.gas)||0;
    months[mo].pg         += Number(e.pg)||0;
    months[mo].internet   += Number(e.internet)||0;
    months[mo].garbage    += Number(e.garbage)||0;
    months[mo].repairs    += Number(e.repairs)||0;
    months[mo].marketing  += Number(e.marketing)||0;
    months[mo].misc       += Number(e.misc)||0;
  });

  // STEP 3b — Invoice items text
  const invoiceItemsText = (() => {
    if (!items || items.length === 0) return 'No bill items uploaded for this period.';
    const byDate: Record<string, any[]> = {};
    (items as any[]).forEach(item => {
      if (!byDate[item.date]) byDate[item.date] = [];
      byDate[item.date].push(item);
    });
    return Object.entries(byDate).sort()
      .map(([date, rows]) => {
        const lines = rows.map((r: any) =>
          `  - ${r.item_canonical}: ${r.quantity} ${r.unit_normalised} = ₹${Number(r.amount).toFixed(2)} (${r.vendor})`
        ).join('\n');
        return `${date}:\n${lines}`;
      }).join('\n\n');
  })();

  // STEP 4 — Daily rows text
  const dailyRowsText = (entries as any[])
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => {
      const s = (Number(e.sales)||0)+(Number(e.phonepe)||0)+(Number(e.swiggy)||0)+(Number(e.zomato)||0);
      const i = (Number(e.hyperpure)||0)+(Number(e.bigbasket)||0)+(Number(e.dmart)||0)+
                (Number(e.milk)||0)+(Number(e.bread)||0)+(Number(e.water)||0)+
                (Number(e.other)||0)+(Number(e.local_market)||0);
      const f = (Number(e.rent)||0)+(Number(e.salary)||0)+(Number(e.electricity)||0)+
                (Number(e.gas)||0)+(Number(e.pg)||0)+(Number(e.internet)||0)+
                (Number(e.garbage)||0)+(Number(e.repairs)||0)+(Number(e.marketing)||0)+
                (Number(e.misc)||0)+(Number(e.fixed)||0);
      return `${e.date}: Sales=₹${s.toFixed(0)} ItemCost=₹${i.toFixed(0)} FixedCost=₹${f.toFixed(0)} Profit=₹${(s-i-f).toFixed(0)}`;
    })
    .join('\n');

  let answer: string;
  try {
    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: `You are a financial analyst for a restaurant called ${restaurantName}.

All figures are pre-computed and correct. NEVER re-compute or re-aggregate.
- Sales = QR sales + PhonePe + Swiggy + Zomato
- ItemCost = all vendor/ingredient purchases (including Local Market cash buys)
- FixedCost = rent + salary + electricity + all fixed expenses
- Profit = Sales - ItemCost - FixedCost

For questions comparing specific dates (e.g. "yesterday vs same day last month"),
use the Daily Records section to find the exact dates.
Do NOT say "no data" for any date that appears in Daily Records.

Answer in plain language a restaurant owner understands.
Format numbers with ₹ and Indian comma style (₹1,00,435).
Be concise — 5 to 8 lines max.

STRICT RULE: Only answer questions about this restaurant's financial data.
If the question is not about restaurant finances, reply with exactly: OUT_OF_SCOPE`,
      messages: [{
        role: 'user',
        content: `Monthly Summaries:\n${JSON.stringify(months, null, 2)}\n\nDaily Records (use these for day-specific comparisons):\n${dailyRowsText}\n\nIngredient-Level Bill Items (from uploaded bills):\n${invoiceItemsText}\n\nUser question: ${question}\n\nFor questions comparing specific dates, use the Daily Records section. For ingredient breakdown questions, use the Bill Items section. Do NOT say "no data" for any date or item that appears above.`,
      }],
    });

    answer = aiResponse.content[0]?.type === 'text'
      ? aiResponse.content[0].text.trim()
      : "Sorry, I couldn't process that question.";
  } catch (error: any) {
    console.error('[FreeformHandler] Claude API error:', error);
    await sendMessage(
      from,
      "Sorry, I couldn't process that question right now. Please try again.",
      restaurantId,
      String(error?.message || error).substring(0, 300)
    );
    return;
  }

  if (answer === 'OUT_OF_SCOPE') {
    await sendMessage(from,
      "Hi! I'm FinMitra — your restaurant's finance assistant 🧾\n\n" +
      "I can help you with:\n" +
      "• Saving daily expenses (milk, bread, water)\n" +
      "• Recording sales (PhonePe, Swiggy, Zomato)\n" +
      "• Uploading bills (BigBasket, Hyperpure, DMart)\n" +
      "• P&L summaries and expense queries\n\n" +
      "Try: _aaj ka P&L_ or _today sales 3500_",
      restaurantId
    );
    return;
  }

  console.log(`[FreeformHandler] Answer: ${answer.slice(0, 100)}...`);
  await sendMessage(from, `🤖 ${answer}`, restaurantId);
}
