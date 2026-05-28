import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export const maxDuration = 30;

function excelDateToISO(serial: number): string {
  const date = new Date((serial - 25569) * 86400 * 1000);
  return date.toISOString().split('T')[0];
}

function parseAnyDate(raw: any): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return excelDateToISO(raw);

  const s = String(raw).trim();

  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // YYYY-MM-DD
  const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    const [, yr, mo, dy] = ymd;
    return `${yr}-${mo.padStart(2, '0')}-${dy.padStart(2, '0')}`;
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];

  return null;
}

function mapFixedItem(item: string): string {
  const v = item.toLowerCase();
  if (v.includes('rent')) return 'rent';
  if (v.includes('salary') || v.includes('wages') || v.includes('arup') || v.includes('staff')) return 'salary';
  if (v.includes('electricity') || v.includes('electric') || v.includes(' eb') || v.includes('current') || v.includes('bescom')) return 'electricity';
  if (v.includes('gas') || v.includes('lpg') || v.includes('cylinder')) return 'gas';
  return 'fixed';
}

function mapVariableItem(item: string): string {
  const v = item.toLowerCase();
  if (v.includes('milk') || v.includes('doodh')) return 'milk';
  if (v.includes('bread') || v.includes('bun') || v.includes('pav')) return 'bread';
  return 'other';
}

export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const file = fd.get('file') as File | null;
    const type = (fd.get('type') as string) || 'fixed';

    if (!file) return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });

    const buffer   = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheet    = workbook.Sheets[workbook.SheetNames[0]];
    const rows     = XLSX.utils.sheet_to_json(sheet) as any[];

    if (!rows.length) return NextResponse.json({ success: false, error: 'Empty spreadsheet' }, { status: 400 });

    const keys      = Object.keys(rows[0] || {});
    const dateKey   = keys.find(k => k.toLowerCase().includes('date')) || keys[0];
    const itemKey   = keys.find(k =>
      k.toLowerCase().includes('item') ||
      k.toLowerCase().includes('expense') ||
      k.toLowerCase().includes('description') ||
      k.toLowerCase().includes('category')
    ) || keys[1];
    const amountKey = keys.find(k => k.toLowerCase().includes('amount')) || keys[2];

    const mapFn = type === 'variable' ? mapVariableItem : mapFixedItem;

    const entries: { date: string; pnl_field: string; amount: number; label: string }[] = [];

    for (const row of rows) {
      const rawDate = row[dateKey];
      const rawItem = String(row[itemKey] || '').trim();
      const rawAmt  = row[amountKey];

      if (!rawDate || !rawItem || rawAmt === undefined || rawAmt === null) continue;

      const date   = parseAnyDate(rawDate);
      const amount = parseFloat(String(rawAmt).replace(/[^0-9.]/g, ''));

      if (!date || isNaN(amount) || amount <= 0) continue;

      entries.push({ date, pnl_field: mapFn(rawItem), amount, label: rawItem });
    }

    if (!entries.length) {
      return NextResponse.json({ success: false, error: 'No valid rows found. Check date/amount columns.' }, { status: 400 });
    }

    const totalAmount = entries.reduce((s, e) => s + e.amount, 0);
    const dates       = entries.map(e => e.date).sort();

    return NextResponse.json({
      success: true,
      entries,
      summary: {
        totalRows:   rows.length,
        totalAmount,
        dateRange:   { from: dates[0], to: dates[dates.length - 1] }
      }
    });

  } catch (err: any) {
    console.error('[parse-excel] Error:', err);
    return NextResponse.json({ success: false, error: err.message || 'Parse failed' }, { status: 500 });
  }
}
