import { createClient } from '@supabase/supabase-js';
import { PnlEntryData, PendingConfirmationPayload, MediaParseResult } from '../../app/api/webhook/types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dataService = {

  // Existing methods (unchanged)
  async upsertPnlEntry(restaurantId: string, entry: PnlEntryData) { ... }, // keep your existing code

  async getPnlData(restaurantId: string, period: 'today' | 'mtd' | 'lastmonth') { ... }, // keep existing

  async createPendingConfirmation(restaurantId: string, parseResult: any) { ... }, // keep existing

  async deletePendingConfirmation(restaurantId: string) { ... }, // keep existing

  /**
   * NEW: Save detailed item-level data from bill
   */
  async saveInvoiceItems(
    restaurantId: string,
    vendor: string,
    date: string,
    items: any[],
    uploadRecordId?: string
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
