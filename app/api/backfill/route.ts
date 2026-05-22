import { NextRequest, NextResponse } from 'next/server';
import { dataService } from '../../../lib/db/dataService';
import * as XLSX from 'xlsx';

// Robust Excel serial date to YYYY-MM-DD converter
function excelDateToISO(value: any): string {
  if (!value) return new Date().toISOString().split('T')[0];

  if (typeof value === 'string') {
    if (value.includes('-')) return value.split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }

  const serial = Number(value);
  if (!isNaN(serial) && serial > 0) {
    const utc_days = Math.floor(serial - 25569);
    const date = new Date(utc_days * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }

  return new Date().toISOString().split('T')[0];
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await req.json();
      const { restaurant_id, entries } = body;

      if (!restaurant_id || !entries || !Array.isArray(entries)) {
        return NextResponse.json({ error: "Missing restaurant_id or entries array" }, { status: 400 });
      }

      return await processEntries(restaurant_id, entries);
    }

    // Excel / CSV upload
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const restaurant_id = formData.get('restaurant_id') as string;

    if (!file || !restaurant_id) {
      return NextResponse.json({ error: "File and restaurant_id are required" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });

    const entries: any[] = [];

    // Sheet 1: Daily Totals
    const totalsSheet = workbook.Sheets['Daily Totals'] || workbook.Sheets['Sheet1'];
    if (totalsSheet) {
      const data = XLSX.utils.sheet_to_json(totalsSheet);
      data.forEach((row: any) => {
        const date = excelDateToISO(row.date);
        entries.push({
          date: date,
          totals: {
            // FIXED: Combine sales_qr + sales_cash into 'sales'
            sales: (Number(row.sales_qr) || 0) + (Number(row.sales_cash) || 0),
            swiggy: row.swiggy || 0,
            zomato: row.zomato || 0,
            hyperpure: row.hyperpure || 0,
            bigbasket: row.bigbasket || 0,
            milk: row.milk || 0,
            bread: row.bread || 0,
            rent: row.rent || 0,
            electricity: row.electricity || 0,
            gas: row.gas || 0,
            salary: row.salary || 0,
            other: row.other || 0,
          }
        });
      });
    }

    // Sheet 2: Item Level (unchanged)
    const itemsSheet = workbook.Sheets['Item Level'] || workbook.Sheets['Sheet2'];
    if (itemsSheet) {
      const data = XLSX.utils.sheet_to_json(itemsSheet);
      const grouped: any = {};

      data.forEach((row: any) => {
        const date = excelDateToISO(row.date);
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push({
          item_name: row.item_name,
          quantity: row.quantity || 1,
          unit: row.unit || '',
          amount: row.amount,
          vendor: row.vendor || 'Backfill'
        });
      });

      Object.keys(grouped).forEach(date => {
        entries.push({
          date: date,
          items: grouped[date]
        });
      });
    }

    if (entries.length === 0) {
      return NextResponse.json({ error: "No valid data found in the uploaded file" }, { status: 400 });
    }

    return await processEntries(restaurant_id, entries);

  } catch (error: any) {
    console.error("[Backfill API] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function processEntries(restaurant_id: string, entries: any[]) {
  const results = [];

  for (const entry of entries) {
    const { date, totals, items } = entry;

    if (totals && Object.keys(totals).length > 0) {
      const { success } = await dataService.upsertPnlEntry(restaurant_id, {
        date: date,
        ...totals
      });
      results.push({ date, type: "totals", success });
    }

    if (items && Array.isArray(items) && items.length > 0) {
      await dataService.saveInvoiceItems(
        restaurant_id,
        entry.vendor || "Backfill",
        date,
        items
      );
      results.push({ date, type: "items", count: items.length, success: true });
    }
  }

  return NextResponse.json({
    success: true,
    message: "Backfill completed successfully",
    results
  });
}
