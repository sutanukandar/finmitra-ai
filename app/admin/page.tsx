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

interface MessageRow {
  id: string;
  restaurant_id: string | null;
  whatsapp_number: string;
  direction: 'inbound' | 'outbound';
  body: string;
  media_url: string | null;
  intent: string | null;
  error: string | null;
  created_at: string;
}

interface RestaurantBasic {
  id: string;
  name: string;
  whatsapp_number: string;
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

async function getRestaurantsBasic(): Promise<RestaurantBasic[]> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name, whatsapp_number')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as RestaurantBasic[];
}

async function getMessages(restaurantId: string, limit = 200): Promise<MessageRow[]> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []) as MessageRow[];
}

// Counts errors in the last N hours across all restaurants — used for the
// "crashes" indicator so you can spot trouble without opening every thread.
async function getRecentErrorCount(hours = 24): Promise<number> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .not('error', 'is', null)
    .gte('created_at', since);
  if (error) return 0;
  return count || 0;
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

function formatChatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: true, timeZone: 'Asia/Kolkata',
  });
}

// Next.js 15: searchParams must be awaited
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; tab?: string; restaurant?: string }>;
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

  const activeTab = params.tab === 'conversations' ? 'conversations' : 'dashboard';
  const tokenQS = `token=${params.token}`;

  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  // Shared page shell styles
  const page = { fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', background: '#0f172a', color: '#e2e8f0', minHeight: '100vh', padding: '24px 32px' };
  const tabBar = { display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #1e293b' };
  const tabBtn = (isActive: boolean) => ({
    padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
    color: isActive ? '#f8fafc' : '#64748b',
    borderBottom: isActive ? '2px solid #3b82f6' : '2px solid transparent',
    textDecoration: 'none', display: 'inline-block',
  });

  return (
    <div style={page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f8fafc', margin: 0 }}>🏪 Hisaab AI — Admin</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>{now} IST</p>
        </div>
      </div>

      {/* Tab bar */}
      <div style={tabBar}>
        <a href={`?${tokenQS}&tab=dashboard`} style={tabBtn(activeTab === 'dashboard')}>📊 Dashboard</a>
        <a href={`?${tokenQS}&tab=conversations`} style={tabBtn(activeTab === 'conversations')}>💬 Conversations</a>
      </div>

      {activeTab === 'dashboard'
        ? await DashboardTab({ tokenQS })
        : await ConversationsTab({ params, tokenQS })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// DASHBOARD TAB (existing functionality, unchanged)
// ════════════════════════════════════════════════════════════════════
async function DashboardTab({ tokenQS }: { tokenQS: string }) {
  let stats: RestaurantStat[] = [];
  let fetchError = '';
  try {
    stats = await getStats();
  } catch (e: any) {
    fetchError = e.message || 'Unknown error';
  }

  const totalRevenue = stats.reduce((s, r) => s + Number(r.mtd_revenue || 0), 0);
  const needsAttention = stats.filter(r => (r.days_since_last_entry ?? 99) > 3).length;

  return (
    <div>
      {fetchError && (
        <div style={{ background: '#7f1d1d', borderRadius: 8, padding: '12px 16px', marginBottom: 24, fontSize: 13 }}>
          ⚠️ DB Error: {fetchError}
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' as const }}>
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
        <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 }}>
          <thead>
            <tr>
              {['Restaurant', 'WhatsApp', 'Status', 'Last Entry', 'MTD Completeness', 'MTD Revenue', 'MTD Food Cost', 'Bills', 'Joined'].map(h => (
                <th key={h} style={{ textAlign: 'left' as const, padding: '10px 12px', background: '#1e293b', color: '#94a3b8', fontWeight: 500, borderBottom: '1px solid #334155' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.length === 0 && !fetchError && (
              <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center' as const, color: '#64748b' }}>No restaurants found</td></tr>
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
                      <div style={{ position: 'relative' as const, height: 6, width: 80, borderRadius: 3, background: '#334155' }}>
                        <div style={{ position: 'absolute' as const, top: 0, left: 0, height: 6, borderRadius: 3, width: `${Math.min(p, 100)}%`, background: p >= 80 ? '#22c55e' : p >= 50 ? '#eab308' : '#ef4444' }} />
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

// ════════════════════════════════════════════════════════════════════
// CONVERSATIONS TAB — per-restaurant WhatsApp-style chat thread
// ════════════════════════════════════════════════════════════════════
async function ConversationsTab({
  params,
  tokenQS,
}: {
  params: { token?: string; tab?: string; restaurant?: string };
  tokenQS: string;
}) {
  let restaurants: RestaurantBasic[] = [];
  let fetchError = '';
  let recentErrorCount = 0;

  try {
    [restaurants, recentErrorCount] = await Promise.all([
      getRestaurantsBasic(),
      getRecentErrorCount(24),
    ]);
  } catch (e: any) {
    fetchError = e.message || 'Unknown error';
  }

  const selectedId = params.restaurant || (restaurants[0]?.id ?? '');
  const selected = restaurants.find(r => r.id === selectedId);

  let messages: MessageRow[] = [];
  if (selectedId) {
    try {
      messages = await getMessages(selectedId);
    } catch (e: any) {
      fetchError = fetchError || e.message;
    }
  }

  const errorCountInThread = messages.filter(m => m.error).length;

  return (
    <div>
      {recentErrorCount > 0 && (
        <div style={{ background: '#7f1d1d33', border: '1px solid #7f1d1d', borderRadius: 8, padding: '10px 16px', marginBottom: 20, fontSize: 13, color: '#fca5a5' }}>
          ⚠️ {recentErrorCount} error{recentErrorCount !== 1 ? 's' : ''} logged across all restaurants in the last 24 hours.
        </div>
      )}

      {fetchError && (
        <div style={{ background: '#7f1d1d', borderRadius: 8, padding: '12px 16px', marginBottom: 24, fontSize: 13 }}>
          ⚠️ DB Error: {fetchError}
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, minHeight: 500 }}>
        {/* Restaurant list (left sidebar) */}
        <div style={{ width: 240, background: '#1e293b', borderRadius: 12, overflow: 'hidden', flexShrink: 0, alignSelf: 'flex-start' as const }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #334155', fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>
            RESTAURANTS ({restaurants.length})
          </div>
          {restaurants.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: '#64748b' }}>No restaurants found</div>
          )}
          {restaurants.map(r => {
            const isSelected = r.id === selectedId;
            return (
              <a
                key={r.id}
                href={`?${tokenQS}&tab=conversations&restaurant=${r.id}`}
                style={{
                  display: 'block', padding: '12px 16px', textDecoration: 'none',
                  background: isSelected ? '#334155' : 'transparent',
                  borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: isSelected ? '#f8fafc' : '#cbd5e1' }}>{r.name}</div>
                <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace', marginTop: 2 }}>{r.whatsapp_number}</div>
              </a>
            );
          })}
        </div>

        {/* Chat thread (right panel) */}
        <div style={{ flex: 1, background: '#0b141a', borderRadius: 12, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', border: '1px solid #1e293b' }}>
          {/* Thread header */}
          <div style={{ padding: '14px 20px', background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>{selected?.name || 'No restaurant selected'}</div>
              <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{selected?.whatsapp_number || ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {errorCountInThread > 0 && (
                <span style={{ fontSize: 11, color: '#f87171', background: '#7f1d1d33', padding: '3px 8px', borderRadius: 99 }}>
                  ⚠️ {errorCountInThread} error{errorCountInThread !== 1 ? 's' : ''}
                </span>
              )}
              <span style={{ fontSize: 11, color: '#64748b' }}>{messages.length} messages</span>
              {selectedId && (
                <a href={`?${tokenQS}&tab=conversations&restaurant=${selectedId}`} style={{ color: '#3b82f6', fontSize: 11, textDecoration: 'none' }}>↻ Refresh</a>
              )}
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, padding: '20px', overflowY: 'auto' as const,
            backgroundImage: 'radial-gradient(circle, #16202622 1px, transparent 1px)',
            backgroundSize: '16px 16px',
            display: 'flex', flexDirection: 'column' as const, gap: 4,
            maxHeight: 600,
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center' as const, color: '#475569', fontSize: 13, marginTop: 40 }}>
                {selectedId ? 'No messages yet for this restaurant.' : 'Select a restaurant to view its conversation.'}
              </div>
            )}
            {messages.map(m => {
              const isInbound = m.direction === 'inbound';
              const hasError = !!m.error;
              return (
                <div key={m.id} style={{ display: 'flex', justifyContent: isInbound ? 'flex-start' : 'flex-end' }}>
                  <div style={{
                    maxWidth: '70%',
                    background: hasError ? '#7f1d1d55' : isInbound ? '#1e293b' : '#005c4b',
                    border: hasError ? '1px solid #dc2626' : 'none',
                    borderRadius: 10,
                    padding: '8px 12px',
                    marginBottom: 4,
                  }}>
                    {m.media_url && (
                      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>📎 Media attached</div>
                    )}
                    <div style={{ fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const }}>
                      {m.body || <span style={{ color: '#64748b', fontStyle: 'italic' as const }}>(empty)</span>}
                    </div>
                    {hasError && (
                      <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 6, paddingTop: 6, borderTop: '1px solid #dc262655' }}>
                        ⚠️ {m.error}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 4, textAlign: 'right' as const }}>
                      {formatChatTime(m.created_at)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p style={{ marginTop: 16, fontSize: 11, color: '#334155' }}>
        Inbound = restaurant owner's message · Outbound = bot's reply · Red border = error during processing.
      </p>
    </div>
  );
}
