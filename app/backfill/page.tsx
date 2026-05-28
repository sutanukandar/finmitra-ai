'use client';

import { Fragment, useState, useRef, useCallback } from 'react';

// TODO: Replace with auth session once auth is built
const RESTAURANT_ID = 'b77ed758-9a72-4de2-9138-b353589c656d';

type Tab       = 'bills' | 'expenses' | 'sales';
type PageState = 'idle' | 'parsing' | 'review' | 'saving' | 'done';
type RowStatus = 'pending' | 'parsing' | 'success' | 'duplicate' | 'error';

interface ParsedItem {
  item_name: string;
  item_canonical?: string;
  quantity_normalised?: number;
  unit_normalised?: string;
  quantity?: number;
  unit?: string;
  rate?: number;
  amount: number;
}

interface ParsedBill {
  vendor: string;
  date: string;
  total: number;
  items: ParsedItem[];
  delivery_fee: number;
  is_duplicate: boolean;
  existing_record: { amount: number; created_at: string } | null;
}

interface BillRow {
  id: string;
  file: File;
  status: RowStatus;
  parsed?: ParsedBill;
  error?: string;
  include: boolean;
  expanded: boolean;
}

function formatBytes(n: number) {
  return n < 1024 * 1024
    ? `${(n / 1024).toFixed(0)} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata'
  });
}

function StatusIcon({ status }: { status: RowStatus }) {
  if (status === 'success')   return <span className="text-green-500 text-lg">✅</span>;
  if (status === 'duplicate') return <span className="text-yellow-500 text-lg">⚠️</span>;
  if (status === 'error')     return <span className="text-red-500 text-lg">❌</span>;
  if (status === 'parsing')   return <span className="inline-block animate-spin text-blue-400 text-lg">⏳</span>;
  return <span className="text-gray-300 text-lg">○</span>;
}

export default function BackfillPage() {
  const [tab, setTab]             = useState<Tab>('bills');
  const [month, setMonth]         = useState(() => new Date().toISOString().slice(0, 7));
  const [pageState, setPageState] = useState<PageState>('idle');
  const [rows, setRows]           = useState<BillRow[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [parseProgress, setParseProgress] = useState({ current: 0, total: 0, currentFile: '', waiting: false });
  const [saveProgress,  setSaveProgress]  = useState({ current: 0, total: 0 });
  const [doneSummary, setDoneSummary] = useState<{
    billsSaved: number; itemsSaved: number; totalAmount: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const newRows: BillRow[] = Array.from(files).map(file => ({
      id:       Math.random().toString(36).slice(2),
      file,
      status:   'pending',
      include:  true,
      expanded: false,
    }));
    setRows(prev => [...prev, ...newRows]);
  }, []);

  const removeRow     = (id: string) => setRows(prev => prev.filter(r => r.id !== id));
  const toggleInclude = (id: string) => setRows(prev => prev.map(r => r.id === id ? { ...r, include: !r.include } : r));
  const toggleExpand  = (id: string) => setRows(prev => prev.map(r => r.id === id ? { ...r, expanded: !r.expanded } : r));

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const handleParse = async () => {
    if (rows.length === 0) return;
    const snapshot = [...rows];
    setPageState('parsing');
    setParseProgress({ current: 0, total: snapshot.length, currentFile: '', waiting: false });

    let completed = 0;

    for (const row of snapshot) {
      setRows(prev => prev.map(r =>
        r.id === row.id ? { ...r, status: 'parsing' } : r
      ));
      setParseProgress({ current: completed, total: snapshot.length, currentFile: row.file.name, waiting: false });

      const fd = new FormData();
      fd.append('file', row.file);
      fd.append('restaurantId', RESTAURANT_ID);
      fd.append('month', month);

      try {
        let data: any;
        let retries = 0;
        while (retries <= 1) {
          const res = await fetch('/api/backfill', { method: 'POST', body: fd });
          data = await res.json();

          if (!data.success && data.error && data.error.includes('rate_limit') && retries === 0) {
            setRows(prev => prev.map(r =>
              r.id === row.id ? { ...r, error: 'Rate limited, retrying in 15s…' } : r
            ));
            await new Promise(resolve => setTimeout(resolve, 15000));
            retries++;
            continue;
          }
          break;
        }

        setRows(prev => prev.map(r => {
          if (r.id !== row.id) return r;
          if (data.success) {
            const isDup = data.parsed.is_duplicate;
            return { ...r, status: isDup ? 'duplicate' : 'success', parsed: data.parsed, include: !isDup };
          }
          return { ...r, status: 'error', error: data.error || 'Parse failed' };
        }));
      } catch (err: any) {
        setRows(prev => prev.map(r =>
          r.id === row.id ? { ...r, status: 'error', error: err.message } : r
        ));
      }

      completed++;
      setParseProgress({ current: completed, total: snapshot.length, currentFile: row.file.name, waiting: false });

      // 5-second delay between files to avoid Claude rate limits (~12 bills/min max)
      if (completed < snapshot.length) {
        setParseProgress(p => ({ ...p, waiting: true, currentFile: 'Waiting…' }));
        await new Promise(resolve => setTimeout(resolve, 5000));
        setParseProgress(p => ({ ...p, waiting: false }));
      }
    }

    setPageState('review');
  };

  const handleSaveAll = async () => {
    const toSave = rows.filter(r => r.include && (r.status === 'success' || r.status === 'duplicate'));
    if (toSave.length === 0) return;

    setPageState('saving');
    setSaveProgress({ current: 0, total: toSave.length });

    let billsSaved = 0, itemsSaved = 0, totalAmount = 0;

    for (let i = 0; i < toSave.length; i++) {
      const row = toSave[i];
      setSaveProgress({ current: i + 1, total: toSave.length });

      try {
        const res = await fetch('/api/backfill/confirm', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            restaurantId: RESTAURANT_ID,
            parsed:       row.parsed,
            month,
            force:        row.status === 'duplicate',
          }),
        });
        const data = await res.json();
        if (data.success && !data.skipped) {
          billsSaved++;
          itemsSaved  += data.itemsSaved  || 0;
          totalAmount += row.parsed?.total || 0;
        }
      } catch (err) {
        console.error('Save failed:', row.file.name, err);
      }
    }

    setDoneSummary({ billsSaved, itemsSaved, totalAmount });
    setPageState('done');
  };

  const handleReset = () => {
    setRows([]);
    setPageState('idle');
    setDoneSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const activeRows  = rows.filter(r => r.include && (r.status === 'success' || r.status === 'duplicate'));
  const totalValue  = activeRows.reduce((s, r) => s + (r.parsed?.total || 0), 0);
  const dupExcluded = rows.filter(r => r.status === 'duplicate' && !r.include).length;

  const TABS: { key: Tab; label: string }[] = [
    { key: 'bills',    label: 'Bills (PDF/Photo)' },
    { key: 'expenses', label: 'Expenses (Excel)'  },
    { key: 'sales',    label: 'Sales (CSV)'        },
  ];

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ── */}
      <div className="bg-white border-b shadow-sm px-8 py-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">FinMitra Backfill Portal</h1>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          disabled={pageState !== 'idle'}
          className="border rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      <div className="max-w-5xl mx-auto p-8">

        {/* ── Tabs ── */}
        <div className="flex border-b mb-8">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-6 py-3 font-medium text-sm border-b-2 -mb-px transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Non-bills tabs ── */}
        {tab !== 'bills' && (
          <div className="text-center text-gray-400 py-20 text-lg">Coming soon</div>
        )}

        {/* ── Bills tab ── */}
        {tab === 'bills' && (
          <div>

            {/* ══ IDLE ══ */}
            {pageState === 'idle' && (
              <div className="space-y-5">
                <div
                  onDrop={handleDrop}
                  onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all select-none ${
                    isDragOver
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400 bg-white'
                  }`}
                >
                  <div className="text-5xl mb-4">📁</div>
                  <p className="text-xl font-medium text-gray-700">Drop PDFs or photos here</p>
                  <p className="text-gray-400 mt-1 text-sm">or click to browse</p>
                  <p className="text-xs text-gray-300 mt-3">PDF · JPEG · PNG · HEIC · WebP</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,image/jpeg,image/png,image/heic,image/webp"
                    multiple
                    className="hidden"
                    onChange={e => { if (e.target.files) addFiles(e.target.files); }}
                  />
                </div>

                {rows.length > 0 && (
                  <div className="bg-white rounded-xl border divide-y">
                    {rows.map(row => (
                      <div key={row.id} className="flex items-center justify-between px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{row.file.type.includes('pdf') ? '📄' : '🖼️'}</span>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{row.file.name}</p>
                            <p className="text-xs text-gray-400">{formatBytes(row.file.size)}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => removeRow(row.id)}
                          className="text-gray-300 hover:text-red-500 text-xl px-2 leading-none"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={handleParse}
                  disabled={rows.length === 0}
                  className={`w-full py-4 rounded-xl font-semibold text-lg transition-all ${
                    rows.length > 0
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Parse Bills{rows.length > 0 ? ` (${rows.length})` : ''}
                </button>
              </div>
            )}

            {/* ══ PARSING ══ */}
            {pageState === 'parsing' && (
              <div className="space-y-5">
                <div className="bg-white rounded-xl border p-6 space-y-3">
                  <p className="text-sm font-medium text-gray-600">
                    {parseProgress.waiting
                      ? `Waiting 5s to avoid rate limits… (${parseProgress.current} of ${parseProgress.total} done)`
                      : `Parsing ${parseProgress.currentFile || '…'} (${parseProgress.current + 1} of ${parseProgress.total})`
                    }
                  </p>
                  <div className="w-full bg-gray-100 rounded-full h-2.5">
                    <div
                      className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                      style={{ width: `${parseProgress.total ? (parseProgress.current / parseProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                <div className="bg-white rounded-xl border divide-y">
                  {rows.map(row => (
                    <div key={row.id} className="flex items-center gap-4 px-5 py-3.5">
                      <div className="w-6 text-center shrink-0">
                        <StatusIcon status={row.status} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{row.file.name}</p>
                        {row.status === 'success' && row.parsed && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {row.parsed.vendor} · ₹{row.parsed.total.toLocaleString('en-IN')}
                          </p>
                        )}
                        {row.status === 'error' && (
                          <p className="text-xs text-red-500 mt-0.5">{row.error}</p>
                        )}
                        {row.status === 'parsing' && (
                          <p className="text-xs text-blue-400 mt-0.5">Parsing with Claude Vision…</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ══ REVIEW ══ */}
            {pageState === 'review' && (
              <div className="space-y-4">
                <div className="overflow-x-auto bg-white rounded-xl border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        <th className="px-4 py-3 w-10"></th>
                        <th className="px-4 py-3">File</th>
                        <th className="px-4 py-3">Vendor</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3 text-right">Total</th>
                        <th className="px-4 py-3 text-center">Items</th>
                        <th className="px-4 py-3">Duplicate?</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rows.map(row => (
                        <Fragment key={row.id}>
                          <tr className={
                            row.status === 'duplicate' ? 'bg-yellow-50'
                            : row.status === 'error' ? 'bg-red-50'
                            : ''
                          }>
                            <td className="px-4 py-3 text-center">
                              <StatusIcon status={row.status} />
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-gray-800 truncate max-w-[160px]" title={row.file.name}>
                                {row.file.name}
                              </p>
                              <p className="text-xs text-gray-400">{formatBytes(row.file.size)}</p>
                            </td>
                            <td className="px-4 py-3 text-gray-700">{row.parsed?.vendor || '—'}</td>
                            <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                              {row.parsed ? formatDate(row.parsed.date) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-900">
                              {row.parsed ? `₹${row.parsed.total.toLocaleString('en-IN')}` : '—'}
                            </td>
                            <td className="px-4 py-3 text-center text-gray-600">
                              {row.parsed ? row.parsed.items.length : '—'}
                            </td>
                            <td className="px-4 py-3">
                              {row.status === 'duplicate' && row.parsed ? (
                                <div>
                                  <p className="text-xs text-yellow-700 mb-1.5">
                                    A {row.parsed.vendor} bill of{' '}
                                    ₹{row.parsed.existing_record?.amount.toLocaleString('en-IN') ?? row.parsed.total.toLocaleString('en-IN')}{' '}
                                    already exists for {formatDate(row.parsed.date)}.
                                    Save anyway?
                                  </p>
                                  <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-700">
                                    <input
                                      type="checkbox"
                                      checked={row.include}
                                      onChange={() => toggleInclude(row.id)}
                                      className="rounded"
                                    />
                                    Yes, save anyway
                                  </label>
                                </div>
                              ) : row.status === 'error' ? (
                                <span className="text-xs text-red-500">{row.error}</span>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {row.parsed && (
                                  <button
                                    onClick={() => toggleExpand(row.id)}
                                    className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                                  >
                                    {row.expanded ? 'Hide items' : 'View items'}
                                  </button>
                                )}
                                <button
                                  onClick={() => removeRow(row.id)}
                                  className="text-xs text-red-500 hover:underline"
                                >
                                  Remove
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Expanded items sub-row */}
                          {row.expanded && row.parsed && (
                            <tr className="bg-gray-50">
                              <td colSpan={8} className="px-8 py-4">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-gray-400 font-semibold uppercase tracking-wider">
                                      <th className="text-left pb-2 pr-4">Ingredient</th>
                                      <th className="text-left pb-2 pr-4">Item Name</th>
                                      <th className="text-right pb-2 pr-4">Qty</th>
                                      <th className="text-left pb-2 pr-4">Unit</th>
                                      <th className="text-right pb-2 pr-4">Rate</th>
                                      <th className="text-right pb-2">Amount</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {row.parsed.items.map((item, idx) => (
                                      <tr key={idx}>
                                        <td className="py-1.5 pr-4 font-medium text-gray-700">
                                          {item.item_canonical || '—'}
                                        </td>
                                        <td className="py-1.5 pr-4 text-gray-500">{item.item_name}</td>
                                        <td className="py-1.5 pr-4 text-right text-gray-600">
                                          {item.quantity_normalised ?? item.quantity ?? '—'}
                                        </td>
                                        <td className="py-1.5 pr-4 text-gray-600">
                                          {item.unit_normalised || item.unit || '—'}
                                        </td>
                                        <td className="py-1.5 pr-4 text-right text-gray-600">
                                          {item.rate ? `₹${Number(item.rate).toLocaleString('en-IN')}` : '—'}
                                        </td>
                                        <td className="py-1.5 text-right font-semibold text-gray-800">
                                          ₹{Number(item.amount).toLocaleString('en-IN')}
                                        </td>
                                      </tr>
                                    ))}
                                    {row.parsed.delivery_fee > 0 && (
                                      <tr className="text-yellow-700 border-t border-yellow-100">
                                        <td className="py-1.5 pr-4 font-medium">Delivery Fee</td>
                                        <td colSpan={4} className="py-1.5 pr-4 text-gray-400">
                                          separated from food COGS → other
                                        </td>
                                        <td className="py-1.5 text-right font-semibold">
                                          ₹{row.parsed.delivery_fee.toLocaleString('en-IN')}
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Summary bar + actions */}
                <div className="bg-white rounded-xl border px-6 py-4 flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">{activeRows.length} bill{activeRows.length !== 1 ? 's' : ''} ready</span>
                    {' · '}
                    <span className="font-semibold text-gray-900">₹{totalValue.toLocaleString('en-IN')} total</span>
                    {dupExcluded > 0 && (
                      <span className="text-yellow-600">
                        {' · '}{dupExcluded} duplicate{dupExcluded !== 1 ? 's' : ''} excluded
                      </span>
                    )}
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={handleReset}
                      className="px-5 py-2 rounded-lg border text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Clear All
                    </button>
                    <button
                      onClick={handleSaveAll}
                      disabled={activeRows.length === 0}
                      className={`px-6 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${
                        activeRows.length > 0
                          ? 'bg-green-600 hover:bg-green-700'
                          : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      Save All ({activeRows.length})
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ══ SAVING ══ */}
            {pageState === 'saving' && (
              <div className="bg-white rounded-xl border p-12 text-center space-y-5">
                <p className="text-xl font-medium text-gray-700">
                  Saving bill {saveProgress.current} of {saveProgress.total}…
                </p>
                <div className="w-full bg-gray-100 rounded-full h-3">
                  <div
                    className="bg-green-500 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${saveProgress.total ? (saveProgress.current / saveProgress.total) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-sm text-gray-400">Please wait, do not close this page</p>
              </div>
            )}

            {/* ══ DONE ══ */}
            {pageState === 'done' && doneSummary && (
              <div className="bg-white rounded-xl border p-14 text-center space-y-4">
                <div className="text-6xl mb-2">🎉</div>
                <h2 className="text-2xl font-bold text-gray-900">All done!</h2>
                <div className="text-base space-y-2 text-gray-700">
                  <p>✅ {doneSummary.billsSaved} bill{doneSummary.billsSaved !== 1 ? 's' : ''} saved successfully</p>
                  <p>📦 {doneSummary.itemsSaved} item{doneSummary.itemsSaved !== 1 ? 's' : ''} added to purchase history</p>
                  <p>
                    💰 ₹{doneSummary.totalAmount.toLocaleString('en-IN')} added to{' '}
                    {new Date(month + '-01').toLocaleString('en-IN', { month: 'long', year: 'numeric' })} P&amp;L
                  </p>
                </div>
                <button
                  onClick={handleReset}
                  className="mt-6 px-10 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-lg transition-colors"
                >
                  Upload More
                </button>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
