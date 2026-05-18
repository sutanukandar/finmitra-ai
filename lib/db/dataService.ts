import { createClient } from '@supabase/supabase-js';
import { PnlEntryData } from '../../app/api/webhook/types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dataService = {

  async upsertPnlEntry(restaurantId: string, arg2: any, arg3?: any) {
    let entry: PnlEntryData;

    if (arg3 !== undefined) {
      // backfill style: upsertPnlEntry(restaurantId, date, totals)
      entry = { date: arg2, ...arg3 };
    } else {
      // webhook style: upsertPnlEntry(restaurantId, entry)
      entry = arg2;
    }

    const { error } = await supabase
      .from('pnl_entries')
      .upsert({ ...entry, restaurant_id: restaurantId }, { onConflict: 'restaurant_id,date' });

    if (error) {
      console.error("[dataService] upsertPnlEntry failed:", error);
      return { success: false };
    }
    return { success: true };
  },

  async getPnlData(restaurantId: string, arg2: any, arg3?: any) {
    let query = supabase
      .from('pnl_entries')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('date', { ascending: false });

    // Support both old style (period) and new style (startDate, endDate)
    if (typeof arg2 === 'string' && arg3) {
      // date range: getPnlData(restaurantId, startDate, endDate)
      query = query.gte('date', arg2).lte('date', arg3);
    } else if (['today', 'mtd', 'lastmonth'].includes(arg2)) {
      // period style (kept for compatibility)
      // For now we return all data - you can enhance filtering later
    }

    const { data, error } = await query;

    if (error) {
      console.error("[dataService] getPnlData failed:", error);
      return { data: [], error };
    }
    return { data: data || [], error: null };
  },

  async createPendingConfirmation(restaurantId: string, parseResult: any) {
    const { error } = await supabase
      .from('pending_confirmations')
      .insert({ restaurant_id: restaurantId, parse_result: parseResult });
    if (error) throw error;
  },

  async deletePendingConfirmation(restaurantId: string) {
    const { error } = await supabase
      .from('pending_confirmations')
      .delete()
      .eq('restaurant_id', restaurantId);
    if (error) console.error(error);
  },

  async saveInvoiceItems(
    restaurantId: string,
    vendor: string,
    date: string,
    items: any[]
  ) {
    const insertData = items.map(item => ({
      restaurant_id: restaurantId,
      vendor: vendor,
      date: date,
      item_name: item.item_name || item.name || 'Unknown Item',
      quantity: item.quantity || 1,
      unit: item.unit || '',
      rate: item.rate || 0,
      amount: item.amount || 0,
      mapped_category: item.mapped_category || 'fixed',
      metadata: { invoice_number: item.invoice_number || '' }
    }));

    const { error } = await supabase
      .from('invoice_items')
      .insert(insertData);

    if (error) {
      console.error("[dataService] Failed to save invoice_items:", error);
      throw error;
    }

    console.log(`[dataService] Saved ${insertData.length} item-level rows for ${vendor}`);
    return { success: true };
  }
};
