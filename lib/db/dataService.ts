import { createClient } from '@supabase/supabase-js';
import { PnlEntryData, PendingConfirmationPayload, MediaParseResult } from '../../app/api/webhook/types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dataService = {

  async upsertPnlEntry(restaurantId: string, entry: PnlEntryData) {
    const { error } = await supabase
      .from('pnl_entries')
      .upsert({ ...entry, restaurant_id: restaurantId }, { onConflict: 'restaurant_id,date' });

    if (error) throw error;
    return true;
  },

  async getPnlData(restaurantId: string, period: 'today' | 'mtd' | 'lastmonth') {
    // Your existing P&L logic stays here
    const { data, error } = await supabase
      .from('pnl_entries')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('date', { ascending: false });

    if (error) throw error;
    return data;
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

  /**
   * NEW: Save detailed item-level data from bill
   */
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
    return true;
  }
};
