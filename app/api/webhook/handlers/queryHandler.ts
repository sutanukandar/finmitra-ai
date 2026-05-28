import { dataService } from '../../../../lib/db/dataService';
import { ParsedIntent } from '../types';

export async function handlePnlQuery(
  from: string,
  restaurantId: string,
  body: string,
  parsed?: ParsedIntent
) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.slice(0, 7) + '-01';

    // ── query_specific: single-metric answer ─────────────────────────────
    if (parsed?.intent === 'query_specific') {
      const period = parsed.period === 'mtd' ? 'mtd' : 'today';
      const startDate = period === 'mtd' ? monthStart : today;
      const endDate   = period === 'mtd' ? today : undefined;

      const { data: entries, error } = await dataService.getPnlData(restaurantId, startDate, endDate);

      if (error || !entries || entries.length === 0) {
        await sendMessage(from, "No data found for this period yet.");
        return;
      }

      let total = 0;
      entries.forEach((e: any) => {
        if (parsed.metric === 'sales') {
          total += (e.sales || 0) + (e.swiggy || 0) + (e.zomato || 0) + (e.phonepe || 0);
        } else {
          total += (e.hyperpure || 0) + (e.bigbasket || 0) + (e.milk || 0) +
                   (e.bread || 0) + (e.other || 0);
        }
      });

      const label  = parsed.metric === 'sales' ? 'Sales' : 'Expenses';
      const period_label = period === 'mtd'
        ? `${new Date().toLocaleString('en-IN', { month: 'long' })} so far`
        : 'Today';

      await sendMessage(from, `${period_label}'s ${label}: ₹${total.toLocaleString('en-IN')}`);
      return;
    }

    // ── query_items: top ingredients by spend ────────────────────────────
    if (parsed?.intent === 'query_items') {
      const period = parsed.period === 'today' ? 'today' : 'mtd';
      const startDate = period === 'today' ? today : monthStart;
      const endDate   = period === 'today' ? undefined : today;
      const periodLabel = period === 'today' ? 'Today' : `${new Date().toLocaleString('en-IN', { month: 'long' })} so far`;

      const items = await dataService.getTopItemsBySpend(restaurantId, startDate, endDate);

      if (items.length === 0) {
        await sendMessage(from, "No purchase data found for this period yet.");
        return;
      }

      const totalSpend = items.reduce((s, i) => s + i.total_spend, 0);
      const lines = items.map((item, idx) => {
        const vendorStr = item.vendors.join(' + ');
        return `${idx + 1}. ${item.item_name} — ₹${item.total_spend.toLocaleString('en-IN')} (${vendorStr}, ${item.times_purchased} purchase${item.times_purchased > 1 ? 's' : ''})`;
      });

      await sendMessage(from,
        `🛒 *Top Items by Spend — ${periodLabel}*\n\n${lines.join('\n')}\n\nTotal tracked: ₹${totalSpend.toLocaleString('en-IN')}`
      );
      return;
    }

    // ── full P&L summary ─────────────────────────────────────────────────
    let startDate = today;
    let endDate: string | undefined;

    if (body.includes('aaj') || body.includes('today') || body.includes('p&l')) {
      startDate = today;
    } else if (body.includes('kal') || body.includes('yesterday')) {
      startDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    } else if (body.includes('this month') || body.includes('month') ||
               parsed?.intent === 'query_mtd') {
      startDate = monthStart;
      endDate   = today;
    } else {
      await sendMessage(from, "Please specify period like `aaj ka P&L`, `this month`, or `kal ka P&L`");
      return;
    }

    const { data: entries, error } = await dataService.getPnlData(restaurantId, startDate, endDate);

    if (error || !entries || entries.length === 0) {
      await sendMessage(from, "No data found for this period yet.");
      return;
    }

    let revenue = 0, cogs = 0, fixed = 0;

    entries.forEach((e: any) => {
      revenue += (e.sales || 0) + (e.swiggy || 0) + (e.zomato || 0) + (e.phonepe || 0);
      cogs    += (e.hyperpure || 0) + (e.bigbasket || 0) + (e.milk || 0) +
                 (e.bread || 0) + (e.other || 0);
      fixed   += (e.rent || 0) + (e.electricity || 0) + (e.gas || 0) +
                 (e.salary || 0) + (e.fixed || 0);
    });

    const grossProfit = revenue - cogs;
    const netProfit   = grossProfit - fixed;
    const margin      = revenue > 0 ? Math.round((grossProfit / revenue) * 100) : 0;
    const periodLabel = endDate ? 'This Month' : body.includes('kal') ? 'Yesterday' : 'Today';

    await sendMessage(from, `📊 *P&L Summary*

Revenue     : ₹${revenue.toLocaleString('en-IN')}
COGS        : ₹${cogs.toLocaleString('en-IN')}
Gross Profit: ₹${grossProfit.toLocaleString('en-IN')} (${margin}%)
Fixed Cost  : ₹${fixed.toLocaleString('en-IN')}
Net Profit  : ₹${netProfit.toLocaleString('en-IN')}

Period: ${periodLabel}`);

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
