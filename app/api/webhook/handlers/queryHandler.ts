import { createClient } from '@supabase/supabase-js';
import { dataService } from '../../../../lib/db/dataService';
import { ParsedIntent } from '../types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FIXED_COLUMNS = [
  { key: 'rent',        label: 'Rent' },
  { key: 'salary',      label: 'Salary' },
  { key: 'electricity', label: 'Electricity' },
  { key: 'gas',         label: 'Gas' },
  { key: 'pg',          label: 'Staff PG' },
  { key: 'internet',    label: 'Internet' },
  { key: 'garbage',     label: 'Garbage' },
  { key: 'repairs',     label: 'Repairs' },
  { key: 'marketing',   label: 'Marketing' },
  { key: 'misc',        label: 'Misc' },
  { key: 'fixed',       label: 'Fixed' },
] as const;

const FIXED_THRESHOLD = 2000;

const PNL_SELECT = 'date, sales, phonepe, swiggy, zomato, hyperpure, bigbasket, milk, bread, water, other, rent, electricity, salary, gas, fixed, pg, internet, garbage, repairs, marketing, misc';

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
        .select(PNL_SELECT)
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
        byMonth[mo].fixed   += FIXED_COLUMNS.reduce(
          (s, { key }) => s + (Number(e[key]) || 0), 0
        );
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

      entries.forEach((e: any) => {
        sales     += e.sales     || 0;
        swiggy    += e.swiggy    || 0;
        zomato    += e.zomato    || 0;
        phonepe   += e.phonepe   || 0;
        hyperpure += e.hyperpure || 0;
        bigbasket += e.bigbasket || 0;
        milk      += e.milk      || 0;
        bread     += e.bread     || 0;
        water     += e.water     || 0;
        other     += e.other     || 0;
      });

      const revenue    = sales + swiggy + zomato + phonepe;
      const cogs       = hyperpure + bigbasket + milk + bread + water + other;
      const fixedTotal = (entries as any[]).reduce(
        (s, e) => s + FIXED_COLUMNS.reduce((fs, { key }) => fs + (Number(e[key]) || 0), 0), 0
      );

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

      // Ingredients that can also appear as direct pnl_entries columns
      const pnlColumnMap: Record<string, string> = {
        milk:  'milk',
        bread: 'bread',
        water: 'water',
      };
      const pnlColumn = pnlColumnMap[ingredient.toLowerCase()];

      // Fetch pnl_entries total for milk/bread/water (WhatsApp/Excel direct entries)
      let pnlTotal = 0;
      if (pnlColumn) {
        const { data: pnlRows } = await supabase
          .from('pnl_entries')
          .select(`date, ${pnlColumn}`)
          .eq('restaurant_id', restaurantId)
          .gte('date', startDate)
          .lte('date', endDate);

        pnlTotal = ((pnlRows || []) as any[]).reduce(
          (s, r) => s + Number(r[pnlColumn] || 0), 0
        );
      }

      const invoiceTotal = rows ? (rows as any[]).reduce((s, r) => s + Number(r.amount), 0) : 0;
      const grandTotal   = invoiceTotal + pnlTotal;

      if (!rows || rows.length === 0) {
        if (pnlTotal > 0) {
          const periodLabel2 = parsed.period === 'specific_month' && parsed.month
            ? new Date(parsed.month + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' })
            : parsed.period === 'today' ? 'Today'
            : `${new Date(today).toLocaleString('en-IN', { month: 'long' })} so far`;
          await sendMessage(from,
            `📦 *${ingredient} — ${periodLabel2}*\n\n` +
            `Total spent : ₹${pnlTotal.toLocaleString('en-IN')}\n\n` +
            `By source:\n  • Daily entries (WhatsApp/Excel): ₹${pnlTotal.toLocaleString('en-IN')}`
          );
        } else {
          await sendMessage(from, `No ${ingredient} purchases found for this period.`);
        }
        return;
      }

      const totalQtyNorm = (rows as any[]).reduce((s, r) => s + Number(r.quantity_normalised || r.quantity || 0), 0);
      const unit         = (rows[0] as any).unit_normalised || (rows[0] as any).unit || 'units';
      const avgRate      = totalQtyNorm > 0 && invoiceTotal > 0 ? invoiceTotal / totalQtyNorm : 0;

      const byVendor: Record<string, { qty: number; spend: number }> = {};
      (rows as any[]).forEach(r => {
        const v = r.vendor || 'Unknown';
        if (!byVendor[v]) byVendor[v] = { qty: 0, spend: 0 };
        byVendor[v].qty   += Number(r.quantity_normalised || r.quantity || 0);
        byVendor[v].spend += Number(r.amount);
      });

      const vendorLines = Object.entries(byVendor)
        .sort((a, b) => b[1].spend - a[1].spend)
        .map(([v, d]) => `  • ${v}: ${d.qty.toFixed(2)} ${unit} — ₹${d.spend.toLocaleString('en-IN')}`);

      if (pnlTotal > 0) {
        vendorLines.push(`  • Daily entries (WhatsApp/Excel): ₹${pnlTotal.toLocaleString('en-IN')}`);
      }

      const periodLabel = parsed.period === 'specific_month' && parsed.month
        ? new Date(parsed.month + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' })
        : parsed.period === 'today'
        ? 'Today'
        : `${new Date(today).toLocaleString('en-IN', { month: 'long' })} so far`;

      const purchasesLabel = `${rows.length}${pnlTotal > 0 ? ' (bills) + daily entries' : ''}`;

      await sendMessage(from,
`📦 *${ingredient} — ${periodLabel}*

Total bought : ${totalQtyNorm.toFixed(2)} ${unit}
Total spent  : ₹${grandTotal.toLocaleString('en-IN')}
Avg rate     : ₹${avgRate.toFixed(0)}/${unit}
Purchases    : ${purchasesLabel}

By source:
${vendorLines.join('\n')}`
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
        .select(PNL_SELECT)
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
        if (metric === 'sales' || metric === 'revenue')
          return (Number(e.sales) || 0) + (Number(e.phonepe) || 0) +
                 (Number(e.swiggy) || 0) + (Number(e.zomato) || 0);
        if (metric === 'cogs' || metric === 'item cost')
          return (Number(e.hyperpure) || 0) + (Number(e.bigbasket) || 0) +
                 (Number(e.milk) || 0) + (Number(e.bread) || 0) +
                 (Number(e.water) || 0) + (Number(e.other) || 0);
        if (metric === 'fixed')
          return (Number(e.rent) || 0) + (Number(e.electricity) || 0) +
                 (Number(e.salary) || 0) + (Number(e.fixed) || 0) +
                 (Number(e.gas) || 0) + (Number(e.pg) || 0) +
                 (Number(e.internet) || 0) + (Number(e.garbage) || 0) +
                 (Number(e.repairs) || 0) + (Number(e.marketing) || 0) +
                 (Number(e.misc) || 0);
        return Number(e[metric]) || 0;
      };

      const metricLabel = metric === 'sales' || metric === 'revenue'
        ? 'Total Sales'
        : metric.charAt(0).toUpperCase() + metric.slice(1);

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

    // ── query_upload_history: last bill or list of recent uploads ────────
    if (parsed?.intent === 'query_upload_history') {
      const vendor = parsed.vendor_filter || null;
      const target = parsed.target || 'last';
      const limit  = target === 'last' ? 1 : (parsed.limit || 5);

      let query = supabase
        .from('upload_records')
        .select('id, date, amount, pnl_field, created_at, metadata')
        .eq('restaurant_id', restaurantId);

      if (vendor) query = (query as any).eq('pnl_field', vendor);

      const { data: records } = await (query as any)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!records || records.length === 0) {
        const vendorLabel = vendor
          ? vendor.charAt(0).toUpperCase() + vendor.slice(1)
          : '';
        await sendMessage(from, `No ${vendorLabel} uploads found.`);
        return;
      }

      if (target === 'last') {
        const r         = records[0] as any;
        const vendorLabel = (r.pnl_field || 'Bill').charAt(0).toUpperCase() + (r.pnl_field || 'bill').slice(1);
        const billDate  = new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata'
        });
        const uploadedAt = new Date(r.created_at).toLocaleString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
        });

        const { data: items } = await supabase
          .from('invoice_items')
          .select('item_name, quantity, unit, amount')
          .eq('upload_record_id', r.id)
          .order('amount', { ascending: false })
          .limit(10);

        let reply =
          `📋 *Last ${vendorLabel} Bill*\n` +
          `Bill date : ${billDate}\n` +
          `Amount    : ₹${Number(r.amount).toLocaleString('en-IN')}\n` +
          `Uploaded  : ${uploadedAt}`;

        if (items && items.length > 0) {
          const itemLines = (items as any[])
            .map(i => `  • ${i.item_name} — ₹${Number(i.amount).toLocaleString('en-IN')}`)
            .join('\n');
          reply += `\n\nItems:\n${itemLines}`;
        }

        await sendMessage(from, reply);
      } else {
        const lines = (records as any[]).map((r, i) => {
          const vLabel = (r.pnl_field || 'Other').charAt(0).toUpperCase() + (r.pnl_field || 'other').slice(1);
          const uploaded = new Date(r.created_at).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata'
          });
          return `${i + 1}. ${vLabel} — ₹${Number(r.amount).toLocaleString('en-IN')} (${uploaded})`;
        });
        await sendMessage(from, `📋 *Recent Uploads*\n\n${lines.join('\n')}`);
      }
      return;
    }

    // ── query_pnl_detail: full breakdown ────────────────────────────────
    if (parsed?.intent === 'query_pnl_detail') {
      let detailStart: string, detailEnd: string, detailLabel: string;

      if (parsed.period && parsed.period !== 'from_context') {
        // Period supplied directly — resolve same as query_pnl
        if (parsed.period === 'specific_month' && parsed.month) {
          const [y, m] = parsed.month.split('-').map(Number);
          detailStart  = `${parsed.month}-01`;
          detailEnd    = new Date(y, m, 0).toISOString().split('T')[0];
          detailLabel  = new Date(`${parsed.month}-01`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
        } else if (parsed.period === 'yesterday') {
          detailStart = detailEnd = new Date(Date.now() + 5.5 * 60 * 60 * 1000 - 86400000).toISOString().split('T')[0];
          detailLabel = 'Yesterday';
        } else if (parsed.period === 'mtd') {
          detailStart = monthStart;
          detailEnd   = today;
          detailLabel = `${new Date(today).toLocaleString('en-IN', { month: 'long' })} so far`;
        } else {
          detailStart = detailEnd = today;
          detailLabel = 'Today';
        }
      } else {
        // No period — fall back to last pnl_context
        const { data: ctxRow } = await supabase
          .from('pending_confirmations')
          .select('payload')
          .eq('restaurant_id', restaurantId)
          .eq('action', 'pnl_context')
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const ctx   = ctxRow?.payload as any;
        detailStart = ctx?.startDate  || today;
        detailEnd   = ctx?.endDate    || today;
        detailLabel = ctx?.periodLabel || 'Today';
      }

      const { data: detailEntries } = await dataService.getPnlData(restaurantId, detailStart, detailEnd);

      if (!detailEntries || detailEntries.length === 0) {
        await sendMessage(from, "No data found for this period yet.");
        return;
      }

      await sendMessage(from, buildPnlBreakdown(detailEntries, detailLabel));
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

    // Compute totals for Level 1 summary
    const totals = computePnlTotals(entries);

    // Save context so "detail" can fetch the same period
    await dataService.createPendingConfirmation(restaurantId, {
      startDate, endDate: endDate || startDate, periodLabel
    }, 'pnl_context');

    const profit = totals.revenue - totals.cogs - totals.fixedTotal;
    const profitLine = profit >= 0
      ? `💵 *Profit   : ₹${Math.round(profit).toLocaleString('en-IN')}*`
      : `🔴 *Loss     : ₹${Math.round(Math.abs(profit)).toLocaleString('en-IN')}*`;

    const summary =
      `📊 *P&L — ${periodLabel}*\n\n` +
      `Total Sales  : ₹${Math.round(totals.revenue).toLocaleString('en-IN')}\n` +
      `Item Cost    : ₹${Math.round(totals.cogs).toLocaleString('en-IN')}\n` +
      `Fixed Cost   : ₹${Math.round(totals.fixedTotal).toLocaleString('en-IN')}\n\n` +
      `${profitLine}`;

    await sendMessage(from, summary);

  } catch (error) {
    console.error("[QueryHandler] Error:", error);
    await sendMessage(from, "Unable to fetch P&L right now. Please try again.");
  }
}

function computePnlTotals(entries: any[]) {
  let sales = 0, swiggy = 0, zomato = 0, phonepe = 0;
  let hyperpure = 0, bigbasket = 0, milk = 0, bread = 0, water = 0, other = 0;

  entries.forEach((e: any) => {
    sales     += e.sales     || 0;
    swiggy    += e.swiggy    || 0;
    zomato    += e.zomato    || 0;
    phonepe   += e.phonepe   || 0;
    hyperpure += e.hyperpure || 0;
    bigbasket += e.bigbasket || 0;
    milk      += e.milk      || 0;
    bread     += e.bread     || 0;
    water     += e.water     || 0;
    other     += e.other     || 0;
  });

  const fixedTotals: Record<string, number> = {};
  FIXED_COLUMNS.forEach(({ key }) => {
    fixedTotals[key] = entries.reduce((s, e) => s + (Number(e[key]) || 0), 0);
  });

  const revenue    = sales + swiggy + zomato + phonepe;
  const cogs       = hyperpure + bigbasket + milk + bread + water + other;
  const fixedTotal = FIXED_COLUMNS.reduce((s, { key }) => s + fixedTotals[key], 0);

  return { sales, swiggy, zomato, phonepe, hyperpure, bigbasket, milk, bread, water, other,
           fixedTotals, revenue, cogs, fixedTotal };
}

function buildPnlBreakdown(entries: any[], periodLabel: string): string {
  const t = computePnlTotals(entries);
  const profit = t.revenue - t.cogs - t.fixedTotal;

  const qrSales = t.phonepe + t.sales;
  const revLines: string[] = [];
  revLines.push(`QR / Online : ₹${Math.round(qrSales).toLocaleString('en-IN')}`);
  if (t.swiggy) revLines.push(`Swiggy      : ₹${Math.round(t.swiggy).toLocaleString('en-IN')}`);
  if (t.zomato) revLines.push(`Zomato      : ₹${Math.round(t.zomato).toLocaleString('en-IN')}`);

  const cogsLines: string[] = [];
  if (t.hyperpure) cogsLines.push(`Hyperpure   : ₹${Math.round(t.hyperpure).toLocaleString('en-IN')}`);
  if (t.bigbasket) cogsLines.push(`BigBasket   : ₹${Math.round(t.bigbasket).toLocaleString('en-IN')}`);
  if (t.milk)      cogsLines.push(`Milk        : ₹${Math.round(t.milk).toLocaleString('en-IN')}`);
  if (t.bread)     cogsLines.push(`Bread       : ₹${Math.round(t.bread).toLocaleString('en-IN')}`);
  if (t.water)     cogsLines.push(`Water       : ₹${Math.round(t.water).toLocaleString('en-IN')}`);
  if (t.other)     cogsLines.push(`Others      : ₹${Math.round(t.other).toLocaleString('en-IN')}`);

  const fixedLines: string[] = [];
  const above = FIXED_COLUMNS.filter(({ key }) => t.fixedTotals[key] >= FIXED_THRESHOLD);
  const below = FIXED_COLUMNS.filter(({ key }) => t.fixedTotals[key] > 0 && t.fixedTotals[key] < FIXED_THRESHOLD);

  above.forEach(({ key, label }) => {
    fixedLines.push(`${label.padEnd(12)}: ₹${Math.round(t.fixedTotals[key]).toLocaleString('en-IN')}`);
  });
  if (below.length > 0) {
    const othersTotal     = below.reduce((s, { key }) => s + t.fixedTotals[key], 0);
    const othersBreakdown = below
      .map(({ label, key }) => `${label} ₹${Math.round(t.fixedTotals[key]).toLocaleString('en-IN')}`)
      .join(', ');
    fixedLines.push(`Others      : ₹${Math.round(othersTotal).toLocaleString('en-IN')} _(${othersBreakdown})_`);
  }

  const profitLine = profit >= 0
    ? `💵 *Profit  : ₹${Math.round(profit).toLocaleString('en-IN')}*`
    : `🔴 *Loss    : ₹${Math.round(Math.abs(profit)).toLocaleString('en-IN')}*`;

  return [
    `📊 *P&L Breakdown — ${periodLabel}*`,
    `\n💰 *Total Sales*\n${revLines.join('\n')}\n*Total      : ₹${Math.round(t.revenue).toLocaleString('en-IN')}*`,
    `\n🛒 *Item Cost (Raw Materials)*\n${cogsLines.length ? cogsLines.join('\n') : '(none)'}\n*Total      : ₹${Math.round(t.cogs).toLocaleString('en-IN')}*`,
    `\n🏢 *Fixed Cost*\n${fixedLines.length ? fixedLines.join('\n') : '(none)'}\n*Total      : ₹${Math.round(t.fixedTotal).toLocaleString('en-IN')}*`,
    `\n${profitLine}`,
  ].join('\n');
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
