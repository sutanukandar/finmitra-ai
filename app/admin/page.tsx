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
  const { data, error } = await supabase.from('admin_restaurant_stats').select('*');
  if (error) throw error;
  return (data || []) as RestaurantStat[];
}

function pct(entered: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((entered / total) * 100);
}

function lastEntryColor(days: number | null): string {
  if (days === null) return '#6b7280';
  if (days <= 1) return '#16a34a';
  if (days <= 3) return '#ca8a04';
  return '#dc2626';
}

function lastEntryLabel(days: number | null): string {
  if (days === null) return 'No data';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days <= 3) return `${days}d ago`;
  return `${days}d ago ⚠️`;
}

// Next.js 15: searchParams must be awaited
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

  if (!ADMIN_TOKEN || params.token !== ADMIN_TOKEN) {
    return (
      <div style={{ padding: 40, fontFamily: 'monospace', background: '#111', color: '#fff', minHeight: '100vh' }}>
        <h1 style={{ color: '#f87171' }}>🔒 Access Denied</h1>
        <p>Pass <code>?token=YOUR_ADMIN_TOKEN</code> in the URL.</p>
        <p style={{ color: '#6b7280', fontSize: 13 }}>Set ADMIN_TOKEN in Vercel environment variables.</p>
        <p style={{ color: '#374151', fontSize: 11, marginTop: 16 }}>
          ADMIN_TOKEN env = {ADMIN_TOKEN ? '✅ set' : '❌ missing'} |
          token in URL = {params.token ? '✅ present' : '❌ missing'}
        </p>
      </div>
    );
  }

  let stats: RestaurantStat[] = [];
  let fetchError = '';
  try {
    stats = await getStats();
  } catch (e: any) {
    fetchError = e.message || 'Unknown error';
  }

  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const totalRevenue = stats.reduce((s, r) => s + Number(r.mtd_revenue || 0), 0);
  const needsAttention = stats.filter(r => (r.days_since_last_entry ?? 99) > 3).length;

  return (
    <div style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', background: '#0f172a', color: '#e2e8f0', minHeight: '100vh', padding: '24px 32px' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f8fafc', margin: 0 }}>🏪 Hisaab AI — Admin</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
            {now} IST · {stats.length} restaurant{stats.length !== 1 ? 's' : ''}
          </p>
        </div>
        <a href={`?token=${params.token}`} style={{ color: '#3b82f6', fontSize: 12, textDecoration: 'none' }}>↻ Refresh</a>
      </div>

      {fetchError && (
        <div style={{ background: '#7f1d1d', borderRadius: 8, padding: '12px 16px', marginBottom: 24, fontSize: 13 }}>
          ⚠️ DB Error: {fetchError}
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
        {[
          { n: stats.filter(r => r.is_active).length, l: 'Active Restaurants' },
          { n: needsAttention, l: 'Need Attention (3+ days)', alert: needsAttention > 0 },
          { n: `₹${Math.round(totalRevenue).toLocaleString('en-IN')}`, l: 'Combined MTD Revenue' },
          { n: stats.reduce((s, r) => s + Number(r.total_bills || 0), 0), l: 'Total Bills Uploaded' },
        ].map((c, i) => (
          <div key={i} style={{ background: '#1e293b', borderRadius: 12, padding: '16px 24px', minWidth: 160, borderLeft: c.alert ? '3px solid #dc2626' : '3px solid transparent' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: c.alert ? '#f87171' : '#f8fafc' }}>{c.n}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{c.l}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: '#1e293b', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Restaurant', 'WhatsApp', 'Status', 'Last Entry', 'MTD Completeness', 'MTD Revenue', 'MTD Food Cost', 'Bills', 'Joined'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 12px', background: '#1e293b', color: '#94a3b8', fontWeight: 500, borderBottom: '1px solid #334155' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.length === 0 && !fetchError && (
              <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>No restaurants found</td></tr>
            )}
            {stats.map(r => {
              const p = pct(r.mtd_entry_days, r.days_in_month_so_far);
              const foodPct = r.mtd_revenue > 0 ? Math.round((r.mtd_item_cost / r.mtd_revenue) * 100) : 0;
              const isAlert = (r.days_since_last_entry ?? 0) > 3;
              const td = { padding: '10px 12px', borderBottom: '1px solid #1e293b', verticalAlign: 'top' as const };
              return (
                <tr key={r.id} style={{ background: isAlert ? '#1a0a0a' : 'transparent' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 600, color: '#f8fafc' }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: '#475569' }}>{r.id.slice(0, 8)}…</div>
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12, color: '#94a3b8' }}>{r.whatsapp_number}</td>
                  <td style={td}>
                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, background: r.is_active ? '#16a34a22' : '#6b728022', color: r.is_active ? '#16a34a' : '#6b7280', fontSize: 11, fontWeight: 600 }}>
                      {r.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={td}>
                    <div style={{ color: lastEntryColor(r.days_since_last_entry), fontWeight: 600 }}>{lastEntryLabel(r.days_since_last_entry)}</div>
                    {r.last_entry_date && <div style={{ fontSize: 11, color: '#64748b' }}>{r.last_entry_date}</div>}
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ position: 'relative', height: 6, width: 80, borderRadius: 3, background: '#334155' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, height: 6, borderRadius: 3, width: `${Math.min(p, 100)}%`, background: p >= 80 ? '#22c55e' : p >= 50 ? '#eab308' : '#ef4444' }} />
                      </div>
                      <span style={{ fontSize: 12, color: p >= 80 ? '#22c55e' : p >= 50 ? '#eab308' : '#f87171' }}>{p}%</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{r.mtd_entry_days}/{r.days_in_month_so_far} days</div>
                  </td>
                  <td style={{ ...td, fontWeight: 600, color: '#f8fafc' }}>₹{Math.round(r.mtd_revenue).toLocaleString('en-IN')}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 600, color: foodPct > 45 ? '#f87171' : foodPct > 35 ? '#fbbf24' : '#4ade80' }}>
                      ₹{Math.round(r.mtd_item_cost).toLocaleString('en-IN')}
                    </div>
                    {r.mtd_revenue > 0 && <div style={{ fontSize: 11, color: '#64748b' }}>{foodPct}% of revenue</div>}
                  </td>
                  <td style={{ ...td, color: '#94a3b8' }}>
                    {r.mtd_bills} <span style={{ color: '#475569', fontSize: 11 }}>/ {r.total_bills}</span>
                  </td>
                  <td style={{ ...td, color: '#64748b', fontSize: 12 }}>
                    {new Date(r.joined_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 16, fontSize: 11, color: '#334155' }}>
        Hisaab AI Admin · Deleted entries recoverable via <code>deleted_entries</code> table in Supabase.
      </p>
    </div>
  );
}
