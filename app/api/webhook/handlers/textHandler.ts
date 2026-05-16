import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function handleTextMessage(from: string, restaurantId: string, body: string) {
  try {
    // Full P&L Queries
    if (body.includes('aaj') || body.includes('today') || body.includes('p&l')) {
      await handlePnlQuery(from, restaurantId, 'today');
      return;
    }

    if (body.includes('this month') || body.includes('month')) {
      await handlePnlQuery(from, restaurantId, 'month');
      return;
    }

    if (body.includes('kal') || body.includes('yesterday')) {
      await handlePnlQuery(from, restaurantId, 'yesterday');
      return;
    }

    // Default response
    await sendMessage(from, "✅ Got it!\nTry:\n• `aaj ka P&L`\n• `this month`\n• `swiggy 4500 aaj`");

  } catch (error) {
    console.error("[TextHandler] Error:", error);
    await sendMessage(from, "Sorry, something went wrong.");
  }
}

async function handlePnlQuery(from: string, restaurantId: string, period: string) {
  let query = supabase
    .from('pnl_entries')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('date', { ascending: true });

  const today = new Date().toISOString().split('T')[0];

  if (period === 'today') {
    query = query.eq('date', today);
  } else if (period === 'yesterday') {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    query = query.eq('date', yesterday);
  } else if (period === 'month') {
    const startOfMonth = today.slice(0, 7) + '-01';
    query = query.gte('date', startOfMonth);
  }

  const { data: entries } = await query;

  if (!entries || entries.length === 0) {
    await sendMessage(from, "No data found for this period yet.");
    return;
  }

  let revenue = 0, cogs = 0, fixed = 0;

  entries.forEach((e: any) => {
    revenue += (e.swiggy || 0) + (e.phonepe || 0);
    cogs += (e.hyperpure || 0) + (e.bigbasket || 0) + (e.milk || 0) + (e.bread || 0);
    fixed += (e.rent || 0) + (e.electricity || 0) + (e.gas || 0) + (e.salary || 0) + (e.fixed || 0);
  });

  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - fixed;
  const margin = revenue > 0 ? Math.round((grossProfit / revenue) * 100) : 0;

  const reply = `📊 *P&L Summary*

Revenue     : ₹${revenue.toLocaleString('en-IN')}
COGS        : ₹${cogs.toLocaleString('en-IN')}
Gross Profit: ₹${grossProfit.toLocaleString('en-IN')} (${margin}%)
Fixed Cost  : ₹${fixed.toLocaleString('en-IN')}
Net Profit  : ₹${netProfit.toLocaleString('en-IN')}

Period: ${period === 'month' ? 'This Month' : period === 'yesterday' ? 'Yesterday' : 'Today'}`;

  await sendMessage(from, reply);
}

async function sendMessage(to: string, body: string) {
  const twilio = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  await twilio.messages.create({
    from: 'whatsapp:+14155238886',
    to: `whatsapp:${to}`,
    body: body,
  });
}
