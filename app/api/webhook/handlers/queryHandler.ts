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
      let startDate: string, endDate: string | undefined;
      if (parsed.period === 'specific_month' && parsed.month) {
        startDate = parsed.month + '-01';
        endDate   = parsed.month + '-' + new Date(
          parseInt(parsed.month.split('-')[0]),
          parseInt(parsed.month.split('-')[1]),
          0
        ).getDate().toString().padStart(2, '0');
      } else if (parsed.period === 'mtd') {
        startDate = monthStart;
        endDate   = today;
      } else {
        startDate = today;
        endDate   = undefined;
      }

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

      const label        = parsed.metric === 'sales' ? 'Sales' : 'Expenses';
      const period_label = parsed.period === 'specific_month' && parsed.month
        ? new Date(parsed.month + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' })
        : parsed.period === 'mtd'
        ? `${new Date().toLocaleString('en-IN', { month: 'long' })} so far`
        : 'Today';

      await sendMessage(from, `${period_label}'s ${label}: ₹${total.toLocaleString('en-IN')}`);
      return;
    }

    // ── query_items: top ingredients by spend ────────────────────────────
    if (parsed?.intent === 'query_items') {
      let startDate: string, endDate: string;
      if (parsed.period === 'specific_date' && parsed.date) {
        startDate = parsed.date; endDate = parsed.date;
      } else if (parsed.period === 'specific_month' && parsed.month) {
        const [y, m] = parsed.month.split('-').map(Number);
        startDate = parsed.month + '-01';
        endDate   = new Date(y, m, 0).toISOString().split('T')[0];
      } else if (parsed.period === 'today') {
        startDate = today; endDate = today;
      } else {
        startDate = monthStart; endDate = today;
      }

      const limit = parsed.limit || 5;

      const { data: items } = await supabase
        .from('invoice_items')
        .select('item_canonical, unit_normalised, quantity_normalised, amount, vendor')
        .eq('restaurant_id', restaurantId)
        .gte('date', startDate)
        .lte('date', endDate)
        .not('item_canonical', 'is', null)
        .not('item_canonical', 'ilike', '%delivery%')
        .not('item_canonical', 'ilike', '%small order%');

      if (!items || items.length === 0) {
        await sendMessage(from, 'No item-level data found for this period.');
        return;
      }

      // Apply vendor filter in JS
      const filtered = parsed.vendor_filter
        ? (items as any[]).filter((r: any) =>
            (r.vendor || '').toLowerCase().includes(parsed.vendor_filter))
        : (items as any[]);

      // Aggregate by item_canonical
      const grouped: Record<string, { qty: number; unit: string; spend: number }> = {};
      filtered.forEach((r: any) => {
        const key = r.item_canonical as string;
        if (!grouped[key]) grouped[key] = { qty: 0, unit: r.unit_normalised || 'Pc', spend: 0 };
        grouped[key].qty   += Number(r.quantity_normalised || 0);
        grouped[key].spend += Number(r.amount || 0);
      });

      const sortKey = parsed.sort_by === 'weight' ? 'qty' : 'spend';
      const sorted  = Object.entries(grouped)
        .sort((a, b) => b[1][sortKey] - a[1][sortKey])
        .slice(0, limit);

      if (sorted.length === 0) {
        await sendMessage(from, 'No item-level data found for this period.');
        return;
      }

      const grandTotal  = sorted.reduce((s, [, d]) => s + d.spend, 0);
      const sortLabel   = parsed.sort_by === 'weight' ? 'by Weight' : 'by Value';
      const vendorLabel = parsed.vendor_filter
        ? ` (${parsed.vendor_filter.charAt(0).toUpperCase() + parsed.vendor_filter.slice(1)})`
        : '';

      let periodLabel: string;
      if (parsed.period === 'specific_date' && parsed.date) {
        periodLabel = new Date(parsed.date + 'T00:00:00').toLocaleDateString('en-IN',
          { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
      } else if (parsed.period === 'specific_month' && parsed.month) {
        periodLabel = new Date(parsed.month + '-01').toLocaleString('en-IN',
          { month: 'long', year: 'numeric' });
      } else if (parsed.period === 'today') {
        periodLabel = 'Today';
      } else {
        periodLabel = `${new Date().toLocaleString('en-IN', { month: 'long' })} so far`;
      }

      const lines = sorted.map(([name, d], idx) => {
        const qtyDisplay = d.qty > 0 ? ` (${d.qty.toFixed(2)} ${d.unit})` : '';
        return `${idx + 1}. ${name} — ₹${d.spend.toLocaleString('en-IN')}${qtyDisplay}`;
      });

      await sendMessage(from,
        `🛒 *Top Items ${sortLabel} — ${periodLabel}${vendorLabel}*\n\n${lines.join('\n')}\n\nTotal: ₹${grandTotal.toLocaleString('en-IN')}`
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

    // ── query_vendor_breakdown: expense split by vendor ──────────────────
    if (parsed?.intent === 'query_vendor_breakdown') {
      let startDate: string, endDate: string;
      if (parsed.period === 'specific_month' && parsed.month) {
        const [y, m] = parsed.month.split('-').map(Number);
        startDate = parsed.month + '-01';
        endDate   = new Date(y, m, 0).toISOString().split('T')[0];
      } else if (parsed.period === 'today') {
        startDate = today; endDate = today;
      } else {
        startDate = monthStart; endDate = today;
      }

      const { data: items } = await supabase
        .from('invoice_items')
        .select('vendor, amount')
        .eq('restaurant_id', restaurantId)
        .gte('date', startDate)
        .lte('date', endDate);

      if (!items || items.length === 0) {
        await sendMessage(from, 'No expense data found for this period.');
        return;
      }

      const normalise = (v: string) => {
        const lv = (v || '').toLowerCase();
        if (lv.includes('hyperpure') || lv.includes('zomato')) return 'Hyperpure';
        if (lv.includes('bigbasket') || lv.includes('bbnow') ||
            lv.includes('bb now') || lv.includes('innovative retail')) return 'BigBasket';
        if (lv.includes('dmart') || lv.includes('avenue e-commerce') ||
            lv.includes('avenue e commerce')) return 'DMart';
        return v.trim();
      };

      const grouped: Record<string, number> = {};
      (items as any[]).forEach(r => {
        const key = normalise(r.vendor);
        grouped[key] = (grouped[key] || 0) + Number(r.amount);
      });

      const sorted     = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
      const grandTotal = sorted.reduce((s, [, v]) => s + v, 0);

      const periodLabel = parsed.period === 'specific_month' && parsed.month
        ? new Date(parsed.month + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' })
        : parsed.period === 'today' ? 'Today'
        : `${new Date().toLocaleString('en-IN', { month: 'long' })} so far`;

      const lines = sorted.map(([vendor, spend], idx) =>
        `${idx + 1}. ${vendor} — ₹${spend.toLocaleString('en-IN')}`
      );

      await sendMessage(from,
        `📊 *Expenses by Vendor — ${periodLabel}*\n\n${lines.join('\n')}\n\nTotal: ₹${grandTotal.toLocaleString('en-IN')}`
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
