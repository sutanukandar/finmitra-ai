// app/admin/page.tsx
// Internal admin dashboard — protected by ADMIN_TOKEN env var
// Access: https://finmitra-ai.vercel.app/admin?token=YOUR_TOKEN

import { createClient } from '@supabase/supabase-js';

interface RestaurantStat {
  id: string;
  name: string;
  whatsapp_number: string;
  is_active: boolean;
  joined_at: string;
  last_entry_date: string | null;
  days_since_last_entry: number | null;
  mtd_entry_days: number;
  days_in_month_so_far: number;
  mtd_revenue: number;
  mtd_item_cost: number;
  total_bills: number;
  mtd_bills: number;
}

async function getStats(): Promise<RestaurantStat[]> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data, error } = await supabase
    .from('admin_restaurant_stats')
    .select('*');
  if (error) throw error;
  return (data || []) as RestaurantStat[];
}

function completeness(entered: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((entered / total) * 100);
}

function statusColor(days: number | null): string {
  if (days === null) return '#6b7280';
  if (days === 0 || days === 1) return '#16a34a';
  if (days <= 3) return '#ca8a04';
  return '#dc2626';
}

function statusLabel(days: number | null): string {
  if (days === null) return 'No data';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days <= 3) return `${days}d ago`;
  return `${days}d ago ⚠️`;
}

// Next.js 15: searchParams is a Promise — must be awaited
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  // FIX: await searchParams (Next.js 15 breaking change from v14)
  const params = await searchParams;
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

  if (!ADMIN_TOKEN || params.token !== ADMIN_TOKEN) {
    return (
      <div style={{ padding: 40, fontFamily: 'monospace', background: '#111', color: '#fff', minHeight: '100vh' }}>
        <h1 style={{ color: '#f87171' }}>🔒 Access Denied</h1>
        <p>Pass <code>?token=YOUR_ADMIN_TOKEN</code> in the URL.</p>
        <p style={{ color: '#6b7280', fontSize: 13 }}>Set ADMIN_TOKEN in Vercel environment variables.</p>
        <p style={{ color: '#6b7280', fontSize: 11, marginTop: 16 }}>
          Debug: ADMIN_TOKEN env = {ADMIN_TOKEN ? '✅ set' : '❌ missing'} |
          Provided token = {params.token ? '✅ present' : '❌ missing'}
        </p>
      </div>
    );
  }

  let stats: RestaurantStat[] = [];
  let fetchError = '';
  try {
    stats = await getStats();
  } catch (e: any) {
    fetchError = e.message || 'Failed to fetch stats';
  }

  const totalActive = stats.filter(s => s.is_active).length;
  const needsAttention = stats.filter(s => (s.days_since_last_entry ?? 99) > 3).length;
  const totalRevenue = stats.reduce((s, r) => s + Number(r.mtd_revenue || 0), 0);
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const styles = {
    page:   { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#0f172a', color: '#e2e8f0', minHeight: '100vh', padding: '24px 32px' },
    h1:     { fontSize: 22, fontWeight: 700, color: '#f8fafc', marginBottom: 4 },
    sub:    { fontSize: 13, color: '#64748b', marginBottom: 28 },
    cards:  { display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' as const },
    card:   { background: '#1e293b', borderRadius: 12, padding: '16px 24px', minWidth: 160 },
    cnum:   { fontSize: 28, fontWeight: 700, color: '#f8fafc' },
    clbl:   { fontSize: 12, color: '#94a3b8', marginTop: 2 },
    table:  { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
    th:     { textAlign: 'left' as const, padding: '10px 12px', background: '#1e293b', color: '#94a3b8', fontWeight: 500, borderBottom: '1px solid #334155' },
    td:     { padding: '10px 12px', borderBottom: '1px solid #1e293b', verticalAlign: 'top' as const },
    badge:  (bg: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 99, background: bg + '22', color: bg, fontSize: 11, fontWeight: 600 }),
    barBg:  { height: 6, borderRadius: 3, background: '#334155', width: 80, position: 'relative' as const },
  };

  return (
    <div style={styles.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={styles.h1}>🏪 Hisaab AI — Admin Dashboard</h1>
          <p style={styles.sub}>Last refreshed: {now} IST · {stats.length} restaurant{stats.length !== 1 ? 's' : ''} total</p>
        </div>
        <a href={`?token=${params.token}`} style={{ color: '#3b82f6', fontSize: 12, textDecoration: 'none' }}>↻ Refresh</a>
      </div>

      {fetchError && (
        <div style={{ background: '#dc2626', borderRadius: 8, padding: '12px 16px', marginBottom: 24, fontSize: 13 }}>
          ⚠️ Error: {fetchError}
        </div>
      )}

      <div style={styles.cards}>
        <div style={styles.card}>
          <div style={styles.cnum}>{totalActive}</div>
          <div style={styles.clbl}>Active Restaurants</div>
        </div>
        <div style={{ ...styles.card, borderLeft: needsAttention > 0 ? '3px solid #dc2626' : '3px solid #1e293b' }}>
          <div style={{ ...styles.cnum, color: needsAttention > 0 ? '#f87171' : '#f8fafc' }}>{needsAttention}</div>
          <div style={styles.clbl}>Need Attention (3+ days no data)</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cnum}>₹{Math.round(totalRevenue).toLocaleString('en-IN')}</div>
          <div style={styles.clbl}>Combined MTD Revenue</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cnum}>{stats.reduce((s, r) => s + Number(r.total_bills || 0), 0)}</div>
          <div style={styles.clbl}>Total Bills Uploaded</div>
        </div>
      </div>

      <div style={{ background: '#1e293b', borderRadius: 12, overflow: 'hidden' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Restaurant</th>
              <th style={styles.th}>WhatsApp</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Last Entry</th>
              <th style={styles.th}>MTD Completeness</th>
              <th style={styles.th}>MTD Revenue</th>
              <th style={styles.th}>MTD Food Cost</th>
              <th style={styles.th}>Bills</th>
              <th style={styles.th}>Joined</th>
            </tr>
          </thead>
          <tbody>
            {stats.length === 0 && (
              <tr><td colSpan={9} style={{ ...styles.td, textAlign: 'center', color: '#64748b', padding: 32 }}>No restaurants found</td></tr>
            )}
            {stats.map(r => {
              const pct = completeness(r.mtd_entry_days, r.days_in_month_so_far);
              const lastColor = statusColor(r.days_since_last_entry);
              const foodCostPct = r.mtd_revenue > 0 ? Math.round((r.mtd_item_cost / r.mtd_revenue) * 100) : 0;
              return (
                <tr key={r.id} style={{ background: (r.days_since_last_entry ?? 0) > 3 ? '#1a0a0a' : 'transparent' }}>
                  <td style={styles.td}>
                    <div style={{ fontWeight: 600, color: '#f8fafc' }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{r.id.slice(0, 8)}…</div>
                  </td>
                  <td style={{ ...styles.td, color: '#94a3b8', fontFamily: 'monospace', fontSize: 12 }}>{r.whatsapp_number}</td>
                  <td style={styles.td}>
                    <span style={styles.badge(r.is_active ? '#22c55e' : '#6b7280')}>
                      {r.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <span style={{ color: lastColor, fontWeight: 600 }}>{statusLabel(r.days_since_last_entry)}</span>
                    {r.last_entry_date && <div style={{ fontSize: 11, color: '#64748b' }}>{r.last_entry_date}</div>}
                  </td>
                  <td style={styles.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={styles.barBg}>
                        <div style={{ position: 'absolute', top: 0, left: 0, height: 6, borderRadius: 3, width: `${pct}%`, maxWidth: 80, background: pct >= 80 ? '#22c55e' : pct >= 50 ? '#eab308' : '#ef4444' }} />
                      </div>
                      <span style={{ fontSize: 12, color: pct >= 80 ? '#22c55e' : pct >= 50 ? '#eab308' : '#f87171' }}>{pct}%</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{r.mtd_entry_days}/{r.days_in_month_so_far} days</div>
                  </td>
                  <td style={{ ...styles.td, fontWeight: 600, color: '#f8fafc' }}>₹{Math.round(r.mtd_revenue).toLocaleString('en-IN')}</td>
                  <td style={styles.td}>
                    <div style={{ color: foodCostPct > 45 ? '#f87171' : foodCostPct > 35 ? '#fbbf24' : '#4ade80', fontWeight: 600 }}>
                      ₹{Math.round(r.mtd_item_cost).toLocaleString('en-IN')}
                    </div>
                    {r.mtd_revenue > 0 && <div style={{ fontSize: 11, color: '#64748b' }}>{foodCostPct}% of revenue</div>}
                  </td>
                  <td style={{ ...styles.td, color: '#94a3b8' }}>
                    {r.mtd_bills} <span style={{ color: '#475569', fontSize: 11 }}>/ {r.total_bills} all</span>
                  </td>
                  <td style={{ ...styles.td, color: '#64748b', fontSize: 12 }}>
                    {new Date(r.joined_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 16, fontSize: 11, color: '#334155' }}>
        Hisaab AI Admin · Soft-deleted entries recoverable via <code>deleted_entries</code> table.
      </p>
    </div>
  );
}


import { createClient } from '@supabase/supabase-js';

interface RestaurantStat {
  id: string;
  name: string;
  whatsapp_number: string;
  is_active: boolean;
  joined_at: string;
  last_entry_date: string | null;
  days_since_last_entry: number | null;
  mtd_entry_days: number;
  days_in_month_so_far: number;
  mtd_revenue: number;
  mtd_item_cost: number;
  total_bills: number;
  mtd_bills: number;
}

async function getStats(): Promise<RestaurantStat[]> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data, error } = await supabase
    .from('admin_restaurant_stats')
    .select('*');
  if (error) throw error;
  return (data || []) as RestaurantStat[];
}

function completeness(entered: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((entered / total) * 100);
}

function statusColor(days: number | null): string {
  if (days === null) return '#6b7280';
  if (days === 0 || days === 1) return '#16a34a';
  if (days <= 3) return '#ca8a04';
  return '#dc2626';
}

function statusLabel(days: number | null): string {
  if (days === null) return 'No data';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days <= 3) return `${days}d ago`;
  return `${days}d ago ⚠️`;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

  if (!ADMIN_TOKEN || searchParams.token !== ADMIN_TOKEN) {
    return (
      <div style={{ padding: 40, fontFamily: 'monospace', background: '#111', color: '#fff', minHeight: '100vh' }}>
        <h1 style={{ color: '#f87171' }}>🔒 Access Denied</h1>
        <p>Pass <code>?token=YOUR_ADMIN_TOKEN</code> in the URL.</p>
        <p style={{ color: '#6b7280', fontSize: 13 }}>Set ADMIN_TOKEN in Vercel environment variables.</p>
      </div>
    );
  }

  let stats: RestaurantStat[] = [];
  let fetchError = '';
  try {
    stats = await getStats();
  } catch (e: any) {
    fetchError = e.message || 'Failed to fetch stats';
  }

  const totalActive = stats.filter(s => s.is_active).length;
  const needsAttention = stats.filter(s => (s.days_since_last_entry ?? 99) > 3).length;
  const totalRevenue = stats.reduce((s, r) => s + Number(r.mtd_revenue || 0), 0);
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const styles = {
    page:   { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#0f172a', color: '#e2e8f0', minHeight: '100vh', padding: '24px 32px' },
    h1:     { fontSize: 22, fontWeight: 700, color: '#f8fafc', marginBottom: 4 },
    sub:    { fontSize: 13, color: '#64748b', marginBottom: 28 },
    cards:  { display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' as const },
    card:   { background: '#1e293b', borderRadius: 12, padding: '16px 24px', minWidth: 160 },
    cnum:   { fontSize: 28, fontWeight: 700, color: '#f8fafc' },
    clbl:   { fontSize: 12, color: '#94a3b8', marginTop: 2 },
    table:  { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
    th:     { textAlign: 'left' as const, padding: '10px 12px', background: '#1e293b', color: '#94a3b8', fontWeight: 500, borderBottom: '1px solid #334155' },
    td:     { padding: '10px 12px', borderBottom: '1px solid #1e293b', verticalAlign: 'top' as const },
    badge:  (bg: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 99, background: bg + '22', color: bg, fontSize: 11, fontWeight: 600 }),
    bar:    (pct: number) => ({ display: 'flex', alignItems: 'center', gap: 8 }),
    barFg:  (pct: number) => ({ height: 6, borderRadius: 3, background: pct >= 80 ? '#22c55e' : pct >= 50 ? '#eab308' : '#ef4444', width: `${pct}%`, maxWidth: 80 }),
    barBg:  { height: 6, borderRadius: 3, background: '#334155', width: 80, position: 'relative' as const },
  };

  return (
    <div style={styles.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={styles.h1}>🏪 Hisaab AI — Admin Dashboard</h1>
          <p style={styles.sub}>Last refreshed: {now} IST · {stats.length} restaurant{stats.length !== 1 ? 's' : ''} total</p>
        </div>
        <a href={`?token=${searchParams.token}`} style={{ color: '#3b82f6', fontSize: 12, textDecoration: 'none' }}>↻ Refresh</a>
      </div>

      {fetchError && (
        <div style={{ background: '#dc2626', borderRadius: 8, padding: '12px 16px', marginBottom: 24, fontSize: 13 }}>
          ⚠️ Error: {fetchError}
        </div>
      )}

      {/* Summary cards */}
      <div style={styles.cards}>
        <div style={styles.card}>
          <div style={styles.cnum}>{totalActive}</div>
          <div style={styles.clbl}>Active Restaurants</div>
        </div>
        <div style={{ ...styles.card, borderLeft: needsAttention > 0 ? '3px solid #dc2626' : '3px solid #1e293b' }}>
          <div style={{ ...styles.cnum, color: needsAttention > 0 ? '#f87171' : '#f8fafc' }}>{needsAttention}</div>
          <div style={styles.clbl}>Need Attention (3+ days no data)</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cnum}>₹{Math.round(totalRevenue).toLocaleString('en-IN')}</div>
          <div style={styles.clbl}>Combined MTD Revenue</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cnum}>{stats.reduce((s, r) => s + Number(r.total_bills || 0), 0)}</div>
          <div style={styles.clbl}>Total Bills Uploaded</div>
        </div>
      </div>

      {/* Restaurant table */}
      <div style={{ background: '#1e293b', borderRadius: 12, overflow: 'hidden' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Restaurant</th>
              <th style={styles.th}>WhatsApp</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Last Entry</th>
              <th style={styles.th}>MTD Data Completeness</th>
              <th style={styles.th}>MTD Revenue</th>
              <th style={styles.th}>MTD Food Cost</th>
              <th style={styles.th}>Bills</th>
              <th style={styles.th}>Joined</th>
            </tr>
          </thead>
          <tbody>
            {stats.length === 0 && (
              <tr><td colSpan={9} style={{ ...styles.td, textAlign: 'center', color: '#64748b', padding: 32 }}>No restaurants found</td></tr>
            )}
            {stats.map(r => {
              const pct = completeness(r.mtd_entry_days, r.days_in_month_so_far);
              const lastColor = statusColor(r.days_since_last_entry);
              const foodCostPct = r.mtd_revenue > 0
                ? Math.round((r.mtd_item_cost / r.mtd_revenue) * 100)
                : 0;
              return (
                <tr key={r.id} style={{ background: (r.days_since_last_entry ?? 0) > 3 ? '#1a0a0a' : 'transparent' }}>
                  <td style={styles.td}>
                    <div style={{ fontWeight: 600, color: '#f8fafc' }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{r.id.slice(0, 8)}…</div>
                  </td>
                  <td style={{ ...styles.td, color: '#94a3b8', fontFamily: 'monospace', fontSize: 12 }}>
                    {r.whatsapp_number}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.badge(r.is_active ? '#22c55e' : '#6b7280')}>
                      {r.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <span style={{ color: lastColor, fontWeight: 600 }}>
                      {statusLabel(r.days_since_last_entry)}
                    </span>
                    {r.last_entry_date && (
                      <div style={{ fontSize: 11, color: '#64748b' }}>{r.last_entry_date}</div>
                    )}
                  </td>
                  <td style={styles.td}>
                    <div style={styles.bar(pct)}>
                      <div style={styles.barBg}>
                        <div style={{ ...styles.barFg(pct), position: 'absolute', top: 0, left: 0 }} />
                      </div>
                      <span style={{ fontSize: 12, color: pct >= 80 ? '#22c55e' : pct >= 50 ? '#eab308' : '#f87171' }}>
                        {pct}%
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                      {r.mtd_entry_days}/{r.days_in_month_so_far} days
                    </div>
                  </td>
                  <td style={{ ...styles.td, fontWeight: 600, color: '#f8fafc' }}>
                    ₹{Math.round(r.mtd_revenue).toLocaleString('en-IN')}
                  </td>
                  <td style={styles.td}>
                    <div style={{ color: foodCostPct > 45 ? '#f87171' : foodCostPct > 35 ? '#fbbf24' : '#4ade80', fontWeight: 600 }}>
                      ₹{Math.round(r.mtd_item_cost).toLocaleString('en-IN')}
                    </div>
                    {r.mtd_revenue > 0 && (
                      <div style={{ fontSize: 11, color: '#64748b' }}>{foodCostPct}% of revenue</div>
                    )}
                  </td>
                  <td style={{ ...styles.td, color: '#94a3b8' }}>
                    {r.mtd_bills} <span style={{ color: '#475569', fontSize: 11 }}>/ {r.total_bills} all</span>
                  </td>
                  <td style={{ ...styles.td, color: '#64748b', fontSize: 12 }}>
                    {new Date(r.joined_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 16, fontSize: 11, color: '#334155' }}>
        FinMitra Admin · For support issues, query Supabase directly.
        Soft-deleted entries recoverable via <code>deleted_entries</code> table.
      </p>
    </div>
  );
}
