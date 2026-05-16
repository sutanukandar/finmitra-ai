import { createClient } from '@supabase/supabase-js';
import { PnlEntryData, PendingConfirmationPayload, PnlSummary } from '../app/api/webhook/types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Data Layer Module (Centralized Supabase operations)
 * As per Master TRD - Data Layer Module
 */
export const dataService = {

  /**
   * Additive upsert for pnl_entries (core operation)
   */
  async upsertPnlEntry(restaurantId: string, date: string, data: PnlEntryData) {
    try {
      const { error } = await supabase
        .from('pnl_entries')
        .upsert({
          restaurant_id: restaurantId,
          date,
          ...data
        }, { onConflict: 'restaurant_id,date' });

      if (error) {
        console.error("[dataService] upsertPnlEntry failed:", error);
        return { success: false, error };
      }

      return { success: true };
    } catch (error: any) {
      console.error("[dataService] upsertPnlEntry exception:", error);
      return { success: false, error };
    }
  },

  /**
   * Get P&L data for a period
   */
  async getPnlData(restaurantId: string, startDate: string, endDate?: string) {
    try {
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

      if (error) {
        console.error("[dataService] getPnlData failed:", error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error: any) {
      console.error("[dataService] getPnlData exception:", error);
      return { data: null, error };
    }
  },

  /**
   * Store pending confirmation for media uploads
   */
  async createPendingConfirmation(restaurantId: string, payload: PendingConfirmationPayload) {
    try {
      const { error } = await supabase
        .from('pending_confirmations')
        .insert({
          restaurant_id: restaurantId,
          action: 'add_entries',
          payload,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min TTL
        });

      if (error) {
        console.error("[dataService] createPendingConfirmation failed:", error);
        return { success: false, error };
      }

      return { success: true };
    } catch (error: any) {
      console.error("[dataService] createPendingConfirmation exception:", error);
      return { success: false, error };
    }
  },

  /**
   * Delete pending confirmation after confirmation/cancel
   */
  async deletePendingConfirmation(restaurantId: string) {
    try {
      const { error } = await supabase
        .from('pending_confirmations')
        .delete()
        .eq('restaurant_id', restaurantId)
        .eq('action', 'add_entries');

      if (error) {
        console.error("[dataService] deletePendingConfirmation failed:", error);
        return { success: false, error };
      }

      return { success: true };
    } catch (error: any) {
      console.error("[dataService] deletePendingConfirmation exception:", error);
      return { success: false, error };
    }
  },

  /**
   * Soft delete an entry (for future undo/delete feature)
   */
  async softDeleteEntry(restaurantId: string, date: string) {
    try {
      const { error } = await supabase
        .from('pnl_entries')
        .update({ deleted_at: new Date().toISOString() })
        .eq('restaurant_id', restaurantId)
        .eq('date', date);

      if (error) {
        console.error("[dataService] softDeleteEntry failed:", error);
        return { success: false, error };
      }

      return { success: true };
    } catch (error: any) {
      console.error("[dataService] softDeleteEntry exception:", error);
      return { success: false, error };
    }
  }
};
