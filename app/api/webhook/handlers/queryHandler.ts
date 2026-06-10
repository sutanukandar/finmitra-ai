import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { dataService } from '../../../../lib/db/dataService';
import { ParsedIntent } from '../types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

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

const PNL_SELECT = 'date, sales, phonepe, swiggy, zomato, hyperpure, bigbasket, dmart, milk, bread, water, other, rent, electricity, salary, gas, fixed, pg, internet, garbage, repairs, marketing, misc';

// Known pnl_entries columns — anything NOT in this set is an invoice_items ingredient
const PNL_COLUMNS = new Set([
  'sales', 'revenue', 'cogs', 'phonepe', 'swiggy', 'zomato',
  'hyperpure', 'bigbasket', 'dmart', 'milk', 'bread', 'water', 'other',
  'rent', 'salary', 'electricity', 'gas', 'pg', 'internet',
  'garbage', 'repairs', 'marketing', 'misc', 'fixed',
  'cogs_pct_revenue', 'gross_margin_pct', 'net_margin_pct',
]);

function getLastMonthRange(): { startDate: string; endDate: string; periodLabel: string } {
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const lm     = new Date(nowIST.getFullYear(), nowIST.getMonth() - 1, 1);
  const ly     = lm.getFullYear();
  const lmm    = lm.getMonth() + 1;
  return {
    startDate:   `${ly}-${String(lmm).padStart(2, '0')}-01`,
    endDate:     new Date(ly, lmm, 0).toISOString().split('T')[0],
    periodLabel: lm.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
  };
}

function getMetricValue(e: any, metric: string): number {
  if (metric === 'sales' || metric === 'revenue')
    return (Number(e.sales)||0)+(Number(e.phonepe)||0)+(Number(e.swiggy)||0)+(Number(e.zomato)||0);
  if (metric === 'cogs')
    return (Number(e.hyperpure)||0)+(Number(e.bigbasket)||0)+(Number(e.dmart)||0)+(Number(e.milk)||0)+(Number(e.bread)||0)+(Number(e.water)||0)+(Number(e.other)||0);
  if (metric === 'fixed')
    return FIXED_COLUMNS.reduce((s, { key }) => s + (Number(e[key])||0), 0);
  return Number(e[metric]) || 0;
}

// ── Multi-month ingredient handler ────────────────────────────────────────
// Called when metric is not a pnl column — queries invoice_items month by month
async function handleMultiMonthIngredient(
  from: string,
  restaurantId: string,
  ingredient: string,
  months: string[]
) {
  console.log(`[QueryHandler] Multi-month ingredient: "${ingredient}" for ${months.join(', ')}`);

  // Resolve canonical ingredient name
  let resolvedIngredient = ingredient;
  const { data: probe } = await supabase
    .from('invoice_items').select('item_canonical')
    .eq('restaurant_id', restaurantId).ilike('item_canonical', `%${ingredient}%`).limit(1);

  if (!probe || probe.length === 0) {
    const { data: allRows } = await supabase
      .from('invoice_items').select('item_canonical')
      .eq('restaurant_id', restaurantId).not('item_canonical', 'is', null);

    const canonicalList = [...new Set((allRows || []).map((r: any) => r.item_canonical as string).filter(Boolean))];

    if (canonicalList.length === 0) {
      await sendMessage(from, `No bill data found. Upload bills first to track ingredient expenses.`);
      return;
    }

    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 50,
      messages: [{ role: 'user', content: `The user asked about "${ingredient}". From this list: ${canonicalList.join(', ')}. Which best matches? Reply ONLY the exact name or "NO_MATCH".` }]
    });
    const resolved = aiResponse.content[0]?.type === 'text' ? aiResponse.content[0].text.trim() : 'NO_MATCH';

    if (resolved === 'NO_MATCH' || !canonicalList.includes(resolved)) {
      await sendMessage(from,
        `No purchases found for "${ingredient}" in your bills.\n\nKnown items: ${canonicalList.slice(0, 6).join(', ')}${canonicalList.length > 6 ? '…' : ''}`
      );
      return;
    }
    resolvedIngredient = resolved;
  }

  // Query each month in parallel
  const monthlyResults = await Promise.all(
    months.map(async (mo) => {
      const [y, m] = mo.split('-').map(Number);
      const startDate = `${mo}-01`;
      const endDate   = new Date(y, m, 0).toISOString().split('T')[0];

      const { data } = await supabase
        .from('invoice_items')
        .select('amount, quantity_normalised, unit_normalised')
        .eq('restaurant_id', restaurantId)
        .ilike('item_canonical', `%${resolvedIngredient}%`)
        .gte('date', startDate)
        .lte('date', endDate);

      const total = (data || []).reduce((s, r) => s + Number((r as any).amount || 0), 0);
      const qty   = (data || []).reduce((s, r) => s + Number((r as any).quantity_normalised || 0), 0);
      const unit  = data && data.length > 0 ? ((data[0] as any).unit_normalised || '') : '';
      return { mo, total, qty, unit };
    })
  );

  const grandTotal = monthlyResults.reduce((s, r) => s + r.total, 0);
  const hasQty     = monthlyResults.some(r => r.qty > 0);
  const unit       = monthlyResults.find(r => r.unit)?.unit || '';

  const lines = monthlyResults.map(({ mo, total, qty }) => {
    const monthLabel = new Date(mo + '-01').toLocaleString('en-IN', { month: 'short', year: 'numeric' });
    const qtyStr = hasQty && qty > 0 ? ` (${qty.toFixed(1)} ${unit})` : '';
    return total > 0
      ? `${monthLabel}: ₹${Math.round(total).toLocaleString('en-IN')}${qtyStr}`
      : `${monthLabel}: No purchases`;
  });

  const label = resolvedIngredient.charAt(0).toUpperCase() + resolvedIngredient.slice(1);
  await sendMessage(from,
    `📦 *${label} — Last ${months.length} Months*\n\n${lines.join('\n')}\n\nTotal: ₹${Math.round(grandTotal).toLocaleString('en-IN')}`
  );
}

export async function handlePnlQuery(
  from: string,
  restaurantId: string,
  body: string,
  parsed?: ParsedIntent
) {
  try {
    const today      = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
    const monthStart = today.slice(0, 7) + '-01';
    console.log(`[QueryHandler] intent=${parsed?.intent} period=${parsed?.period} metric=${(parsed as any)?.metric}`);

    // ── query_specific: multi-month ───────────────────────────────────────
    if (parsed?.intent === 'query_specific' &&
        parsed.period === 'multi_month' &&
        parsed.months && parsed.months.length > 0) {

      const metric = (parsed as any).metric ?? 'sales';

      // If metric is NOT a pnl column → ingredient query via invoice_items
      if (!PNL_COLUMNS.has(metric)) {
        return await handleMultiMonthIngredient(from, restaurantId, metric, parsed.months);
      }

      // Standard pnl_entries multi-month
      const startDate = parsed.months[0] + '-01';
      const lastMonth = parsed.months[parsed.months.length - 1];
      const [ly, lm]  = lastMonth.split('-').map(Number);
      const endDate   = new Date(ly, lm, 0).toISOString().split('T')[0];

      const { data: entries } = await supabase
        .from('pnl_entries').select(PNL_SELECT)
        .eq('restaurant_id', restaurantId).gte('date', startDate).lte('date', endDate);

      if (!entries || entries.length === 0) {
        await sendMessage(from, 'No data found for this period.');
        return;
      }

      const byMonth: Record<string, { revenue: number; cogs: number; fixed: number; value: number }> = {};
      parsed.months.forEach((mo: string) => { byMonth[mo] = { revenue: 0, cogs: 0, fixed: 0, value: 0 }; });

      entries.forEach((e: any) => {
        const mo = (e.date as string).slice(0, 7);
        if (!byMonth[mo]) return;
        byMonth[mo].revenue += (Number(e.sales)||0)+(Number(e.phonepe)||0)+(Number(e.swiggy)||0)+(Number(e.zomato)||0);
        byMonth[mo].cogs    += (Number(e.hyperpure)||0)+(Number(e.bigbasket)||0)+(Number(e.dmart)||0)+(Number(e.milk)||0)+(Number(e.bread)||0)+(Number(e.water)||0)+(Number(e.other)||0);
        byMonth[mo].fixed   += FIXED_COLUMNS.reduce((s, { key }) => s + (Number(e[key])||0), 0);
        byMonth[mo].value   += getMetricValue(e, metric);
      });

      const metricLabels: Record<string, string> = {
        cogs_pct_revenue: 'COGS % of Revenue', gross_margin_pct: 'Gross Margin', net_margin_pct: 'Net Margin',
        sales: 'Revenue', cogs: 'Item Cost', milk: 'Milk', bread: 'Bread', water: 'Water',
        hyperpure: 'Hyperpure', bigbasket: 'BigBasket', dmart: 'DMart', swiggy: 'Swiggy',
        zomato: 'Zomato', phonepe: 'PhonePe', rent: 'Rent', salary: 'Salary',
        electricity: 'Electricity', gas: 'Gas', other: 'Other',
      };

      const lines = parsed.months.map((mo: string) => {
        const d = byMonth[mo];
        const monthLabel = new Date(mo + '-01').toLocaleString('en-IN', { month: 'short', year: 'numeric' });
        if (metric === 'cogs_pct_revenue') {
          const pct = d.revenue > 0 ? ((d.cogs / d.revenue) * 100).toFixed(1) : 'N/A';
          return `${monthLabel}: ${pct}%`;
        }
        if (metric === 'gross_margin_pct') {
          const gp = d.revenue - d.cogs;
          return `${monthLabel}: ${d.revenue > 0 ? ((gp / d.revenue) * 100).toFixed(1) : 'N/A'}% (₹${Math.round(gp).toLocaleString('en-IN')})`;
        }
        if (metric === 'net_margin_pct') {
          const np = d.revenue - d.cogs - d.fixed;
          return `${monthLabel}: ${d.revenue > 0 ? ((np / d.revenue) * 100).toFixed(1) : 'N/A'}% (₹${Math.round(np).toLocaleString('en-IN')})`;
        }
        return `${monthLabel}: ₹${Math.round(d.value).toLocaleString('en-IN')}`;
      });

      const label = metricLabels[metric] || metric.charAt(0).toUpperCase() + metric.slice(1);
      await sendMessage(from, `📊 *${label} — Last ${parsed.months.length} Months*\n\n${lines.join('\n')}`);
      return;
    }

    // ── query_specific: single metric ─────────────────────────────────────
    if (parsed?.intent === 'query_specific') {
      let startDate: string, endDate: string, period_label: string;

      if (parsed.period === 'specific_date' && parsed.date) {
        startDate = parsed.date; endDate = parsed.date;
        period_label = new Date(parsed.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
      } else if (parsed.period === 'specific_month' && parsed.month) {
        const [y, m] = parsed.month.split('-').map(Number);
        startDate = `${parsed.month}-01`; endDate = new Date(y, m, 0).toISOString().split('T')[0];
        period_label = new Date(`${parsed.month}-01`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      } else if (parsed.period === 'mtd') {
        startDate = monthStart; endDate = today;
        period_label = `${new Date().toLocaleString('en-IN', { month: 'long' })} so far`;
      } else if (parsed.period === 'last_month') {
        const lmr = getLastMonthRange();
        startDate = lmr.startDate; endDate = lmr.endDate; period_label = lmr.periodLabel;
      } else if (parsed.period === 'yesterday') {
        const yest = new Date(Date.now() + 5.5 * 60 * 60 * 1000 - 86400000);
        startDate = yest.toISOString().split('T')[0]; endDate = startDate; period_label = 'Yesterday';
      } else {
        startDate = today; endDate = today; period_label = 'Today';
      }

      const { data: entries, error } = await dataService.getPnlData(restaurantId, startDate, endDate);
      if (error || !entries || entries.length === 0) { await sendMessage(from, "No data found for this period yet."); return; }

      let sales = 0, swiggy = 0, zomato = 0, phonepe = 0;
      let hyperpure = 0, bigbasket = 0, dmart = 0, milk = 0, bread = 0, water = 0, other = 0;
      entries.forEach((e: any) => {
        sales += e.sales||0; swiggy += e.swiggy||0; zomato += e.zomato||0; phonepe += e.phonepe||0;
        hyperpure += e.hyperpure||0; bigbasket += e.bigbasket||0; dmart += e.dmart||0;
        milk += e.milk||0; bread += e.bread||0; water += e.water||0; other += e.other||0;
      });
      const revenue = sales + swiggy + zomato + phonepe;
      const cogs    = hyperpure + bigbasket + dmart + milk + bread + water + other;
      const fixedTotal = (entries as any[]).reduce((s, e) => s + FIXED_COLUMNS.reduce((fs, { key }) => fs + (Number(e[key])||0), 0), 0);

      const metric = (parsed as any).metric ?? '';
      let reply: string;

      if (metric === 'sales')            reply = `${period_label} Sales: ₹${revenue.toLocaleString('en-IN')}`;
      else if (metric === 'cogs')        reply = `${period_label} Expenses: ₹${cogs.toLocaleString('en-IN')}`;
      else if (metric === 'cogs_pct_revenue') {
        const pct = revenue > 0 ? ((cogs / revenue) * 100).toFixed(1) : '0';
        reply = `${period_label} COGS is ${pct}% of Revenue`;
      } else if (metric === 'gross_margin_pct') {
        const gp = revenue - cogs;
        reply = `${period_label} Gross Margin: ${revenue > 0 ? ((gp / revenue) * 100).toFixed(1) : '0'}%`;
      } else if (metric === 'net_margin_pct') {
        const np = revenue - cogs - fixedTotal;
        reply = `${period_label} Net Margin: ${revenue > 0 ? ((np / revenue) * 100).toFixed(1) : '0'}%`;
      } else {
        const total = (entries as any[]).reduce((s, e) => s + (Number(e[metric])||0), 0);
        const metricLabels: Record<string, string> = {
          hyperpure: 'Hyperpure', bigbasket: 'BigBasket', dmart: 'DMart', milk: 'Milk',
          bread: 'Bread', water: 'Water', other: 'Other', rent: 'Rent', salary: 'Salary',
          electricity: 'Electricity', gas: 'Gas', pg: 'Staff PG', internet: 'Internet',
          garbage: 'Garbage', repairs: 'Repairs', marketing: 'Marketing', misc: 'Misc',
          swiggy: 'Swiggy', zomato: 'Zomato', phonepe: 'PhonePe',
        };
        const label = metricLabels[metric] || metric.charAt(0).toUpperCase() + metric.slice(1);
        reply = `${period_label} ${label}: ₹${total.toLocaleString('en-IN')}`;
      }
      await sendMessage(from, reply);
      return;
    }

    // ── query_items ───────────────────────────────────────────────────────
    if (parsed?.intent === 'query_items') {
      let startDate: string, endDate: string;
      if (parsed.period === 'specific_date' && parsed.date) { startDate = parsed.date; endDate = parsed.date; }
      else if (parsed.period === 'specific_month' && parsed.month) { const [y,m]=parsed.month.split('-').map(Number); startDate=parsed.month+'-01'; endDate=new Date(y,m,0).toISOString().split('T')[0]; }
      else if (parsed.period === 'today') { startDate=today; endDate=today; }
      else { startDate=monthStart; endDate=today; }

      const { data: items } = await supabase.from('invoice_items')
        .select('item_canonical, unit_normalised, quantity_normalised, amount, vendor')
        .eq('restaurant_id', restaurantId).gte('date', startDate).lte('date', endDate)
        .not('item_canonical', 'is', null).not('item_canonical', 'ilike', '%delivery%').not('item_canonical', 'ilike', '%small order%');

      if (!items || items.length === 0) { await sendMessage(from, 'No item-level data found.'); return; }

      const filtered = parsed.vendor_filter ? (items as any[]).filter((r: any) => (r.vendor||'').toLowerCase().includes(parsed.vendor_filter)) : (items as any[]);
      const grouped: Record<string, { qty: number; unit: string; spend: number }> = {};
      filtered.forEach((r: any) => {
        const key = r.item_canonical as string;
        if (!grouped[key]) grouped[key] = { qty: 0, unit: r.unit_normalised||'Pc', spend: 0 };
        grouped[key].qty += Number(r.quantity_normalised||0);
        grouped[key].spend += Number(r.amount||0);
      });

      const sortKey = parsed.sort_by === 'weight' ? 'qty' : 'spend';
      const sorted = Object.entries(grouped).sort((a,b) => b[1][sortKey]-a[1][sortKey]).slice(0, parsed.limit||5);
      if (sorted.length === 0) { await sendMessage(from, 'No item-level data found.'); return; }

      const grandTotal = sorted.reduce((s,[,d]) => s+d.spend, 0);
      let periodLabel = parsed.period === 'specific_month' && parsed.month ? new Date(parsed.month+'-01').toLocaleString('en-IN',{month:'long',year:'numeric'}) : parsed.period === 'today' ? 'Today' : `${new Date().toLocaleString('en-IN',{month:'long'})} so far`;
      const lines = sorted.map(([name,d],idx) => `${idx+1}. ${name} — ₹${d.spend.toLocaleString('en-IN')}${d.qty>0?` (${d.qty.toFixed(2)} ${d.unit})`:''}`);
      await sendMessage(from, `🛒 *Top Items — ${periodLabel}*\n\n${lines.join('\n')}\n\nTotal: ₹${grandTotal.toLocaleString('en-IN')}`);
      return;
    }

    // ── query_ingredient ─────────────────────────────────────────────────
    if (parsed?.intent === 'query_ingredient') {
      let ingredient = (parsed as any).ingredient || '';
      if (!ingredient) { await sendMessage(from, "Which ingredient? e.g. \"how much Carrot did I buy this month\""); return; }

      let startDate: string, endDate: string;
      if (parsed.period === 'specific_month' && parsed.month) {
        startDate = parsed.month+'-01'; endDate = new Date(new Date(startDate).getFullYear(), new Date(startDate).getMonth()+1, 0).toISOString().split('T')[0];
      } else if (parsed.period === 'today') { startDate=today; endDate=today; }
      else { startDate=monthStart; endDate=today; }

      const { data: directProbe } = await supabase.from('invoice_items').select('item_canonical').eq('restaurant_id', restaurantId).ilike('item_canonical', `%${ingredient}%`).limit(1);

      if (!directProbe || directProbe.length === 0) {
        const { data: allRows } = await supabase.from('invoice_items').select('item_canonical').eq('restaurant_id', restaurantId).not('item_canonical', 'is', null);
        const canonicalList = [...new Set((allRows||[]).map((r: any) => r.item_canonical as string).filter(Boolean))];
        if (canonicalList.length > 0) {
          const aiResponse = await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 50, messages: [{ role: 'user', content: `The user asked about "${ingredient}". From: ${canonicalList.join(', ')}. Which matches? Reply ONLY the exact name or "NO_MATCH".` }] });
          const resolved = aiResponse.content[0]?.type === 'text' ? aiResponse.content[0].text.trim() : 'NO_MATCH';
          if (resolved === 'NO_MATCH' || !canonicalList.includes(resolved)) { await sendMessage(from, `No purchases found for "${ingredient}".\n\nKnown items: ${canonicalList.slice(0,5).join(', ')}${canonicalList.length>5?'…':''}`); return; }
          ingredient = resolved;
        }
      }

      const { data: rows } = await supabase.from('invoice_items').select('item_name, item_canonical, vendor, quantity_normalised, unit_normalised, quantity, unit, amount, date')
        .eq('restaurant_id', restaurantId).ilike('item_canonical', `%${ingredient}%`).gte('date', startDate).lte('date', endDate).order('date', { ascending: true });

      const pnlColumnMap: Record<string, string> = { milk: 'milk', bread: 'bread', water: 'water' };
      const pnlColumn = pnlColumnMap[ingredient.toLowerCase()];
      let pnlTotal = 0;
      if (pnlColumn) {
        const { data: pnlRows } = await supabase.from('pnl_entries').select(`date, ${pnlColumn}`).eq('restaurant_id', restaurantId).gte('date', startDate).lte('date', endDate);
        pnlTotal = ((pnlRows||[]) as any[]).reduce((s,r) => s+Number(r[pnlColumn]||0), 0);
      }

      const invoiceTotal = rows ? (rows as any[]).reduce((s,r) => s+Number(r.amount), 0) : 0;
      const grandTotal   = invoiceTotal + pnlTotal;
      const periodLabel  = parsed.period === 'specific_month' && parsed.month ? new Date(parsed.month+'-01').toLocaleString('en-IN',{month:'long',year:'numeric'}) : parsed.period === 'today' ? 'Today' : `${new Date(today).toLocaleString('en-IN',{month:'long'})} so far`;

      if (!rows || rows.length === 0) {
        if (pnlTotal > 0) { await sendMessage(from, `📦 *${ingredient} — ${periodLabel}*\n\nTotal: ₹${pnlTotal.toLocaleString('en-IN')}\n  • Daily entries: ₹${pnlTotal.toLocaleString('en-IN')}`); }
        else {
          const { data: lp } = await supabase.from('invoice_items').select('date, amount, quantity, unit, vendor').eq('restaurant_id', restaurantId).ilike('item_canonical', `%${ingredient}%`).order('date', { ascending: false }).limit(1);
          if (lp && lp.length > 0) {
            const r = lp[0] as any;
            await sendMessage(from, `No ${ingredient} in ${periodLabel}.\n\nLast: ${new Date(r.date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'})} — ₹${Number(r.amount).toLocaleString('en-IN')} (${Number(r.quantity).toFixed(2)} ${r.unit} from ${r.vendor})`);
          } else { await sendMessage(from, `No ${ingredient} purchases found.`); }
        }
        return;
      }

      const totalQty = (rows as any[]).reduce((s,r) => s+Number(r.quantity_normalised||r.quantity||0), 0);
      const unit = (rows[0] as any).unit_normalised||(rows[0] as any).unit||'units';
      const avgRate = totalQty > 0 && invoiceTotal > 0 ? invoiceTotal/totalQty : 0;

      const byVendor: Record<string, { qty: number; spend: number }> = {};
      (rows as any[]).forEach(r => { const v=r.vendor||'Unknown'; if (!byVendor[v]) byVendor[v]={qty:0,spend:0}; byVendor[v].qty+=Number(r.quantity_normalised||r.quantity||0); byVendor[v].spend+=Number(r.amount); });
      const vendorLines = Object.entries(byVendor).sort((a,b)=>b[1].spend-a[1].spend).map(([v,d]) => `  • ${v}: ${d.qty.toFixed(2)} ${unit} — ₹${d.spend.toLocaleString('en-IN')}`);
      if (pnlTotal > 0) vendorLines.push(`  • Daily entries: ₹${pnlTotal.toLocaleString('en-IN')}`);

      await sendMessage(from, `📦 *${ingredient} — ${periodLabel}*\n\nTotal bought : ${totalQty.toFixed(2)} ${unit}\nTotal spent  : ₹${grandTotal.toLocaleString('en-IN')}\nAvg rate     : ₹${avgRate.toFixed(0)}/${unit}\nPurchases    : ${rows.length}${pnlTotal > 0?' (bills) + daily entries':''}\n\nBy source:\n${vendorLines.join('\n')}`);
      return;
    }

    // ── query_vendor_breakdown ────────────────────────────────────────────
    if (parsed?.intent === 'query_vendor_breakdown') {
      let startDate: string, endDate: string;
      if (parsed.period === 'specific_month' && parsed.month) { const [y,m]=parsed.month.split('-').map(Number); startDate=parsed.month+'-01'; endDate=new Date(y,m,0).toISOString().split('T')[0]; }
      else if (parsed.period === 'today') { startDate=today; endDate=today; }
      else { startDate=monthStart; endDate=today; }

      const { data: items } = await supabase.from('invoice_items').select('vendor, amount').eq('restaurant_id', restaurantId).gte('date', startDate).lte('date', endDate);
      if (!items || items.length === 0) { await sendMessage(from, 'No expense data found.'); return; }

      const normalise = (v: string) => { const lv=(v||'').toLowerCase(); if (lv.includes('hyperpure')||lv.includes('zomato')) return 'Hyperpure'; if (lv.includes('bigbasket')||lv.includes('bbnow')||lv.includes('innovative retail')) return 'BigBasket'; if (lv.includes('dmart')||lv.includes('avenue e-commerce')||lv.includes('avenue e commerce')) return 'DMart'; return v.trim(); };
      const grouped: Record<string, number> = {};
      (items as any[]).forEach(r => { const key=normalise(r.vendor); grouped[key]=(grouped[key]||0)+Number(r.amount); });
      const sorted = Object.entries(grouped).sort((a,b)=>b[1]-a[1]);
      const grandTotal = sorted.reduce((s,[,v])=>s+v, 0);
      const periodLabel = parsed.period === 'specific_month' && parsed.month ? new Date(parsed.month+'-01').toLocaleString('en-IN',{month:'long',year:'numeric'}) : parsed.period === 'today' ? 'Today' : `${new Date().toLocaleString('en-IN',{month:'long'})} so far`;
      await sendMessage(from, `📊 *Expenses by Vendor — ${periodLabel}*\n\n${sorted.map(([v,s],i)=>`${i+1}. ${v} — ₹${s.toLocaleString('en-IN')}`).join('\n')}\n\nTotal: ₹${grandTotal.toLocaleString('en-IN')}`);
      return;
    }

    // ── query_daily_breakdown ─────────────────────────────────────────────
    if (parsed?.intent === 'query_daily_breakdown') {
      let startDate: string, endDate: string, periodLabel: string;

      if (parsed.period === 'last_n_days') {
        const n=parsed.days||7; const end=new Date(); const start=new Date(); start.setDate(end.getDate()-(n-1));
        startDate=start.toISOString().split('T')[0]; endDate=end.toISOString().split('T')[0]; periodLabel=`Last ${n} Days`;
      } else if (parsed.period === 'last_n_days_of_month' && parsed.month) {
        const [y,m]=parsed.month.split('-').map(Number); const n=parsed.days||7;
        const lastDay=new Date(y,m,0); const firstDay=new Date(lastDay); firstDay.setDate(lastDay.getDate()-(n-1));
        startDate=firstDay.toISOString().split('T')[0]; endDate=lastDay.toISOString().split('T')[0]; periodLabel=`Last ${n} Days of ${lastDay.toLocaleString('en-IN',{month:'long',year:'numeric'})}`;
      } else if (parsed.period === 'first_n_days_of_month') {
        const n=parsed.days||7; const mo=parsed.month||today.slice(0,7); const [y,m]=mo.split('-').map(Number);
        startDate=new Date(Date.UTC(y,m-1,1)).toISOString().split('T')[0]; endDate=new Date(Date.UTC(y,m-1,n)).toISOString().split('T')[0];
        periodLabel=`First ${n} Days of ${new Date(Date.UTC(y,m-1,1)).toLocaleString('en-IN',{month:'long'})} ${y}`;
      } else if (parsed.period === 'specific_month' && parsed.month) {
        const [y,m]=parsed.month.split('-').map(Number); startDate=`${parsed.month}-01`; endDate=new Date(y,m,0).toISOString().split('T')[0];
        periodLabel=new Date(`${parsed.month}-01`).toLocaleString('en-IN',{month:'long',year:'numeric'});
      } else if (parsed.period === 'this_month' || parsed.period === 'mtd') {
        const nowIST=new Date(Date.now()+5.5*60*60*1000);
        startDate=`${nowIST.getFullYear()}-${String(nowIST.getMonth()+1).padStart(2,'0')}-01`; endDate=nowIST.toISOString().split('T')[0];
        periodLabel=`${nowIST.toLocaleString('en-IN',{month:'long'})} ${nowIST.getFullYear()} (MTD)`;
      } else {
        const nowIST=new Date(Date.now()+5.5*60*60*1000);
        startDate=monthStart; endDate=today; periodLabel=`${nowIST.toLocaleString('en-IN',{month:'long'})} (MTD)`;
      }

      const { data: entries } = await supabase.from('pnl_entries').select(PNL_SELECT).eq('restaurant_id', restaurantId).gte('date', startDate).lte('date', endDate).order('date', { ascending: true });
      if (!entries || entries.length === 0) { await sendMessage(from, 'No data found.'); return; }

      const metric = (parsed as any).metric || 'revenue';
      const getValue = (e: any): number => {
        if (metric==='sales'||metric==='revenue') return (Number(e.sales)||0)+(Number(e.phonepe)||0)+(Number(e.swiggy)||0)+(Number(e.zomato)||0);
        if (metric==='cogs'||metric==='item cost') return (Number(e.hyperpure)||0)+(Number(e.bigbasket)||0)+(Number(e.dmart)||0)+(Number(e.milk)||0)+(Number(e.bread)||0)+(Number(e.water)||0)+(Number(e.other)||0);
        if (metric==='fixed') return FIXED_COLUMNS.reduce((s,{key})=>s+(Number(e[key])||0),0);
        if (metric==='total_expenses') return ((Number(e.hyperpure)||0)+(Number(e.bigbasket)||0)+(Number(e.dmart)||0)+(Number(e.milk)||0)+(Number(e.bread)||0)+(Number(e.water)||0)+(Number(e.other)||0))+FIXED_COLUMNS.reduce((s,{key})=>s+(Number(e[key])||0),0);
        return Number(e[metric])||0;
      };

      const LABELS: Record<string,string> = { sales:'Total Sales', revenue:'Total Sales', cogs:'Item Cost (COGS)', fixed:'Fixed Costs', total_expenses:'Total Expenses', milk:'Milk', bread:'Bread', water:'Water', hyperpure:'Hyperpure', bigbasket:'BigBasket', dmart:'DMart', other:'Other', swiggy:'Swiggy', zomato:'Zomato', phonepe:'PhonePe', rent:'Rent', salary:'Salary', electricity:'Electricity', gas:'Gas', pg:'Staff PG', internet:'Internet', garbage:'Garbage', repairs:'Repairs', marketing:'Marketing', misc:'Misc' };
      const metricLabel = LABELS[metric]||(metric.charAt(0).toUpperCase()+metric.slice(1));

      const lines = (entries as any[]).map(e => ({ dateLabel: new Date(e.date+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short',timeZone:'Asia/Kolkata'}), val: getValue(e) })).filter(({val})=>val>0).map(({dateLabel,val})=>`${dateLabel}: ₹${val.toLocaleString('en-IN')}`);
      if (lines.length === 0) { await sendMessage(from, `No ${metricLabel} data for ${periodLabel}.`); return; }

      const total = (entries as any[]).reduce((s,e)=>s+getValue(e), 0);
      await sendMessage(from, `📅 *${metricLabel} — ${periodLabel}*\n\n${lines.join('\n')}\n\nTotal: ₹${total.toLocaleString('en-IN')}`);
      return;
    }

    // ── query_upload_history ──────────────────────────────────────────────
    if (parsed?.intent === 'query_upload_history') {
      const vendor = (parsed as any).vendor_filter || null;
      const target = (parsed as any).target || 'last';
      const limit  = target === 'last' ? 1 : ((parsed as any).limit || 5);

      let query = supabase.from('upload_records').select('id, date, amount, pnl_field, created_at, metadata').eq('restaurant_id', restaurantId);
      if (vendor) query = (query as any).eq('pnl_field', vendor);
      const { data: records } = await (query as any).order('created_at', { ascending: false }).limit(limit);

      if (!records || records.length === 0) { await sendMessage(from, `No ${vendor ? vendor.charAt(0).toUpperCase()+vendor.slice(1) : ''} uploads found.`); return; }

      if (target === 'last') {
        const r = records[0] as any;
        const vendorLabel = (r.pnl_field||'Bill').charAt(0).toUpperCase()+(r.pnl_field||'bill').slice(1);
        const billDate = new Date(r.date+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
        const uploadedAt = new Date(r.created_at).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
        const { data: items } = await supabase.from('invoice_items').select('item_name, quantity, unit, amount').eq('upload_record_id', r.id).order('amount', { ascending: false }).limit(10);
        let reply = `📋 *Last ${vendorLabel} Bill*\nBill date : ${billDate}\nAmount    : ₹${Number(r.amount).toLocaleString('en-IN')}\nUploaded  : ${uploadedAt}`;
        if (items && items.length > 0) reply += `\n\nItems:\n${(items as any[]).map(i=>`  • ${i.item_name} — ₹${Number(i.amount).toLocaleString('en-IN')}`).join('\n')}`;
        await sendMessage(from, reply);
      } else {
        const lines = (records as any[]).map((r,i) => { const vl=(r.pnl_field||'Other').charAt(0).toUpperCase()+(r.pnl_field||'other').slice(1); const up=new Date(r.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',timeZone:'Asia/Kolkata'}); return `${i+1}. ${vl} — ₹${Number(r.amount).toLocaleString('en-IN')} (${up})`; });
        await sendMessage(from, `📋 *Recent Uploads*\n\n${lines.join('\n')}`);
      }
      return;
    }

    // ── query_pnl_detail ──────────────────────────────────────────────────
    if (parsed?.intent === 'query_pnl_detail') {
      let detailStart: string, detailEnd: string, detailLabel: string;

      if (parsed.period && parsed.period !== 'from_context') {
        if (parsed.period === 'specific_month' && parsed.month) { const [y,m]=parsed.month.split('-').map(Number); detailStart=`${parsed.month}-01`; detailEnd=new Date(y,m,0).toISOString().split('T')[0]; detailLabel=new Date(`${parsed.month}-01`).toLocaleString('en-IN',{month:'long',year:'numeric'}); }
        else if (parsed.period === 'yesterday') { detailStart=detailEnd=new Date(Date.now()+5.5*60*60*1000-86400000).toISOString().split('T')[0]; detailLabel='Yesterday'; }
        else if (parsed.period === 'last_month') { const lmr=getLastMonthRange(); detailStart=lmr.startDate; detailEnd=lmr.endDate; detailLabel=lmr.periodLabel; }
        else if (parsed.period === 'mtd') { detailStart=monthStart; detailEnd=today; detailLabel=`${new Date(today).toLocaleString('en-IN',{month:'long'})} so far`; }
        else { detailStart=detailEnd=today; detailLabel='Today'; }
      } else {
        const { data: ctxRow } = await supabase.from('pending_confirmations').select('payload').eq('restaurant_id', restaurantId).eq('action','pnl_context').gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(1).maybeSingle();
        const ctx=ctxRow?.payload as any; detailStart=ctx?.startDate||today; detailEnd=ctx?.endDate||today; detailLabel=ctx?.periodLabel||'Today';
      }

      const { data: detailEntries } = await dataService.getPnlData(restaurantId, detailStart, detailEnd);
      if (!detailEntries || detailEntries.length === 0) { await sendMessage(from, "No data found for this period yet."); return; }
      await sendMessage(from, buildPnlBreakdown(detailEntries, detailLabel));
      return;
    }

    // ── full P&L summary ──────────────────────────────────────────────────
    let startDate = today, endDate: string | undefined, periodLabel = 'Today';

    if (parsed?.intent === 'query_pnl' && parsed.period === 'specific_month' && parsed.month) {
      const [y,m]=parsed.month.split('-').map(Number); startDate=`${parsed.month}-01`; endDate=new Date(y,m,0).toISOString().split('T')[0]; periodLabel=new Date(`${parsed.month}-01`).toLocaleString('en-IN',{month:'long',year:'numeric'});
    } else if (parsed?.intent === 'query_pnl' && parsed.period === 'yesterday') {
      startDate=new Date(Date.now()+5.5*60*60*1000-86400000).toISOString().split('T')[0]; endDate=startDate; periodLabel='Yesterday';
    } else if (parsed?.intent === 'query_pnl' && parsed.period === 'last_month') {
      const lmr=getLastMonthRange(); startDate=lmr.startDate; endDate=lmr.endDate; periodLabel=lmr.periodLabel;
    } else if (parsed?.intent === 'query_mtd'||(parsed?.intent === 'query_pnl' && parsed.period === 'mtd')||body.includes('this month')||body.includes('month')) {
      startDate=monthStart; endDate=today; periodLabel=`${new Date(today).toLocaleString('en-IN',{month:'long'})} so far`;
    } else if (body.includes('kal')||body.includes('yesterday')) {
      startDate=new Date(Date.now()+5.5*60*60*1000-86400000).toISOString().split('T')[0]; endDate=startDate; periodLabel='Yesterday';
    } else if (body.includes('aaj')||body.includes('today')||body.includes('p&l')||parsed?.intent === 'query_today'||parsed?.intent === 'query_pnl') {
      startDate=today; endDate=today; periodLabel='Today';
    } else {
      await sendMessage(from, "Please specify: `aaj ka P&L`, `this month`, or `P&L for Mar 2026`"); return;
    }

    const { data: entries, error } = await dataService.getPnlData(restaurantId, startDate, endDate);
    if (error || !entries || entries.length === 0) { await sendMessage(from, "No data found for this period yet."); return; }

    const totals = computePnlTotals(entries);
    await dataService.createPendingConfirmation(restaurantId, { startDate, endDate: endDate||startDate, periodLabel }, 'pnl_context');

    const profit = totals.revenue - totals.cogs - totals.fixedTotal;
    await sendMessage(from,
      `📊 *P&L — ${periodLabel}*\n\n` +
      `Total Sales  : ₹${Math.round(totals.revenue).toLocaleString('en-IN')}\n` +
      `Item Cost    : ₹${Math.round(totals.cogs).toLocaleString('en-IN')}\n` +
      `Fixed Cost   : ₹${Math.round(totals.fixedTotal).toLocaleString('en-IN')}\n\n` +
      (profit >= 0 ? `💵 *Profit   : ₹${Math.round(profit).toLocaleString('en-IN')}*` : `🔴 *Loss     : ₹${Math.round(Math.abs(profit)).toLocaleString('en-IN')}*`)
    );

  } catch (error) {
    console.error("[QueryHandler] Error:", error);
    await sendMessage(from, "Unable to fetch P&L right now. Please try again.");
  }
}

function computePnlTotals(entries: any[]) {
  let sales=0, swiggy=0, zomato=0, phonepe=0, hyperpure=0, bigbasket=0, dmart=0, milk=0, bread=0, water=0, other=0;
  entries.forEach((e: any) => { sales+=e.sales||0; swiggy+=e.swiggy||0; zomato+=e.zomato||0; phonepe+=e.phonepe||0; hyperpure+=e.hyperpure||0; bigbasket+=e.bigbasket||0; dmart+=e.dmart||0; milk+=e.milk||0; bread+=e.bread||0; water+=e.water||0; other+=e.other||0; });
  const fixedTotals: Record<string, number> = {};
  FIXED_COLUMNS.forEach(({key}) => { fixedTotals[key]=entries.reduce((s,e)=>s+(Number(e[key])||0),0); });
  return { sales, swiggy, zomato, phonepe, hyperpure, bigbasket, dmart, milk, bread, water, other, fixedTotals, revenue: sales+swiggy+zomato+phonepe, cogs: hyperpure+bigbasket+dmart+milk+bread+water+other, fixedTotal: FIXED_COLUMNS.reduce((s,{key})=>s+fixedTotals[key],0) };
}

function buildPnlBreakdown(entries: any[], periodLabel: string): string {
  const t = computePnlTotals(entries);
  const profit = t.revenue - t.cogs - t.fixedTotal;

  // Aggregate metadata breakdowns across all days in the period
  const otherBreakdown: Record<string, number> = {};
  const miscBreakdown:  Record<string, number> = {};
  for (const e of entries) {
    const meta = (e.metadata || {}) as any;
    for (const [k, v] of Object.entries((meta.other_breakdown || {}) as Record<string, number>)) {
      otherBreakdown[k] = (otherBreakdown[k] || 0) + Number(v);
    }
    for (const [k, v] of Object.entries((meta.misc_breakdown || {}) as Record<string, number>)) {
      miscBreakdown[k] = (miscBreakdown[k] || 0) + Number(v);
    }
  }

  // Sales lines
  const revLines = [`QR / Online : ₹${Math.round(t.sales+t.phonepe).toLocaleString('en-IN')}`];
  if (t.swiggy) revLines.push(`Swiggy      : ₹${Math.round(t.swiggy).toLocaleString('en-IN')}`);
  if (t.zomato) revLines.push(`Zomato      : ₹${Math.round(t.zomato).toLocaleString('en-IN')}`);

  // Item Cost lines — with metadata breakdown under Others
  const cogsLines: string[] = [];
  if (t.hyperpure) cogsLines.push(`Hyperpure   : ₹${Math.round(t.hyperpure).toLocaleString('en-IN')}`);
  if (t.bigbasket) cogsLines.push(`BigBasket   : ₹${Math.round(t.bigbasket).toLocaleString('en-IN')}`);
  if (t.dmart)     cogsLines.push(`DMart       : ₹${Math.round(t.dmart).toLocaleString('en-IN')}`);
  if (t.milk)      cogsLines.push(`Milk        : ₹${Math.round(t.milk).toLocaleString('en-IN')}`);
  if (t.bread)     cogsLines.push(`Bread       : ₹${Math.round(t.bread).toLocaleString('en-IN')}`);
  if (t.water)     cogsLines.push(`Water       : ₹${Math.round(t.water).toLocaleString('en-IN')}`);
  if (t.other) {
    cogsLines.push(`Others      : ₹${Math.round(t.other).toLocaleString('en-IN')}`);
    // Indented breakdown (sorted by amount descending)
    for (const [label, amt] of Object.entries(otherBreakdown).sort((a,b) => b[1]-a[1])) {
      const dl = label.charAt(0).toUpperCase() + label.slice(1);
      cogsLines.push(`  • ${dl.padEnd(12)}: ₹${Math.round(amt).toLocaleString('en-IN')}`);
    }
  }

  // Fixed Cost lines — with metadata breakdown under Others
  const fixedLines: string[] = [];
  FIXED_COLUMNS.filter(({key})=>t.fixedTotals[key]>=FIXED_THRESHOLD)
    .forEach(({key,label})=>fixedLines.push(`${label.padEnd(12)}: ₹${Math.round(t.fixedTotals[key]).toLocaleString('en-IN')}`));

  const below = FIXED_COLUMNS.filter(({key})=>t.fixedTotals[key]>0&&t.fixedTotals[key]<FIXED_THRESHOLD);
  const namedKeys = new Set(FIXED_COLUMNS.map(c=>c.key));
  const extraMisc = Object.entries(miscBreakdown).filter(([k])=>!namedKeys.has(k));
  const othersFixedTotal = below.reduce((s,{key})=>s+t.fixedTotals[key],0)
                         + extraMisc.reduce((s,[,v])=>s+v,0);
  if (othersFixedTotal > 0) {
    fixedLines.push(`Others      : ₹${Math.round(othersFixedTotal).toLocaleString('en-IN')}`);
    for (const {key,label} of below) {
      fixedLines.push(`  • ${label.padEnd(12)}: ₹${Math.round(t.fixedTotals[key]).toLocaleString('en-IN')}`);
    }
    for (const [label,amt] of extraMisc.sort((a,b)=>b[1]-a[1])) {
      const dl = label.charAt(0).toUpperCase() + label.slice(1);
      fixedLines.push(`  • ${dl.padEnd(12)}: ₹${Math.round(amt).toLocaleString('en-IN')}`);
    }
  }

  const profitLine = profit>=0
    ? `💵 *Profit  : ₹${Math.round(profit).toLocaleString('en-IN')}*`
    : `🔴 *Loss    : ₹${Math.round(Math.abs(profit)).toLocaleString('en-IN')}*`;

  return [
    `📊 *P&L Breakdown — ${periodLabel}*`,
    `\n💰 *Total Sales*\n${revLines.join('\n')}\n*Total      : ₹${Math.round(t.revenue).toLocaleString('en-IN')}*`,
    `\n🛒 *Item Cost (Raw Materials)*\n${cogsLines.length?cogsLines.join('\n'):'(none)'}\n*Total      : ₹${Math.round(t.cogs).toLocaleString('en-IN')}*`,
    `\n🏢 *Fixed Cost*\n${fixedLines.length?fixedLines.join('\n'):'(none)'}\n*Total      : ₹${Math.round(t.fixedTotal).toLocaleString('en-IN')}*`,
    `\n${profitLine}`,
  ].join('\n');
}

async function sendMessage(to: string, body: string) {
  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await twilio.messages.create({ from: 'whatsapp:+14155238886', to: `whatsapp:${to}`, body });
}
