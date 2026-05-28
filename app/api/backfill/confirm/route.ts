import { NextRequest, NextResponse } from 'next/server';
import { dataService } from '../../../../lib/db/dataService';

export async function POST(req: NextRequest) {
  try {
    const { restaurantId, parsed, month, force } = await req.json();

    if (!restaurantId || !parsed) {
      return NextResponse.json({ success: false, error: 'restaurantId and parsed required' }, { status: 400 });
    }

    if (parsed.is_duplicate && !force) {
      return NextResponse.json({ success: true, skipped: true });
    }

    const vendorName = (parsed.vendor || '').toLowerCase().trim();
    const entryDate  = parsed.date || (month ? month + '-01' : new Date().toISOString().split('T')[0]);

    const pnlField =
      vendorName.includes('hyperpure') || vendorName.includes('zomato') ? 'hyperpure'
      : vendorName.includes('bigbasket') || vendorName.includes('big basket') ||
        vendorName.includes('bbnow') || vendorName.includes('bb now') ||
        vendorName.includes('innovative retail') ? 'bigbasket'
      : 'other';

    const deliveryFee = parsed.delivery_fee || 0;
    const foodTotal   = (parsed.total || 0) - deliveryFee;

    const uploadRecordId = await dataService.createUploadRecord(restaurantId, {
      date:     entryDate,
      doc_type: 'invoice',
      source:   'backfill',
      amount:   parsed.total || 0,
      pnl_field: pnlField,
      metadata: { vendor: parsed.vendor, delivery_fee: deliveryFee }
    });

    const items = parsed.items || [];
    await dataService.saveInvoiceItems(
      restaurantId,
      parsed.vendor || 'Unknown Vendor',
      entryDate,
      items,
      uploadRecordId
    );

    const totals: any = {};
    if (pnlField === 'hyperpure')      totals.hyperpure = foodTotal;
    else if (pnlField === 'bigbasket') totals.bigbasket = foodTotal;
    else                               totals.other     = foodTotal;
    if (deliveryFee > 0) totals.other = (totals.other || 0) + deliveryFee;

    await dataService.upsertPnlEntry(restaurantId, { date: entryDate, ...totals });

    await dataService.writeAuditLog(restaurantId, {
      action:          force && parsed.is_duplicate ? 'backfill_duplicate_override' : 'backfill',
      date_affected:   entryDate,
      pnl_field:       pnlField,
      amount_reversed: parsed.total || 0,
    });

    return NextResponse.json({
      success:        true,
      uploadRecordId,
      itemsSaved:     items.length,
    });

  } catch (error: any) {
    console.error('[Backfill Confirm API] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
