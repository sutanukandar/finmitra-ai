import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function getPnlSummary(restaurantId: string, period: 'today' | 'yesterday' | 'thisMonth') {
  const today = new Date().toISOString().split('T')[0];

  let query = supabase
    .from('pnl_entries')
    .select('*')
    .eq('restaurant_id', restaurantId);

  if (period === 'today') {
    query = query.eq('date', today);
  } else if (period === 'yesterday') {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    query = query.eq('date', yesterday);
  } else if (period === 'thisMonth') {
    const startOfMonth = today.slice(0, 7) + '-01';
    query = query.gte('date', startOfMonth);
  }

  const { data: entries, error } = await query;

  if (error || !entries || entries.length === 0) {
    return { revenue: 0, cogs: 0, fixed: 0, grossProfit: 0, netProfit: 0, margin: 0 };
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

  return { revenue, cogs, fixed, grossProfit, netProfit, margin };
}
