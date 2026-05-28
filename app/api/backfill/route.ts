import { NextRequest, NextResponse } from 'next/server';
import { parser } from '../webhook/parser';
import { dataService } from '../../../lib/db/dataService';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file         = formData.get('file') as File | null;
    const restaurantId = formData.get('restaurantId') as string | null;
    const month        = formData.get('month') as string | null;

    if (!file || !restaurantId) {
      return NextResponse.json({ success: false, error: 'file and restaurantId required' }, { status: 400 });
    }

    const buffer      = await file.arrayBuffer();
    const base64Data  = Buffer.from(buffer).toString('base64');
    const contentType = file.type || 'image/jpeg';

    const parseResult = await parser.parseMediaBase64(base64Data, contentType);

    if (!parseResult.success) {
      return NextResponse.json({ success: false, error: parseResult.extracted || 'Parse failed' });
    }

    const vendor = parseResult.vendor || '';
    const date   = parseResult.date   || (month ? month + '-01' : new Date().toISOString().split('T')[0]);
    const total  = parseResult.total  || 0;

    const dupCheck = await dataService.checkDuplicateBill(restaurantId, vendor, date, total);

    return NextResponse.json({
      success: true,
      parsed: {
        vendor:          parseResult.vendor,
        date:            parseResult.date,
        total:           parseResult.total,
        items:           parseResult.items || [],
        delivery_fee:    parseResult.delivery_fee || 0,
        is_duplicate:    dupCheck.isDuplicate,
        existing_record: dupCheck.existingRecord
          ? { amount: dupCheck.existingRecord.amount, created_at: dupCheck.existingRecord.created_at }
          : null,
      }
    });

  } catch (error: any) {
    console.error('[Backfill API] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
