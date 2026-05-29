// =============================================
// Types for Webhook Module (as per TRD)
// =============================================

export interface ParsedIntent {
  intent: 'add_entries' | 'query_today' | 'query_mtd' | 'query_lastmonth' | 'query_specific' | 'query_pnl' | 'query_items' | 'query_ingredient' | 'query_vendor_breakdown' | 'query_daily_breakdown' | 'help' | 'unknown';
  entries?: Array<{
    category: string;
    amount: number;
    date_offset?: number;
    date?: string;       // explicit YYYY-MM-DD when parser extracts a specific date
  }>;
  metric?: string;         // for query_specific: 'sales' | 'cogs'
  period?: string;         // 'today' | 'mtd' | 'specific_date'
  date?: string;           // for query_items specific_date: YYYY-MM-DD
  vendor_filter?: string | null;  // for query_items: 'hyperpure' | 'bigbasket' | 'dmart' | null
  limit?: number;          // for query_items: default 5
  sort_by?: string;        // for query_items: 'value' | 'weight', default 'value'
  ingredient?: string;     // for query_ingredient: e.g. "Carrot"
  month?: string;          // for query_ingredient specific_month: YYYY-MM
  months?: string[];       // for multi_month period: ["YYYY-MM", ...]
  days?: number;           // for last_n_days period: number of days
}

export interface PnlEntryData {
  swiggy?: number;
  phonepe?: number;
  hyperpure?: number;
  bigbasket?: number;
  milk?: number;
  bread?: number;
  rent?: number;
  electricity?: number;
  gas?: number;
  salary?: number;
  fixed?: number;
}

export interface MediaParseResult {
  success: boolean;
  vendor?: string;
  date?: string;
  total?: number;
  items?: Array<{ name: string; amount: number }>;
  delivery_fee?: number;
  mediaUrl?: string;
  extracted?: string;
}

export interface PendingConfirmationPayload {
  mediaUrl?: string;
  parsedData?: any;
  [key: string]: any;
}

export interface PnlSummary {
  revenue: number;
  cogs: number;
  grossProfit: number;
  fixedCost: number;
  netProfit: number;
  margin: number;
}

export type ConfirmationAction = 'add_entries' | 'delete_entry' | 'delete_date';
