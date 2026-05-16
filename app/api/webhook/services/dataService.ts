import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Centralized Data Layer for Webhook Module (as per TRD)
 */
export const dataService = {
  /**
   * Additive upsert for pnl_entries
   */
  async upsertPnlEntry(restaurantId: string, date: string, data: any) {
    const { error } = await supabase
      .from('pnl_entries')
      .upsert({
        restaurant_id: restaurantId,
        date,
        ...data
      }, { onConflict: 'restaurant_id,date' });

    if (error) console.error("[dataService] upsertPnlEntry error:", error);
    return { success: !error };
  },

  /**
   * Get P&L data for a specific period
   */
  async getPnlData(restaurantId: string, startDate: string, endDate?: string) {
    let query = supabase
      .from('pnl_entries')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .gte('date', startDate)
      .order('date', { ascending: true });

    if (endDate) {
      query = query.lte('date', endDate);
    }

    const { data, error } = await query;
    return { data, error };
  },

  /**
   * Store pending confirmation (for media uploads)
   */
  async createPendingConfirmation(restaurantId: string, payload: any) {
    const { error } = await supabase
      .from('pending_confirmations')
      .insert({
        restaurant_id: restaurantId,
        action: 'add_entries',
        payload,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes TTL
      });

    if (error) console.error("[dataService] createPendingConfirmation error:", error);
    return { success: !error };
  },

  /**
   * Clean up pending confirmation
   */
  async deletePendingConfirmation(restaurantId: string) {
    const { error } = await supabase
      .from('pending_confirmations')
      .delete()
      .eq('restaurant_id', restaurantId)
      .eq('action', 'add_entries');

    return { success: !error };
  }
};
