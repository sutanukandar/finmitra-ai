import { NextRequest, NextResponse } from 'next/server';
import { dataService } from '../../../../lib/db/dataService';

export const maxDuration = 60;

interface Entry {
  date:      string;
  pnl_field: string;
  amount:    number;
}

export async function POST(req: NextRequest) {
  try {
    const { restaurantId, entries, source } = await req.json() as {
      restaurantId: string;
      entries: Entry[];
      source: 'csv' | 'backfill';
    };

    if (!restaurantId || !entries?.length) {
      return NextResponse.json({ success: false, error: 'Missing restaurantId or entries' }, { status: 400 });
    }

    const validSource = source === 'csv' ? 'csv' : 'backfill';

    for (const entry of entries) {
      await dataService.accumulatePnlEntry(
        restaurantId,
        entry.pnl_field,
        entry.date,
        entry.amount,
        validSource
      );
    }

    console.log(`[save-entries] Saved ${entries.length} entries for ${restaurantId} (source: ${validSource})`);
    return NextResponse.json({ success: true, saved: entries.length });

  } catch (err: any) {
    console.error('[save-entries] Error:', err);
    return NextResponse.json({ success: false, error: err.message || 'Save failed' }, { status: 500 });
  }
}
