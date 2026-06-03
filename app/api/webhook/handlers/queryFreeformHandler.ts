import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function handleFreeformQuery(
  from: string,
  restaurantId: string,
  question: string,
  restaurantName = 'this restaurant'
) {
  console.log(`[FreeformHandler] Question: "${question}"`);

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  // STEP 1 — Fetch raw rows
  const { data: entries } = await supabase
    .from('pnl_entries')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .gte('date', ninetyDaysAgo)
    .order('date', { ascending: true });

  if (!entries || entries.length === 0) {
    await sendMessage(from, "No P&L data found yet to answer this question.");
    return;
  }

  // STEP 2 — Pre-compute daily totals in code using exact formula
  const dailySummary = (entries as any[]).map(e => ({
    date:       e.date,
    totalSales: (Number(e.sales)||0) + (Number(e.phonepe)||0) +
                (Number(e.swiggy)||0) + (Number(e.zomato)||0),
    itemCost:   (Number(e.hyperpure)||0) + (Number(e.bigbasket)||0) +
                (Number(e.milk)||0) + (Number(e.bread)||0) +
                (Number(e.water)||0) + (Number(e.other)||0),
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
      milk:        Number(e.milk)||0,
      bread:       Number(e.bread)||0,
      water:       Number(e.water)||0,
      other:       Number(e.other)||0,
      rent:        Number(e.rent)||0,
      salary:      Number(e.salary)||0,
      electricity: Number(e.electricity)||0,
      pg:          Number(e.pg)||0,
    },
  }));

  // STEP 3 — Aggregate to monthly summaries with full column breakdown
  const initialMonth = () => ({
    totalSales: 0, itemCost: 0, fixedCost: 0, profit: 0, days: 0,
    // Individual revenue
    qrSales: 0, swiggy: 0, zomato: 0,
    // Individual COGS
    hyperpure: 0, bigbasket: 0, milk: 0, bread: 0, water: 0, other: 0,
    // Individual fixed
    rent: 0, salary: 0, electricity: 0, gas: 0, pg: 0,
    internet: 0, garbage: 0, repairs: 0, marketing: 0, misc: 0,
  });

  const months: Record<string, ReturnType<typeof initialMonth>> = {};

  (entries as any[]).forEach(e => {
    const mo = e.date.slice(0, 7); // YYYY-MM
    if (!months[mo]) months[mo] = initialMonth();

    const rowSales = (Number(e.sales)||0) + (Number(e.phonepe)||0) +
                     (Number(e.swiggy)||0) + (Number(e.zomato)||0);
    const rowItem  = (Number(e.hyperpure)||0) + (Number(e.bigbasket)||0) +
                     (Number(e.milk)||0) + (Number(e.bread)||0) +
                     (Number(e.water)||0) + (Number(e.other)||0);
    const rowFixed = (Number(e.rent)||0) + (Number(e.salary)||0) +
                     (Number(e.electricity)||0) + (Number(e.gas)||0) +
                     (Number(e.pg)||0) + (Number(e.internet)||0) +
                     (Number(e.garbage)||0) + (Number(e.repairs)||0) +
                     (Number(e.marketing)||0) + (Number(e.misc)||0) +
                     (Number(e.fixed)||0);

    months[mo].totalSales += rowSales;
    months[mo].itemCost   += rowItem;
    months[mo].fixedCost  += rowFixed;
    months[mo].profit     += rowSales - rowItem - rowFixed;
    months[mo].days++;

    // Individual columns
    months[mo].qrSales    += (Number(e.sales)||0) + (Number(e.phonepe)||0);
    months[mo].swiggy     += Number(e.swiggy)||0;
    months[mo].zomato     += Number(e.zomato)||0;
    months[mo].hyperpure  += Number(e.hyperpure)||0;
    months[mo].bigbasket  += Number(e.bigbasket)||0;
    months[mo].milk       += Number(e.milk)||0;
    months[mo].bread      += Number(e.bread)||0;
    months[mo].water      += Number(e.water)||0;
    months[mo].other      += Number(e.other)||0;
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

  // STEP 4 — Pass pre-computed context to Claude (last 31 days of daily + full monthly)
  const dataContext = {
    dailySummary:   dailySummary.slice(-31),
    monthlySummary: months,
    note: 'All totals are pre-computed and correct. Do NOT re-compute from raw columns. Use these numbers directly for your analysis.',
  };

  const aiResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: `You are a financial analyst for a restaurant called ${restaurantName}.

CRITICAL: The data you receive has ALREADY been correctly computed.
- totalSales = QR sales + PhonePe + Swiggy + Zomato (all revenue sources)
- itemCost   = all ingredient/vendor purchases (variable costs)
- fixedCost  = rent + salary + electricity + all fixed expenses
- profit     = totalSales - itemCost - fixedCost

NEVER re-compute these from raw columns.
ALWAYS use the pre-computed totalSales, itemCost, fixedCost values.

monthlySummary contains both totals AND individual columns per month.
For trend questions about a specific category (e.g. electricity, milk,
rent), use the individual column values directly from monthlySummary.
Do NOT say 'no data' if totalSales/itemCost/fixedCost is non-zero —
look at the individual columns instead.

Answer in plain language a restaurant owner understands.
Format numbers with ₹ and Indian comma style (₹1,00,435).
Be concise — 5 to 8 lines max.

STRICT RULE: Only answer questions about this restaurant's financial data.
If the question is not about restaurant finances, reply with exactly: OUT_OF_SCOPE`,
    messages: [{
      role: 'user',
      content: `Restaurant data:\n${JSON.stringify(dataContext, null, 2)}\n\nQuestion: ${question}`,
    }],
  });

  const answer = aiResponse.content[0]?.type === 'text'
    ? aiResponse.content[0].text.trim()
    : "Sorry, I couldn't process that question.";

  if (answer === 'OUT_OF_SCOPE') {
    await sendMessage(from,
      "Hi! I'm FinMitra — your restaurant's finance assistant 🧾\n\n" +
      "I can help you with:\n" +
      "• Saving daily expenses (milk, bread, water)\n" +
      "• Recording sales (PhonePe, Swiggy, Zomato)\n" +
      "• Uploading bills (BigBasket, Hyperpure, DMart)\n" +
      "• P&L summaries and expense queries\n\n" +
      "Try: _aaj ka P&L_ or _today sales 3500_"
    );
    return;
  }

  console.log(`[FreeformHandler] Answer: ${answer.slice(0, 100)}...`);
  await sendMessage(from, `🤖 ${answer}`);
}

async function sendMessage(to: string, body: string) {
  const twilio = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  await twilio.messages.create({
    from: 'whatsapp:+14155238886',
    to:   `whatsapp:${to}`,
    body,
  });
}
