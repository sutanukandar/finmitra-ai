import { createClient } from '@supabase/supabase-js';
import { dataService } from '../../../../lib/db/dataService';
import { ParsedIntent } from '../types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
      let startDate: string, endDate: string;
      if (parsed.period === 'specific_date' && parsed.date) {
        startDate = parsed.date;
        endDate   = parsed.date;
      } else if (parsed.period === 'today') {
        startDate = today;
        endDate   = today;
      } else {
        startDate = monthStart;
        endDate   = today;
      }

      const limit = parsed.limit || 5;

      let query = supabase
        .from('invoice_items')
        .select('item_name, vendor, quantity, unit, rate, amount')
        .eq('restaurant_id', restaurantId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('amount', { ascending: false });

      if (parsed.vendor_filter) {
        const vendorKeyword: Record<string, string> = {
          hyperpure: 'Hyperpure',
          bigbasket: 'BigBasket',
          dmart: 'DMart'
        };
        const kw = vendorKeyword[parsed.vendor_filter];
        if (kw) query = query.ilike('vendor', `%${kw}%`);
      }

      const { data: items } = await query.limit(limit);

      if (!items || items.length === 0) {
        await sendMessage(from, "No item-level data found for this period.");
        return;
      }

      const periodLabel = parsed.period === 'specific_date' && parsed.date
        ? new Date(parsed.date + 'T00:00:00').toLocaleDateString('en-IN',
            { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
        : parsed.period === 'today'
        ? 'Today'
        : `${new Date().toLocaleString('en-IN', { month: 'long' })} so far`;

      const vendorLabel = parsed.vendor_filter
        ? ` (${parsed.vendor_filter.charAt(0).toUpperCase() + parsed.vendor_filter.slice(1)})`
        : '';

      const total = (items as any[]).reduce((sum, i) => sum + Number(i.amount), 0);
      const lines = (items as any[]).map((item, idx) => {
        const qty  = Number(item.quantity);
        const rate = Number(item.rate);
        const amt  = Number(item.amount);
        return `${idx + 1}. ${item.item_name} — ₹${amt.toLocaleString('en-IN')} (${qty} ${item.unit || 'pc'} @ ₹${rate})`;
      });

      await sendMessage(from,
        `🛒 *Top Items by Spend — ${periodLabel}${vendorLabel}*\n\n${lines.join('\n')}\n\nTotal: ₹${total.toLocaleString('en-IN')}`
      );
      return;
    }

    // ── query_ingredient: single ingredient deep-dive ────────────────────
    if (parsed?.intent === 'query_ingredient') {
      const ingredient = parsed.ingredient || '';
      if (!ingredient) {
        await sendMessage(from, "Which ingredient would you like to check? e.g. \"how much Carrot did I buy this month\"");
        return;
      }

      let startDate: string, endDate: string;
      if (parsed.period === 'specific_month' && parsed.month) {
        startDate = parsed.month + '-01';
        const d = new Date(startDate);
        endDate = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
      } else if (parsed.period === 'today') {
        startDate = today;
        endDate   = today;
      } else {
        startDate = monthStart;
        endDate   = today;
      }

      const { data: rows } = await supabase
        .from('invoice_items')
        .select('item_name, item_canonical, vendor, quantity_normalised, unit_normalised, quantity, unit, amount, date')
        .eq('restaurant_id', restaurantId)
        .ilike('item_canonical', `%${ingredient}%`)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (!rows || rows.length === 0) {
        await sendMessage(from, `No ${ingredient} purchases found for this period.`);
        return;
      }

      const totalSpend   = (rows as any[]).reduce((s, r) => s + Number(r.amount), 0);
      const totalQtyNorm = (rows as any[]).reduce((s, r) => s + Number(r.quantity_normalised || r.quantity || 0), 0);
      const unit         = (rows[0] as any).unit_normalised || (rows[0] as any).unit || 'units';
      const avgRate      = totalQtyNorm > 0 ? totalSpend / totalQtyNorm : 0;

      const byVendor: Record<string, { qty: number; spend: number }> = {};
      (rows as any[]).forEach(r => {
        const v = r.vendor || 'Unknown';
        if (!byVendor[v]) byVendor[v] = { qty: 0, spend: 0 };
        byVendor[v].qty   += Number(r.quantity_normalised || r.quantity || 0);
        byVendor[v].spend += Number(r.amount);
      });

      const vendorLines = Object.entries(byVendor)
        .sort((a, b) => b[1].spend - a[1].spend)
        .map(([v, d]) => `  • ${v}: ${d.qty.toFixed(2)} ${unit} — ₹${d.spend.toLocaleString('en-IN')}`)
        .join('\n');

      const periodLabel = parsed.period === 'specific_month' && parsed.month
        ? new Date(parsed.month + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' })
        : parsed.period === 'today'
        ? 'Today'
        : `${new Date().toLocaleString('en-IN', { month: 'long' })} so far`;

      await sendMessage(from,
`📦 *${ingredient} — ${periodLabel}*

Total bought : ${totalQtyNorm.toFixed(2)} ${unit}
Total spent  : ₹${totalSpend.toLocaleString('en-IN')}
Avg rate     : ₹${avgRate.toFixed(0)}/${unit}
Purchases    : ${rows.length}

By vendor:
${vendorLines}`
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
