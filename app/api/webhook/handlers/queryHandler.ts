import { createClient } from '@supabase/supabase-js';
import { PnlSummary } from '../types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function handlePnlQuery(from: string, restaurantId: string, body: string) {
  try {
    const today = new Date().toISOString().split('T')[0];

    let query = supabase
      .from('pnl_entries')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('date', { ascending: true });

    // Determine query period
    if (body.includes('aaj') || body.includes('today') || body.includes('p&l')) {
      query = query.eq('date', today);
    } else if (body.includes('kal') || body.includes('yesterday')) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      query = query.eq('date', yesterday);
    } else if (body.includes('this month') || body.includes('month')) {
      const startOfMonth = today.slice(0, 7) + '-01';
      query = query.gte('date', startOfMonth);
    } else {
      await sendMessage(from, "Please specify period like `aaj ka P&L`, `this month`, or `kal ka P&L`");
      return;
    }

    const { data: entries } = await query;

    if (!entries || entries.length === 0) {
      await sendMessage(from, "No data found for this period yet.");
      return;
    }

    // Calculate P&L
    let revenue = 0, cogs = 0, fixed = 0;

    entries.forEach((e: any) => {
      revenue += (e.swiggy || 0) + (e.phonepe || 0);
      cogs += (e.hyperpure || 0) + (e.bigbasket || 0) + (e.milk || 0) + (e.bread || 0);
      fixed += (e.rent || 0) + (e.electricity || 0) + (e.gas || 0) + (e.salary || 0) + (e.fixed || 0);
    });

    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - fixed;
    const margin = revenue > 0 ? Math.round((grossProfit / revenue) * 100) : 0;

    const summary: PnlSummary = {
      revenue,
      cogs,
      grossProfit,
      fixedCost: fixed,
      netProfit,
      margin
    };

    const reply = `📊 *P&L Summary*

Revenue     : ₹${summary.revenue.toLocaleString('en-IN')}
COGS        : ₹${summary.cogs.toLocaleString('en-IN')}
Gross Profit: ₹${summary.grossProfit.toLocaleString('en-IN')} (${summary.margin}%)
Fixed Cost  : ₹${summary.fixedCost.toLocaleString('en-IN')}
Net Profit  : ₹${summary.netProfit.toLocaleString('en-IN')}

Period: ${body.includes('month') ? 'This Month' : body.includes('kal') ? 'Yesterday' : 'Today'}`;

    await sendMessage(from, reply);

  } catch (error) {
    console.error("[QueryHandler] Error:", error);
    await sendMessage(from, "Unable to fetch P&L right now. Please try again.");
  }
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
