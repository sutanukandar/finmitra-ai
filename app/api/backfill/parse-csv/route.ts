import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const fd   = await req.formData();
    const file = fd.get('file') as File | null;
    const type = (fd.get('type') as string) || 'phonepe';

    if (!file) return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });

    const text   = await file.text();
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    const rows   = result.data as any[];

    if (!rows.length) return NextResponse.json({ success: false, error: 'Empty CSV' }, { status: 400 });

    if (type === 'phonepe') {
      const completed = rows.filter(r => (r['Transaction Status'] || '').trim().toUpperCase() === 'COMPLETED');

      if (!completed.length) {
        return NextResponse.json({
          success: false,
          error: 'No COMPLETED transactions found. Check the "Transaction Status" column.'
        }, { status: 400 });
      }

      const byDate: Record<string, number> = {};
      for (const r of completed) {
        const rawDate = (r['Transaction Date'] || '').trim();
        // PhonePe format: "YYYY-MM-DD HH:MM:SS" or "DD/MM/YYYY HH:MM:SS"
        let date = rawDate.split(' ')[0];

        // Convert DD/MM/YYYY → YYYY-MM-DD
        const dmy = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (dmy) {
          const [, d, m, y] = dmy;
          date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

        const amtStr = String(
          r['Total Transaction Amount'] ?? r['Amount (INR)'] ?? r['Amount'] ?? '0'
        ).replace(/[^0-9.]/g, '');
        const amount = parseFloat(amtStr);
        if (isNaN(amount) || amount <= 0) continue;

        byDate[date] = (byDate[date] || 0) + amount;
      }

      const entries = Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, amount]) => ({ date, pnl_field: 'phonepe', amount, label: 'PhonePe' }));

      if (!entries.length) {
        return NextResponse.json({ success: false, error: 'Could not parse any valid dates from CSV' }, { status: 400 });
      }

      const totalAmount = entries.reduce((s, e) => s + e.amount, 0);

      return NextResponse.json({
        success: true,
        entries,
        summary: {
          totalRows:      rows.length,
          completedRows:  completed.length,
          totalAmount,
          dateRange:      { from: entries[0].date, to: entries[entries.length - 1].date }
        }
      });
    }

    return NextResponse.json({ success: false, error: `Unknown type: ${type}` }, { status: 400 });

  } catch (err: any) {
    console.error('[parse-csv] Error:', err);
    return NextResponse.json({ success: false, error: err.message || 'Parse failed' }, { status: 500 });
  }
}
