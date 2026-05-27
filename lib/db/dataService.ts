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
      entry = { date: arg2, ...arg3 };
    } else {
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

    if (typeof arg2 === 'string' && arg3) {
      query = query.gte('date', arg2).lte('date', arg3);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[dataService] getPnlData failed:", error);
      return { data: [], error };
    }
    return { data: data || [], error: null };
  },

  async createPendingConfirmation(
    restaurantId: string,
    parseResult: any,
    action: string = 'confirm_bill'
  ) {
    const { error } = await supabase
      .from('pending_confirmations')
      .insert({
        restaurant_id: restaurantId,
        action,
        payload: parseResult,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min TTL
      });

    if (error) {
      console.error("[dataService] createPendingConfirmation failed:", error);
      throw error;
    }
    console.log(`[dataService] Pending confirmation created (action=${action}) for ${restaurantId}`);
  },

  async getPendingConfirmation(restaurantId: string) {
    const { data, error } = await supabase
      .from('pending_confirmations')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      console.error("[dataService] getPendingConfirmation failed or no record:", error);
      return null;
    }
    return data;
  },

  async deletePendingConfirmation(restaurantId: string) {
    const { error } = await supabase
      .from('pending_confirmations')
      .delete()
      .eq('restaurant_id', restaurantId);
    if (error) console.error(error);
  },

  async createUploadRecord(
    restaurantId: string,
    data: {
      date: string;
      doc_type: string;
      source: string;
      amount: number;
      pnl_field: string;
      file_url?: string;
      metadata?: object;
    }
  ): Promise<string> {
    const { data: record, error } = await supabase
      .from('upload_records')
      .insert({ restaurant_id: restaurantId, ...data })
      .select('id')
      .single();

    if (error) {
      console.error("[dataService] createUploadRecord failed:", error);
      throw error;
    }
    console.log(`[dataService] upload_records row created: ${record.id}`);
    return record.id;
  },

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
      upload_record_id: uploadRecordId || null,
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
  },

  async checkDuplicateTextEntry(
    restaurantId: string,
    category: string,
    date: string,
    amount: number
  ): Promise<{ isDuplicate: boolean; existingAmount?: number; enteredAt?: string }> {
    const { data } = await supabase
      .from('pnl_entries')
      .select(`${category}, updated_at`)
      .eq('restaurant_id', restaurantId)
      .eq('date', date)
      .maybeSingle();

    if (!data) return { isDuplicate: false };

    const existingAmount = data[category] !== null && data[category] !== undefined
      ? Number(data[category])
      : null;

    if (existingAmount === null) return { isDuplicate: false };

    return {
      isDuplicate: existingAmount === amount,
      existingAmount,
      enteredAt: data.updated_at
    };
  },

  async checkDuplicatePending(
    restaurantId: string,
    vendor: string,
    date: string,
    amount: number
  ): Promise<{ isDuplicate: boolean }> {
    const { data } = await supabase
      .from('pending_confirmations')
      .select('payload')
      .eq('restaurant_id', restaurantId)
      .in('action', ['confirm_bill', 'duplicate_bill_check'])
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle();

    if (!data?.payload) return { isDuplicate: false };

    const p = data.payload;
    const sameVendorField = (() => {
      const normalize = (v: string) => {
        const lv = v.toLowerCase();
        if (lv.includes('hyperpure') || lv.includes('zomato')) return 'hyperpure';
        if (lv.includes('bigbasket') || lv.includes('big basket') || lv.includes('bbnow') || lv.includes('innovative retail')) return 'bigbasket';
        return 'other';
      };
      return normalize(vendor) === normalize(p.vendor || '');
    })();

    const sameDate   = p.date === date;
    const low        = amount * 0.95;
    const high       = amount * 1.05;
    const sameAmount = (p.total || 0) >= low && (p.total || 0) <= high;

    return { isDuplicate: sameVendorField && sameDate && sameAmount };
  },

  async checkDuplicateBill(
    restaurantId: string,
    vendor: string,
    date: string,
    amount: number
  ): Promise<{ isDuplicate: boolean; existingRecord?: { id: string; amount: number; created_at: string } }> {
    const v = vendor.toLowerCase();
    const pnlField =
      v.includes('hyperpure') || v.includes('zomato') ? 'hyperpure'
      : v.includes('bigbasket') || v.includes('big basket') || v.includes('bbnow') || v.includes('innovative retail') ? 'bigbasket'
      : 'other';

    const low  = amount * 0.95;
    const high = amount * 1.05;

    const { data } = await supabase
      .from('upload_records')
      .select('id, amount, created_at')
      .eq('restaurant_id', restaurantId)
      .eq('date', date)
      .eq('pnl_field', pnlField)
      .gte('amount', low)
      .lte('amount', high)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    return {
      isDuplicate: !!data,
      existingRecord: data || undefined
    };
  },

  async accumulatePnlEntry(
    restaurantId: string,
    category: string,
    date: string,
    amount: number
  ): Promise<{ newTotal: number }> {
    const { data } = await supabase
      .from('pnl_entries')
      .select(category)
      .eq('restaurant_id', restaurantId)
      .eq('date', date)
      .maybeSingle();

    const existing = Number(data?.[category] || 0);
    const newTotal = existing + amount;

    const { error } = await supabase
      .from('pnl_entries')
      .upsert(
        { restaurant_id: restaurantId, date, [category]: newTotal },
        { onConflict: 'restaurant_id,date' }
      );

    if (error) {
      console.error("[dataService] accumulatePnlEntry failed:", error);
      throw error;
    }
    console.log(`[dataService] Accumulated ${category}: ${existing} + ${amount} = ${newTotal} for ${date}`);
    return { newTotal };
  },

  async writeAuditLog(
    restaurantId: string,
    data: {
      action: string;
      date_affected?: string;
      pnl_field?: string;
      amount_reversed?: number;
      performed_by?: string;
    }
  ) {
    const { error } = await supabase.from('audit_log').insert({
      restaurant_id:   restaurantId,
      action:          data.action,
      date_affected:   data.date_affected,
      pnl_field:       data.pnl_field,
      amount_reversed: data.amount_reversed,
      performed_by:    data.performed_by || 'owner',
      performed_at:    new Date().toISOString()
    });
    if (error) console.error("[dataService] writeAuditLog failed:", error);
  }
};
