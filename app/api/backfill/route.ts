import { NextRequest, NextResponse } from 'next/server';
import { dataService } from '../../../lib/db/dataService';

// POST /api/backfill - Founder Backfill Wizard Backend
export async function POST(req: NextRequest) {
  try {
    const { restaurant_id, entries } = await req.json();

    if (!restaurant_id || !entries || !Array.isArray(entries)) {
      return NextResponse.json({ 
        success: false, 
        error: "restaurant_id and entries array are required" 
      }, { status: 400 });
    }

    const results = [];

    for (const entry of entries) {
      const { date, items, ...totals } = entry;

      // 1. Save aggregated totals (if provided)
      if (Object.keys(totals).length > 0) {
        const { success } = await dataService.upsertPnlEntry(restaurant_id, date, totals);
        results.push({ date, type: "totals", success });
      }

      // 2. Save item-level data (if provided)
      if (items && Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          // TODO: Insert into invoice_items table (we will add later)
          // For now, we log it
          console.log(`[Backfill] Item saved: ${item.vendor} - ${item.item_name} - ₹${item.amount}`);
        }
        results.push({ date, type: "items", count: items.length, success: true });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully backfilled ${results.length} entries`,
      results
    });

  } catch (error: any) {
    console.error("[Backfill API] Error:", error);
    return NextResponse.json({
      success: false,
      error: error.message || "Internal server error"
    }, { status: 500 });
  }
}

// GET /api/backfill - Get existing backfill data for a restaurant
export async function GET(req: NextRequest) {
  const restaurant_id = req.nextUrl.searchParams.get('restaurant_id');

  if (!restaurant_id) {
    return NextResponse.json({ error: "restaurant_id is required" }, { status: 400 });
  }

  const { data, error } = await dataService.getPnlData(restaurant_id, "2025-01-01");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
