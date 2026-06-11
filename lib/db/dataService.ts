import { createClient } from '@supabase/supabase-js';
import { PnlEntryData } from '../../app/api/webhook/types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normaliseVendor(raw: string): string {
  const v = (raw || '').toLowerCase();
  if (v.includes('hyperpure') || (v.includes('zomato') && !v.includes('swiggy')))
    return 'Zomato Hyperpure Private Limited';
  if (v.includes('bigbasket') || v.includes('big basket') ||
      v.includes('bbnow') || v.includes('bb now') ||
      v.includes('innovative retail'))
    return 'BigBasket Now';
  if (v.includes('dmart') || v.includes('avenue e-commerce') ||
      v.includes('avenue e commerce'))
    return 'DMart';
  if (v.includes('swiggy'))
    return 'Swiggy';
  return raw.trim();
}

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
      restaurant_id:       restaurantId,
      vendor:              normaliseVendor(item.vendor || vendor),
      date:                date,
      item_name:           item.item_name || item.name || 'Unknown Item',
      item_canonical:      item.item_canonical || null,
      unit_normalised:     item.unit_normalised || null,
      quantity_normalised: item.quantity_normalised || null,
      quantity:            item.quantity || 1,
      unit:                item.unit || '',
      rate:                item.rate || 0,
      amount:              item.amount || 0,
      mapped_category:     item.mapped_category || 'cogs',
      upload_record_id:    uploadRecordId || null,
      metadata:            { invoice_number: item.invoice_number || '' }
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
  ): Promise<{ isDuplicate: boolean; existingAmount?: number; enteredAt?: string; csvExists: boolean }> {
    const { data } = await supabase
      .from('pnl_entries')
      .select(`${category}, updated_at, metadata`)
      .eq('restaurant_id', restaurantId)
      .eq('date', date)
      .maybeSingle();

    if (!data) return { isDuplicate: false, csvExists: false };

    const row = data as any;
    const existingAmount = row[category] !== null && row[category] !== undefined
      ? Number(row[category])
      : null;

    const meta = (row.metadata || {}) as Record<string, string[]>;
    const csvExists = (meta[`${category}_sources`] || []).includes('csv');

    if (existingAmount === null) return { isDuplicate: false, csvExists };

    return {
      isDuplicate: existingAmount === amount,
      existingAmount,
      enteredAt: row.updated_at,
      csvExists,
    };
  },

  async checkDuplicatePending(
    restaurantId: string,
    vendor: string,
    date: string,
    amount: number
  ): Promise<{ isDuplicate: boolean; existingAmount?: number; existingCreatedAt?: string }> {
    const { data } = await supabase
      .from('pending_confirmations')
      .select('payload, created_at')
      .eq('restaurant_id', restaurantId)
      .eq('action', 'confirm_bill')
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle();

    if (!data?.payload) return { isDuplicate: false };

    const p = data.payload;
    const normalize = (v: string) => {
      const lv = (v || '').toLowerCase();
      if (lv.includes('hyperpure') || lv.includes('zomato')) return 'hyperpure';
      if (lv.includes('bigbasket') || lv.includes('big basket') || lv.includes('bbnow') || lv.includes('innovative retail')) return 'bigbasket';
      return 'other';
    };

    const sameVendor = normalize(vendor) === normalize(p.vendor || '');
    const sameDate   = p.date === date;
    const low        = amount * 0.95;
    const high       = amount * 1.05;
    const sameAmount = (p.total || 0) >= low && (p.total || 0) <= high;

    if (sameVendor && sameDate && sameAmount) {
      return { isDuplicate: true, existingAmount: p.total, existingCreatedAt: data.created_at };
    }
    return { isDuplicate: false };
  },

  async checkDuplicateBill(
    restaurantId: string,
    vendor: string,
    date: string,
    amount: number
  ): Promise<{ isDuplicate: boolean; existingRecord?: { id: string; amount: number; created_at: string } }> {
    const v = (vendor || '').toLowerCase();
    const pnlField =
      v.includes('hyperpure') || v.includes('zomato') ? 'hyperpure'
      : v.includes('bigbasket') || v.includes('big basket') || v.includes('bbnow') || v.includes('innovative retail') ? 'bigbasket'
      : 'other';

    const { data } = await supabase
      .from('upload_records')
      .select('id, amount, created_at')
      .eq('restaurant_id', restaurantId)
      .eq('date', date)
      .eq('pnl_field', pnlField)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(5);

    if (!data || data.length === 0) return { isDuplicate: false };

    const low   = amount * 0.95;
    const high  = amount * 1.05;
    const match = data.find(row => {
      const n = Number(row.amount);
      return n >= low && n <= high;
    });

    return { isDuplicate: !!match, existingRecord: match || undefined };
  },

  // ── Core entry accumulation ──────────────────────────────────────────
  // breakdownLabel: if provided, also writes to metadata.other_breakdown
  // or metadata.misc_breakdown so detailed P&L can show line items.
  // Only applies when category is 'other' or 'misc'.
  async accumulatePnlEntry(
    restaurantId: string,
    category: string,
    date: string,
    amount: number,
    source: 'whatsapp' | 'csv' | 'backfill' = 'whatsapp',
    breakdownLabel?: string   // e.g. "Zepto", "Packaging", "Pest Control"
  ): Promise<{ newTotal: number }> {
    const { data } = await supabase
      .from('pnl_entries')
      .select(`${category}, metadata`)
      .eq('restaurant_id', restaurantId)
      .eq('date', date)
      .maybeSingle();

    const existing = Number((data as any)?.[category] || 0);
    const newTotal = existing + amount;

    // Build updated metadata
    const meta = ((data as any)?.metadata || {}) as Record<string, any>;

    // Source tracking (existing behaviour)
    const sourceKey = `${category}_sources`;
    const sources: string[] = meta[sourceKey] || [];
    if (!sources.includes(source)) sources.push(source);
    meta[sourceKey] = sources;

    // Breakdown tracking (new: only for catch-all columns)
    if (breakdownLabel && (category === 'other' || category === 'misc' || category === 'local_market')) {
      const bucketKey = category === 'other'         ? 'other_breakdown'
                      : category === 'misc'          ? 'misc_breakdown'
                      :                               'local_market_breakdown';
      if (!meta[bucketKey]) meta[bucketKey] = {};
      const labelKey = breakdownLabel.toLowerCase();
      meta[bucketKey][labelKey] = (meta[bucketKey][labelKey] || 0) + amount;
      console.log(`[dataService] Metadata breakdown: ${bucketKey}.${labelKey} += ${amount}`);
    }

    const { error } = await supabase
      .from('pnl_entries')
      .upsert(
        { restaurant_id: restaurantId, date, [category]: newTotal, metadata: meta },
        { onConflict: 'restaurant_id,date' }
      );

    if (error) {
      console.error("[dataService] accumulatePnlEntry failed:", error);
      throw error;
    }
    console.log(`[dataService] Accumulated ${category}: ${existing} + ${amount} = ${newTotal} for ${date} (source: ${source}${breakdownLabel ? `, label: ${breakdownLabel}` : ''})`);

    return { newTotal };
  },

  // ── Expense categories: custom classification per restaurant ─────────

  async getExpenseCategory(
    restaurantId: string,
    categoryName: string
  ): Promise<{ costType: 'item_cost' | 'fixed_cost'; pnlBucket: 'other' | 'misc'; displayLabel: string } | null> {
    const { data } = await supabase
      .from('expense_categories')
      .select('cost_type, pnl_bucket, display_label')
      .eq('restaurant_id', restaurantId)
      .eq('category_name', categoryName.toLowerCase().trim())
      .maybeSingle();

    if (!data) return null;
    return {
      costType:     data.cost_type as 'item_cost' | 'fixed_cost',
      pnlBucket:    data.pnl_bucket as 'other' | 'misc',
      displayLabel: data.display_label,
    };
  },

  async saveExpenseCategory(
    restaurantId: string,
    categoryName: string,
    displayLabel: string,
    costType: 'item_cost' | 'fixed_cost',
    pnlBucket: 'other' | 'misc'
  ): Promise<void> {
    const { error } = await supabase
      .from('expense_categories')
      .upsert({
        restaurant_id: restaurantId,
        category_name: categoryName.toLowerCase().trim(),
        display_label: displayLabel,
        cost_type:     costType,
        pnl_bucket:    pnlBucket,
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'restaurant_id,category_name' });

    if (error) {
      console.error("[dataService] saveExpenseCategory failed:", error);
      throw error;
    }
    console.log(`[dataService] Saved expense category: ${categoryName} → ${costType} (${pnlBucket})`);
  },

  // ── Reclassify: move amount between pnl columns + update metadata ───

  async reclassifyExpense(
    restaurantId: string,
    categoryName: string,           // e.g. "cylinder"
    fromColumn: 'other' | 'misc' | 'local_market',  // current wrong column
    toColumn: string,               // correct column (e.g. 'gas', 'misc', 'other')
    toBreakdownLabel: string | null, // label for toColumn breakdown (if toColumn is other/misc)
    dateFilter?: { start: string; end: string }
  ): Promise<{ rowsAffected: number; totalMoved: number }> {
    // Fetch all rows that have this category in their metadata breakdown
    let query = supabase
      .from('pnl_entries')
      .select('id, date, metadata, ' + fromColumn + ', ' + (toColumn !== fromColumn ? toColumn : ''))
      .eq('restaurant_id', restaurantId);

    if (dateFilter) {
      query = query.gte('date', dateFilter.start).lte('date', dateFilter.end);
    }

    const { data: rows, error } = await query;
    if (error || !rows) {
      console.error("[dataService] reclassifyExpense fetch failed:", error);
      throw error;
    }

    const breakdownKey = fromColumn === 'other' ? 'other_breakdown' : 'misc_breakdown';
    const labelKey = categoryName.toLowerCase().trim();

    let rowsAffected = 0;
    let totalMoved = 0;

    for (const row of rows as any[]) {
      const meta = (row.metadata || {}) as any;
      const breakdownAmount = meta[breakdownKey]?.[labelKey];
      if (!breakdownAmount || breakdownAmount <= 0) continue;

      // Remove from source
      const fromCurrent = Number(row[fromColumn] || 0);
      const newFromTotal = Math.max(0, fromCurrent - breakdownAmount);
      delete meta[breakdownKey][labelKey];

      // Add to destination
      const toCurrent = Number(row[toColumn] || 0);
      const newToTotal = toCurrent + breakdownAmount;

      // Update destination breakdown if toColumn is also a catch-all
      if (toBreakdownLabel && (toColumn === 'other' || toColumn === 'misc')) {
        const toBucketKey = toColumn === 'other' ? 'other_breakdown' : 'misc_breakdown';
        if (!meta[toBucketKey]) meta[toBucketKey] = {};
        meta[toBucketKey][toBreakdownLabel.toLowerCase()] =
          (meta[toBucketKey][toBreakdownLabel.toLowerCase()] || 0) + breakdownAmount;
      }

      const updatePayload: any = {
        metadata: meta,
        [fromColumn]: newFromTotal,
      };
      if (toColumn !== fromColumn) updatePayload[toColumn] = newToTotal;

      await supabase
        .from('pnl_entries')
        .update(updatePayload)
        .eq('restaurant_id', restaurantId)
        .eq('date', row.date);

      rowsAffected++;
      totalMoved += breakdownAmount;
    }

    console.log(`[dataService] Reclassified ${categoryName}: moved ₹${totalMoved} across ${rowsAffected} rows from ${fromColumn} to ${toColumn}`);
    return { rowsAffected, totalMoved };
  },

  async getTopItemsBySpend(
    restaurantId: string,
    startDate: string,
    endDate?: string
  ): Promise<Array<{ item_name: string; vendors: string[]; total_spend: number; total_qty: number; times_purchased: number }>> {
    let query = supabase
      .from('invoice_items')
      .select('item_name, vendor, amount, quantity')
      .eq('restaurant_id', restaurantId)
      .gte('date', startDate);

    if (endDate) query = query.lte('date', endDate);

    const { data, error } = await query;
    if (error || !data) {
      console.error("[dataService] getTopItemsBySpend failed:", error);
      return [];
    }

    const map = new Map<string, { vendors: Set<string>; total_spend: number; total_qty: number; times_purchased: number }>();
    for (const row of data as any[]) {
      const key = (row.item_name || 'Unknown').trim();
      const existing = map.get(key) || { vendors: new Set<string>(), total_spend: 0, total_qty: 0, times_purchased: 0 };
      existing.vendors.add(row.vendor || 'Unknown');
      existing.total_spend += Number(row.amount || 0);
      existing.total_qty   += Number(row.quantity || 0);
      existing.times_purchased += 1;
      map.set(key, existing);
    }

    return Array.from(map.entries())
      .map(([item_name, v]) => ({
        item_name,
        vendors: Array.from(v.vendors),
        total_spend: v.total_spend,
        total_qty: v.total_qty,
        times_purchased: v.times_purchased
      }))
      .sort((a, b) => b.total_spend - a.total_spend)
      .slice(0, 8);
  },

  async zeroPnlColumn(
    restaurantId: string,
    category: string,
    date: string
  ): Promise<void> {
    const { error } = await supabase
      .from('pnl_entries')
      .update({ [category]: 0 })
      .eq('restaurant_id', restaurantId)
      .eq('date', date);
    if (error) {
      console.error("[dataService] zeroPnlColumn failed:", error);
      throw error;
    }
    console.log(`[dataService] Zeroed ${category} for ${date}`);
  },

  // ── Soft delete for text entries ─────────────────────────────────────
  // Saves the current column value to deleted_entries BEFORE zeroing,
  // enabling recovery. Replaces bare zeroPnlColumn calls in confirmationHandler.
  async softDeleteTextEntry(
    restaurantId: string,
    category: string,
    date: string,
    amount: number,
    deletedBy: string = 'owner'
  ): Promise<void> {
    // 1. Record in deleted_entries for recovery
    const { error: logErr } = await supabase
      .from('deleted_entries')
      .insert({
        restaurant_id: restaurantId,
        date,
        category,
        amount,
        deleted_by:  deletedBy,
        source:      'whatsapp',
      });
    if (logErr) console.error("[dataService] softDeleteTextEntry log failed:", logErr);

    // 2. Zero the column (same as before, but now reversible)
    const { error } = await supabase
      .from('pnl_entries')
      .update({ [category]: 0 })
      .eq('restaurant_id', restaurantId)
      .eq('date', date);
    if (error) {
      console.error("[dataService] softDeleteTextEntry zero failed:", error);
      throw error;
    }
    console.log(`[dataService] Soft-deleted ${category} ₹${amount} for ${date} — recoverable`);
  },

  // ── Restore a soft-deleted text entry ────────────────────────────────
  async restoreDeletedEntry(
    deletedEntryId: string,
    restoredBy: string = 'owner'
  ): Promise<{ category: string; date: string; amount: number } | null> {
    // Fetch the deleted entry
    const { data: del } = await supabase
      .from('deleted_entries')
      .select('*')
      .eq('id', deletedEntryId)
      .is('restored_at', null)
      .maybeSingle();

    if (!del) return null;

    // Re-accumulate the amount back into pnl_entries
    await this.accumulatePnlEntry(
      del.restaurant_id, del.category, del.date, Number(del.amount), 'whatsapp'
    );

    // Mark as restored
    await supabase
      .from('deleted_entries')
      .update({ restored_at: new Date().toISOString(), restored_by: restoredBy })
      .eq('id', deletedEntryId);

    console.log(`[dataService] Restored ${del.category} ₹${del.amount} for ${del.date}`);
    return { category: del.category, date: del.date, amount: Number(del.amount) };
  },

  // ── Soft delete a bill upload ────────────────────────────────────────
  // Sets deleted_at on upload_records and reverses the pnl_entries amount.
  async softDeleteBill(
    restaurantId: string,
    uploadRecordId: string,
    deletedBy: string = 'owner'
  ): Promise<void> {
    // Fetch the upload record
    const { data: record } = await supabase
      .from('upload_records')
      .select('date, amount, pnl_field')
      .eq('id', uploadRecordId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!record) throw new Error(`Upload record ${uploadRecordId} not found or already deleted`);

    // Reverse the pnl_entries amount
    const { data: existing } = await supabase
      .from('pnl_entries')
      .select(`${record.pnl_field}`)
      .eq('restaurant_id', restaurantId)
      .eq('date', record.date)
      .maybeSingle();

    const currentVal = Number((existing as any)?.[record.pnl_field] || 0);
    const newVal     = Math.max(0, currentVal - Number(record.amount));

    await supabase
      .from('pnl_entries')
      .upsert(
        { restaurant_id: restaurantId, date: record.date, [record.pnl_field]: newVal },
        { onConflict: 'restaurant_id,date' }
      );

    // Soft-delete the upload record
    await supabase
      .from('upload_records')
      .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy })
      .eq('id', uploadRecordId);

    console.log(`[dataService] Soft-deleted bill ${uploadRecordId}: reversed ₹${record.amount} from ${record.pnl_field} on ${record.date}`);
  },

  async getPnlColumn(restaurantId: string, category: string, date: string): Promise<number> {
    const { data } = await supabase
      .from('pnl_entries')
      .select(category)
      .eq('restaurant_id', restaurantId)
      .eq('date', date)
      .maybeSingle();
    return Number((data as any)?.[category] || 0);
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
