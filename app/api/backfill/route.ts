import { NextRequest, NextResponse } from 'next/server';
import { dataService } from '../../../lib/db/dataService';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { restaurant_id, entries } = body;

    if (!restaurant_id || !entries || !Array.isArray(entries)) {
      return NextResponse.json({ error: "Missing restaurant_id or entries array" }, { status: 400 });
    }

    const results = [];

    for (const entry of entries) {
      const { date, totals, items } = entry;

      // Save aggregated totals
      if (totals && Object.keys(totals).length > 0) {
        const { success } = await dataService.upsertPnlEntry(restaurant_id, {
          date: date,
          ...totals
        });
        results.push({ date, type: "totals", success });
      }

      // Save item-level data
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

  } catch (error: any) {
    console.error("[Backfill] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
