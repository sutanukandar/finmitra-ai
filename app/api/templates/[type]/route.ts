import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const { type } = await params;   // ← This is the fix

  if (type === 'pnl') {
    const wb = XLSX.utils.book_new();
    const wsData = [
      ['date', 'sales_qr', 'sales_cash', 'swiggy', 'zomato', 'hyperpure', 'bigbasket', 'milk', 'bread', 'rent', 'electricity', 'gas', 'salary', 'other'],
      ['2026-05-20', '3500', '1200', '450', '600', '2400', '1800', '360', '180', '15000', '4500', '1200', '25000', '5000'],
      ['2026-05-21', '4200', '800', '300', '400', '2200', '1600', '300', '150', '15000', '4500', '1200', '25000', '4000'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Daily Totals');

    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="finmitra-pnl-template.xlsx"',
      },
    });
  }

  if (type === 'invoice') {
    const wb = XLSX.utils.book_new();
    const wsData = [
      ['date', 'vendor', 'item_name', 'quantity', 'unit', 'amount'],
      ['2026-05-20', 'Hyperpure', 'VIVI - Honey, 1 Kg', '2', 'Kg', '420'],
      ['2026-05-20', 'BigBasket', 'Bru Coffee Powder 500gm', '1', 'Pc', '595'],
      ['2026-05-21', 'Dmart', 'VIVI - Honey, 1 Kg', '3', 'Kg', '470'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Item Level');

    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="finmitra-invoice-template.xlsx"',
      },
    });
  }

  return NextResponse.json({ error: 'Invalid template type' }, { status: 400 });
}
