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
    // Use IST date — Vercel runs UTC; without offset early-morning queries
    // return yesterday's date and the wrong day's data
    const today      = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
    const monthStart = today.slice(0, 7) + '-01';
    console.log(`[QueryHandler] intent=${parsed?.intent} period=${parsed?.period} today(IST)=${today}`);

    // ── query_specific: multi-month comparison ───────────────────────────
    if (parsed?.intent === 'query_specific' &&
        parsed.period === 'multi_month' &&
        parsed.months && parsed.months.length > 0) {

      const startDate = parsed.months[0] + '-01';
      const lastMonth = parsed.months[parsed.months.length - 1];
      const [ly, lm]  = lastMonth.split('-').map(Number);
      const endDate   = new Date(ly, lm, 0).toISOString().split('T')[0];

      const { data: entries } = await supabase
        .from('pnl_entries')
        .select('date, sales, phonepe, swiggy, zomato, hyperpure, bigbasket, milk, bread, water, other, rent, electricity, salary, fixed, gas')
        .eq('restaurant_id', restaurantId)
        .gte('date', startDate)
        .lte('date', endDate);

      if (!entries || entries.length === 0) {
        await sendMessage(from, 'No data found for this period.');
        return;
      }

      const byMonth: Record<string, { revenue: number; cogs: number; fixed: number }> = {};
      parsed.months.forEach((mo: string) => { byMonth[mo] = { revenue: 0, cogs: 0, fixed: 0 }; });

      entries.forEach((e: any) => {
        const mo = (e.date as string).slice(0, 7);
        if (!byMonth[mo]) return;
        byMonth[mo].revenue += (Number(e.sales) || 0) + (Number(e.phonepe) || 0) +
                               (Number(e.swiggy) || 0) + (Number(e.zomato) || 0);
        byMonth[mo].cogs    += (Number(e.hyperpure) || 0) + (Number(e.bigbasket) || 0) +
                               (Number(e.milk) || 0) + (Number(e.bread) || 0) +
                               (Number(e.water) || 0) + (Number(e.other) || 0);
        byMonth[mo].fixed   += (Number(e.rent) || 0) + (Number(e.electricity) || 0) +
                               (Number(e.salary) || 0) + (Number(e.fixed) || 0) + (Number(e.gas) || 0);
      });

      const lines = parsed.months.map((mo: string) => {
        const d = byMonth[mo];
        const monthLabel = new Date(mo + '-01').toLocaleString('en-IN', { month: 'short', year: 'numeric' });
        if (parsed.metric === 'cogs_pct_revenue') {
          const pct = d.revenue > 0 ? ((d.cogs / d.revenue) * 100).toFixed(1) : 'N/A';
          return `${monthLabel}: ${pct}% (₹${Math.round(d.cogs).toLocaleString('en-IN')} ÷ ₹${Math.round(d.revenue).toLocaleString('en-IN')})`;
        }
        if (parsed.metric === 'gross_margin_pct') {
          const gp  = d.revenue - d.cogs;
          const pct = d.revenue > 0 ? ((gp / d.revenue) * 100).toFixed(1) : 'N/A';
          return `${monthLabel}: ${pct}% (₹${Math.round(gp).toLocaleString('en-IN')})`;
        }
        if (parsed.metric === 'net_margin_pct') {
          const np  = d.revenue - d.cogs - d.fixed;
          const pct = d.revenue > 0 ? ((np / d.revenue) * 100).toFixed(1) : 'N/A';
          return `${monthLabel}: ${pct}% (₹${Math.round(np).toLocaleString('en-IN')})`;
        }
        return `${monthLabel}: ₹${Math.round(d.revenue).toLocaleString('en-IN')}`;
      });

      const metricLabel: Record<string, string> = {
        cogs_pct_revenue: 'COGS % of Revenue',
        gross_margin_pct: 'Gross Margin',
        net_margin_pct:   'Net Margin',
        sales:            'Revenue',
        cogs:             'Expenses',
      };

      const metric = parsed.metric ?? '';
      await sendMessage(from, `📊 *${metricLabel[metric] || metric}*\n\n${lines.join('\n')}`);
      return;
    }

    // ── query_specific: single-metric answer ─────────────────────────────
    if (parsed?.intent === 'query_specific') {
      let startDate: string, endDate: string, period_label: string;

      if (parsed.period === 'specific_date' && parsed.date) {
        startDate    = parsed.date;
        endDate      = parsed.date;
        period_label = new Date(parsed.date + 'T00:00:00').toLocaleDateString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata'
        });
      } else if (parsed.period === 'specific_month' && parsed.month) {
        const [y, m] = parsed.month.split('-').map(Number);
        startDate    = `${parsed.month}-01`;
        endDate      = new Date(y, m, 0).toISOString().split('T')[0];
        period_label = new Date(`${parsed.month}-01`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      } else if (parsed.period === 'mtd') {
        startDate    = monthStart;
        endDate      = today;
        period_label = `${new Date().toLocaleString('en-IN', { month: 'long' })} so far`;
      } else {
        startDate    = today;
        endDate      = today;
        period_label = 'Today';
      }

      const { data: entries, error } = await dataService.getPnlData(restaurantId, startDate, endDate);

      if (error || !entries || entries.length === 0) {
        await sendMessage(from, "No data found for this period yet.");
        return;
      }

      let sales = 0, swiggy = 0, zomato = 0, phonepe = 0;
      let hyperpure = 0, bigbasket = 0, milk = 0, bread = 0, water = 0, other = 0;
      let rent = 0, electricity = 0, salary = 0, fixed = 0, gas = 0;

      entries.forEach((e: any) => {
        sales      += e.sales       || 0;
        swiggy     += e.swiggy      || 0;
        zomato     += e.zomato      || 0;
        phonepe    += e.phonepe     || 0;
        hyperpure  += e.hyperpure   || 0;
        bigbasket  += e.bigbasket   || 0;
        milk       += e.milk        || 0;
        bread      += e.bread       || 0;
        water      += e.water       || 0;
        other      += e.other       || 0;
        rent       += e.rent        || 0;
        electricity+= e.electricity || 0;
        salary     += e.salary      || 0;
        fixed      += e.fixed       || 0;
        gas        += e.gas         || 0;
      });

      const revenue    = sales + swiggy + zomato + phonepe;
      const cogs       = hyperpure + bigbasket + milk + bread + water + other;
      const fixedTotal = rent + electricity + salary + fixed + gas;

      let reply: string;

      if (parsed.metric === 'cogs_pct_revenue') {
        const pct = revenue > 0 ? ((cogs / revenue) * 100).toFixed(1) : '0';
        reply = `${period_label} COGS is ${pct}% of Revenue\n(₹${cogs.toLocaleString('en-IN')} COGS ÷ ₹${revenue.toLocaleString('en-IN')} Revenue)`;
      } else if (parsed.metric === 'gross_margin_pct') {
        const grossProfit = revenue - cogs;
        const pct = revenue > 0 ? ((grossProfit / revenue) * 100).toFixed(1) : '0';
        reply = `${period_label} Gross Margin: ${pct}%\n(₹${grossProfit.toLocaleString('en-IN')} ÷ ₹${revenue.toLocaleString('en-IN')} Revenue)`;
      } else if (parsed.metric === 'net_margin_pct') {
        const netProfit = revenue - cogs - fixedTotal;
        const pct = revenue > 0 ? ((netProfit / revenue) * 100).toFixed(1) : '0';
        reply = `${period_label} Net Margin: ${pct}%\n(₹${netProfit.toLocaleString('en-IN')} ÷ ₹${revenue.toLocaleString('en-IN')} Revenue)`;
      } else if (parsed.metric === 'sales') {
        reply = `${period_label} Sales: ₹${revenue.toLocaleString('en-IN')}`;
      } else {
        reply = `${period_label} Expenses: ₹${cogs.toLocaleString('en-IN')}`;
      }

      await sendMessage(from, reply);
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

    // ── query_daily_breakdown: day-by-day values for one metric ─────────
    if (parsed?.intent === 'query_daily_breakdown') {
      let startDate: string, endDate: string, periodLabel: string;

      if (parsed.period === 'last_n_days') {
        const n     = parsed.days || 7;
        const end   = new Date();
        const start = new Date();
        start.setDate(end.getDate() - (n - 1));
        startDate   = start.toISOString().split('T')[0];
        endDate     = end.toISOString().split('T')[0];
        periodLabel = `Last ${n} Days`;
      } else if (parsed.period === 'last_n_days_of_month' && parsed.month) {
        const [y, m] = parsed.month.split('-').map(Number);
        const n      = parsed.days || 7;
        const lastDay  = new Date(y, m, 0);
        const firstDay = new Date(lastDay);
        firstDay.setDate(lastDay.getDate() - (n - 1));
        startDate   = firstDay.toISOString().split('T')[0];
        endDate     = lastDay.toISOString().split('T')[0];
        periodLabel = `Last ${n} Days of ${lastDay.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}`;
      } else if (parsed.period === 'specific_month' && parsed.month) {
        const [y, m] = parsed.month.split('-').map(Number);
        startDate    = `${parsed.month}-01`;
        endDate      = new Date(y, m, 0).toISOString().split('T')[0];
        periodLabel  = new Date(`${parsed.month}-01`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      } else {
        startDate   = monthStart;
        endDate     = today;
        periodLabel = `${new Date().toLocaleString('en-IN', { month: 'long' })} so far`;
      }

      const { data: entries } = await supabase
        .from('pnl_entries')
        .select('date, sales, phonepe, swiggy, zomato, hyperpure, bigbasket, milk, bread, water, other, rent, electricity, salary, fixed, gas')
        .eq('restaurant_id', restaurantId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (!entries || entries.length === 0) {
        await sendMessage(from, 'No data found for this period.');
        return;
      }

      const metric = parsed.metric || 'revenue';

      const getValue = (e: any): number => {
        if (metric === 'revenue')
          return (Number(e.sales) || 0) + (Number(e.phonepe) || 0) +
                 (Number(e.swiggy) || 0) + (Number(e.zomato) || 0);
        if (metric === 'cogs')
          return (Number(e.hyperpure) || 0) + (Number(e.bigbasket) || 0) +
                 (Number(e.milk) || 0) + (Number(e.bread) || 0) +
                 (Number(e.water) || 0) + (Number(e.other) || 0);
        if (metric === 'fixed')
          return (Number(e.rent) || 0) + (Number(e.electricity) || 0) +
                 (Number(e.salary) || 0) + (Number(e.fixed) || 0) + (Number(e.gas) || 0);
        return Number(e[metric]) || 0;
      };

      const metricLabel = metric.charAt(0).toUpperCase() + metric.slice(1);

      const lines = (entries as any[])
        .map(e => ({
          dateLabel: new Date(e.date + 'T00:00:00').toLocaleDateString('en-IN', {
            weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata'
          }),
          val: getValue(e),
        }))
        .filter(({ val }) => val > 0)
        .map(({ dateLabel, val }) => `${dateLabel}: ₹${val.toLocaleString('en-IN')}`);

      if (lines.length === 0) {
        await sendMessage(from, `No ${metricLabel} data found for ${periodLabel}.`);
        return;
      }

      const total = (entries as any[]).reduce((s, e) => s + getValue(e), 0);

      await sendMessage(from,
        `📅 *${metricLabel} — ${periodLabel}*\n\n${lines.join('\n')}\n\nTotal: ₹${total.toLocaleString('en-IN')}`
      );
      return;
    }

    // ── full P&L summary (query_today / query_mtd / query_pnl) ──────────
    let startDate = today;
    let endDate: string | undefined;
    let periodLabel = 'Today';

    if (parsed?.intent === 'query_pnl' && parsed.period === 'specific_month' && parsed.month) {
      const [y, m] = parsed.month.split('-').map(Number);
      startDate   = `${parsed.month}-01`;
      endDate     = new Date(y, m, 0).toISOString().split('T')[0];
      periodLabel = new Date(`${parsed.month}-01`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    } else if (parsed?.intent === 'query_pnl' && parsed.period === 'yesterday') {
      startDate   = new Date(Date.now() + 5.5 * 60 * 60 * 1000 - 86400000).toISOString().split('T')[0];
      endDate     = startDate;
      periodLabel = 'Yesterday';
    } else if (parsed?.intent === 'query_mtd' ||
               (parsed?.intent === 'query_pnl' && parsed.period === 'mtd') ||
               body.includes('this month') || body.includes('month')) {
      startDate   = monthStart;
      endDate     = today;
      periodLabel = `${new Date(today).toLocaleString('en-IN', { month: 'long' })} so far`;
    } else if (body.includes('kal') || body.includes('yesterday')) {
      startDate   = new Date(Date.now() + 5.5 * 60 * 60 * 1000 - 86400000).toISOString().split('T')[0];
      endDate     = startDate;
      periodLabel = 'Yesterday';
    } else if (body.includes('aaj') || body.includes('today') || body.includes('p&l') ||
               parsed?.intent === 'query_today' || parsed?.intent === 'query_pnl') {
      startDate   = today;
      endDate     = today;
      periodLabel = 'Today';
    } else {
      await sendMessage(from, "Please specify period like `aaj ka P&L`, `this month`, or `P&L for Mar 2026`");
      return;
    }

    console.log(`[QueryHandler] P&L query startDate=${startDate} endDate=${endDate} label=${periodLabel}`);
    const { data: entries, error } = await dataService.getPnlData(restaurantId, startDate, endDate);

    if (error || !entries || entries.length === 0) {
      await sendMessage(from, "No data found for this period yet.");
      return;
    }

    let sales = 0, swiggy = 0, zomato = 0, phonepe = 0;
    let hyperpure = 0, bigbasket = 0, milk = 0, bread = 0, water = 0, other = 0;
    let rent = 0, salary = 0, electricity = 0, gas = 0, fixedAmt = 0;

    entries.forEach((e: any) => {
      sales      += e.sales      || 0;
      swiggy     += e.swiggy     || 0;
      zomato     += e.zomato     || 0;
      phonepe    += e.phonepe    || 0;
      hyperpure  += e.hyperpure  || 0;
      bigbasket  += e.bigbasket  || 0;
      milk       += e.milk       || 0;
      bread      += e.bread      || 0;
      water      += e.water      || 0;
      other      += e.other      || 0;
      rent       += e.rent       || 0;
      salary     += e.salary     || 0;
      electricity+= e.electricity|| 0;
      gas        += e.gas        || 0;
      fixedAmt   += e.fixed      || 0;
    });

    const revenue    = sales + swiggy + zomato + phonepe;
    const cogs       = hyperpure + bigbasket + milk + bread + water + other;
    const fixedTotal = rent + salary + electricity + gas + fixedAmt;
    const grossProfit = revenue - cogs;
    const netProfit   = grossProfit - fixedTotal;

    // Only show line items that have a non-zero value
    const qrSales = phonepe + sales;
    const revLines: string[] = [];
    revLines.push(`Sales (QR/Online) : ₹${qrSales.toLocaleString('en-IN')}`);
    if (swiggy) revLines.push(`Swiggy            : ₹${swiggy.toLocaleString('en-IN')}`);
    if (zomato) revLines.push(`Zomato            : ₹${zomato.toLocaleString('en-IN')}`);

    const cogsLines: string[] = [];
    if (hyperpure) cogsLines.push(`Hyperpure  : ₹${hyperpure.toLocaleString('en-IN')}`);
    if (bigbasket) cogsLines.push(`BigBasket  : ₹${bigbasket.toLocaleString('en-IN')}`);
    if (milk)      cogsLines.push(`Milk       : ₹${milk.toLocaleString('en-IN')}`);
    if (bread)     cogsLines.push(`Bread      : ₹${bread.toLocaleString('en-IN')}`);
    if (water)     cogsLines.push(`Water      : ₹${water.toLocaleString('en-IN')}`);
    if (other)     cogsLines.push(`Other      : ₹${other.toLocaleString('en-IN')}`);

    const fixedLines: string[] = [];
    if (rent)        fixedLines.push(`Rent       : ₹${rent.toLocaleString('en-IN')}`);
    if (salary)      fixedLines.push(`Salary     : ₹${salary.toLocaleString('en-IN')}`);
    if (electricity) fixedLines.push(`Electricity: ₹${electricity.toLocaleString('en-IN')}`);
    if (gas)         fixedLines.push(`Gas        : ₹${gas.toLocaleString('en-IN')}`);
    if (fixedAmt)    fixedLines.push(`Fixed      : ₹${fixedAmt.toLocaleString('en-IN')}`);

    const replyParts: string[] = [`📊 *P&L Summary — ${periodLabel}*`];

    replyParts.push(
      `\n💰 *Revenue*\n${revLines.length ? revLines.join('\n') : '(none)'}\n*Total     : ₹${revenue.toLocaleString('en-IN')}*`
    );
    replyParts.push(
      `\n🛒 *COGS*\n${cogsLines.length ? cogsLines.join('\n') : '(none)'}\n*Total     : ₹${cogs.toLocaleString('en-IN')}*`
    );
    replyParts.push(
      `\n🏢 *Fixed Costs*\n${fixedLines.length ? fixedLines.join('\n') : '(none)'}\n*Total     : ₹${fixedTotal.toLocaleString('en-IN')}*`
    );
    replyParts.push(
      `\n📈 *Gross Profit : ₹${grossProfit.toLocaleString('en-IN')}*\n📉 *Net Profit   : ₹${netProfit.toLocaleString('en-IN')}*`
    );

    await sendMessage(from, replyParts.join('\n'));

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
