import { parser } from '../parser';
import { dataService } from '../../../../lib/db/dataService';
import { ParsedIntent } from '../types';
import { handlePnlQuery } from './queryHandler';
import { handleFreeformQuery } from './queryFreeformHandler';
import { handleCorrectEntry } from './correctEntryHandler';

// ── Month name lookup ────────────────────────────────────────────────
const MONTH_NAME_TO_NUM: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

// ── Known pnl_entries columns ────────────────────────────────────────
const PNL_COLUMNS = new Set([
  'sales', 'revenue', 'cogs', 'phonepe', 'swiggy', 'zomato',
  'hyperpure', 'bigbasket', 'dmart', 'milk', 'bread', 'water', 'other',
  'local_market', 'rent', 'salary', 'electricity', 'gas', 'pg', 'internet',
  'garbage', 'repairs', 'marketing', 'misc', 'fixed',
]);

// ── KEYWORD CLASSIFIER ───────────────────────────────────────────────
// Maps a message keyword to a specific named pnl column (no metadata needed)
// Order matters — more specific patterns first
const DIRECT_COLUMN_KEYWORDS: Array<{ pattern: RegExp; column: string; label: string }> = [
  // Revenue
  { pattern: /\b(sales|revenue|bika|bikri)\b/, column: 'sales', label: 'Sales' },
  { pattern: /\bswiggy\b/, column: 'swiggy', label: 'Swiggy' },
  { pattern: /\bzomato\b/, column: 'zomato', label: 'Zomato' },
  { pattern: /\bphonepe\b/, column: 'phonepe', label: 'PhonePe' },
  // Item cost — named vendors
  { pattern: /\bmilk\b|\bdoodh\b/, column: 'milk', label: 'Milk' },
  { pattern: /\bbread\b/, column: 'bread', label: 'Bread' },
  { pattern: /\bwater\b|\bbisleri\b/, column: 'water', label: 'Water' },
  { pattern: /\bhyperpure\b/, column: 'hyperpure', label: 'Hyperpure' },
  { pattern: /bigbasket|big\s*basket|\bbbnow\b/, column: 'bigbasket', label: 'BigBasket' },
  { pattern: /\bdmart\b|d[\s-]mart/, column: 'dmart', label: 'DMart' },
  // Fixed cost — named columns
  { pattern: /\brent\b/, column: 'rent', label: 'Rent' },
  { pattern: /\bsalary\b|\bwages\b/, column: 'salary', label: 'Salary' },
  { pattern: /\belectricity\b|\bbijli\b/, column: 'electricity', label: 'Electricity' },
  { pattern: /\bgas\b|\blpg\b|\bcylinder\b|\brefill\b/, column: 'gas', label: 'Gas' },
  { pattern: /\bpg\b|\bstaff\s*pg\b/, column: 'pg', label: 'Staff PG' },
  { pattern: /\binternet\b|\bwifi\b|\bbroadband\b/, column: 'internet', label: 'Internet' },
  { pattern: /\bgarbage\b|\bwaste\s*col/, column: 'garbage', label: 'Garbage' },
  { pattern: /\brepairs\b|\bmaintenance\b/, column: 'repairs', label: 'Repairs' },
  { pattern: /\bmarketing\b|\bads\b|\badvertis/, column: 'marketing', label: 'Marketing' },
];

// Maps to 'other' (Item Cost catch-all) with metadata label
const ITEM_COST_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bpackaging\b|\bpacket\b/, label: 'Packaging' },
  { pattern: /carry\s*bag/, label: 'Carry Bag' },
  { pattern: /\btissue\b/, label: 'Tissue' },
  { pattern: /\bnapkin\b/, label: 'Napkin' },
  { pattern: /\bsabzi\b|\bvegetable\b|\bveggies?\b/, label: 'Vegetables' },
  { pattern: /\bmandi\b/, label: 'Sabzi Mandi' },
  { pattern: /\bmasala\b/, label: 'Masala' },
  { pattern: /\bspice\b|\bspices\b/, label: 'Spices' },
  { pattern: /\bpaneer\b/, label: 'Paneer' },
  { pattern: /\bchicken\b/, label: 'Chicken' },
  { pattern: /\bfish\b/, label: 'Fish' },
  { pattern: /\begg\b|\beggs\b/, label: 'Eggs' },
  { pattern: /\bflour\b|\bmaida\b|\batta\b/, label: 'Flour' },
  { pattern: /\brice\b/, label: 'Rice' },
  { pattern: /\bdal\b/, label: 'Dal' },
  { pattern: /\bzepto\b/, label: 'Zepto' },
  { pattern: /\bblinkit\b/, label: 'Blinkit' },
  { pattern: /instamart/, label: 'Instamart' },
  { pattern: /\bdunzo\b/, label: 'Dunzo' },
  { pattern: /cooking\s*oil|\boil\b/, label: 'Cooking Oil' },
  { pattern: /\bsugar\b/, label: 'Sugar' },
  { pattern: /\bsalt\b/, label: 'Salt' },
  { pattern: /\bonion\b|\bpyaz\b/, label: 'Onion' },
  { pattern: /\bgarlic\b|\blehsun\b/, label: 'Garlic' },
  { pattern: /\btomato\b/, label: 'Tomato' },
  { pattern: /\bpotato\b|\baloo\b/, label: 'Potato' },
  { pattern: /\bcarrot\b/, label: 'Carrot' },
  { pattern: /\blemon\b|\bnimbu\b/, label: 'Lemon' },
  { pattern: /\btomato\b|\btomatoes\b/, label: 'Tomato' },
  { pattern: /\bonion\b|\bpyaz\b/, label: 'Onion' },
  { pattern: /\bginger\b|\badrak\b/, label: 'Ginger' },
  { pattern: /\bgreen\s+chilli\b|\bhari\s+mirch\b/, label: 'Green Chilli' },
  { pattern: /\bbutter\b/, label: 'Butter' },
  { pattern: /\bcream\b/, label: 'Cream' },
  { pattern: /\bcheese\b/, label: 'Cheese' },
  { pattern: /\byoghurt\b|\bcurd\b|\bdahi\b/, label: 'Curd' },
  { pattern: /\bnoodles\b|\bpasta\b/, label: 'Noodles' },
  { pattern: /\bbread\s*crumb\b/, label: 'Breadcrumbs' },
  { pattern: /\bmushroom\b/, label: 'Mushroom' },
  { pattern: /\bspinach\b|\bpalak\b/, label: 'Spinach' },
];

// Maps to 'misc' (Fixed Cost catch-all) with metadata label
const FIXED_COST_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /pest\s*control/, label: 'Pest Control' },
  { pattern: /fumigation/, label: 'Fumigation' },
  { pattern: /\buniform\b|\bapron\b/, label: 'Uniform' },
  { pattern: /\bfuel\b|\bpetrol\b|\bdiesel\b/, label: 'Vehicle Fuel' },
  { pattern: /\bvehicle\b/, label: 'Vehicle' },
  { pattern: /\binsurance\b/, label: 'Insurance' },
  { pattern: /\blicen[sc]e\b/, label: 'License' },
  { pattern: /subscription/, label: 'Subscription' },
  { pattern: /\bcleaning\b/, label: 'Cleaning' },
  { pattern: /\blaundry\b/, label: 'Laundry' },
  { pattern: /\bsecurity\b/, label: 'Security' },
  { pattern: /service\s*charge/, label: 'Service Charge' },
  { pattern: /\bca\s*fee\b|\baccountant\b/, label: 'CA Fee' },
  { pattern: /\bphone\s*bill\b|\bmobile\s*bill\b/, label: 'Phone Bill' },
];

// ── Category resolution result ───────────────────────────────────────
interface CategoryResolution {
  pnlColumn: string;            // e.g. 'gas', 'other', 'misc', 'sales'
  label: string;                // display label e.g. 'Gas', 'Zepto', 'Pest Control'
  breakdownLabel?: string;      // set only when pnlColumn is 'other' or 'misc'
  needsClassification: boolean; // true → ask user before saving
  rawCategory: string;          // original word from message for ask-once storage
}

// Resolve a category synchronously from keyword lists
function resolveFromKeywords(lower: string): CategoryResolution | null {
  // 1. Direct named column
  for (const { pattern, column, label } of DIRECT_COLUMN_KEYWORDS) {
    if (pattern.test(lower)) {
      return { pnlColumn: column, label, needsClassification: false, rawCategory: column };
    }
  }
  // 2. Item cost from local market (separate head, not 'other')
  for (const { pattern, label } of ITEM_COST_KEYWORDS) {
    if (pattern.test(lower)) {
      return { pnlColumn: 'local_market', label, breakdownLabel: label, needsClassification: false, rawCategory: label.toLowerCase() };
    }
  }
  // 3. Fixed cost catch-all (misc)
  for (const { pattern, label } of FIXED_COST_KEYWORDS) {
    if (pattern.test(lower)) {
      return { pnlColumn: 'misc', label, breakdownLabel: label, needsClassification: false, rawCategory: label.toLowerCase() };
    }
  }
  return null;
}

// Async: also checks expense_categories table for restaurant-specific mappings
async function resolveExpenseCategory(
  restaurantId: string,
  lower: string,
  rawWord: string  // the unclassified word from the message
): Promise<CategoryResolution> {
  // First try keyword classifier (no DB call)
  const fromKeywords = resolveFromKeywords(lower);
  if (fromKeywords) return fromKeywords;

  // Check if this restaurant has previously classified this word
  const saved = await dataService.getExpenseCategory(restaurantId, rawWord);
  if (saved) {
    const label = saved.displayLabel;
    return {
      pnlColumn: saved.pnlBucket,
      label,
      breakdownLabel: label,
      needsClassification: false,
      rawCategory: rawWord,
    };
  }

  // Unknown — needs ask-once flow
  return {
    pnlColumn: 'other',     // tentative — won't be used until user answers
    label: rawWord.charAt(0).toUpperCase() + rawWord.slice(1),
    needsClassification: true,
    rawCategory: rawWord,
  };
}

// ── Extract category keyword from message for unknown expenses ───────
function extractUnknownCategoryWord(lower: string): string {
  return lower
    .replace(/\b(expense|kharch|kharcha|cost|bill|aaj|today|for|is|was|on|the|a|an)\b/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')[0] || 'expense';
}

// ── Helpers ──────────────────────────────────────────────────────────
function extractSpecificMonth(lower: string): string | null {
  const m = lower.match(
    /\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)(?:\s+(?:20)?(\d{2}))?\b/
  ) || lower.match(
    /(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s*(?:20)?(\d{2})\b/
  );
  if (!m) return null;
  const mon = MONTH_NAME_TO_NUM[m[1].slice(0, 3)];
  if (!mon) return null;
  const yr = m[2] ? (m[2].length === 2 ? 2000 + parseInt(m[2]) : parseInt(m[2])) : new Date().getFullYear();
  return `${yr}-${String(mon).padStart(2, '0')}`;
}

function extractPeriodForSpecific(lower: string): { period: string; month?: string } | null {
  if (/last\s+\d+\s+months?/.test(lower)) return null;
  if (/last\s+month|pichle?\s+mahine?|prev(?:ious)?\s+month/.test(lower)) return { period: 'last_month' };
  const month = extractSpecificMonth(lower);
  if (month) return { period: 'specific_month', month };
  if (/\baaj\b|\btoday\b/.test(lower)) return { period: 'today' };
  return { period: 'mtd' };
}

function extractIngredientFromMessage(lower: string): string | null {
  const cleaned = lower
    .replace(/\b(give|me|monthly|for|last|of|the|3|4|5|6|7|8|9|10|month|months|how|much|did|i|buy|spend|total|daily|week|weekly|what|is|my|are|expense|expenses|in|a|an)\b/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\b(sales|revenue|cogs|expense|cost|kharch|hyperpure|bigbasket|dmart|swiggy|zomato|phonepe|rent|salary|electricity|gas|milk|bread|water|profit|loss|pnl)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned && cleaned.length > 2) return cleaned;
  return null;
}

function buildMonthsArray(nMonths: number): string[] {
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const months: string[] = [];
  for (let i = nMonths - 1; i >= 0; i--) {
    const d = new Date(nowIST.getFullYear(), nowIST.getMonth() - i - 1, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

// Simple sync category detection for fast-path entries (ordinal date, today/aaj)
// Returns pnl column name only — for full resolution (with metadata), use resolveExpenseCategory()
function detectCategory(lower: string): string {
  for (const { pattern, column } of DIRECT_COLUMN_KEYWORDS) {
    if (pattern.test(lower)) return column;
  }
  for (const { pattern } of ITEM_COST_KEYWORDS) {
    if (pattern.test(lower)) return 'local_market';
  }
  for (const { pattern } of FIXED_COST_KEYWORDS) {
    if (pattern.test(lower)) return 'misc';
  }
  if (/expense|kharch/.test(lower)) return 'other';
  return 'sales';
}

// ── Pre-parser fast path ─────────────────────────────────────────────
function preParseIntent(body: string): ParsedIntent | null {
  const lower = body.toLowerCase().trim();

  const ENTRY_KW = /\b(sales|revenue|bika|milk|bread|water|swiggy|zomato|phonepe|hyperpure|bigbasket|dmart|rent|electricity|gas|salary|pg|internet|garbage|repairs|marketing|misc|expense|kharch|cylinder|lpg|packaging|sabzi|zepto|blinkit|pest|uniform|fuel)\b/;

  const explicitAmountMatch = lower.match(/\b(?:is|was|=)\s+(?:rs\.?\s*|₹\s*)?(\d{2,6})\b/);
  let amountInMsg: RegExpMatchArray | null;
  if (explicitAmountMatch) {
    amountInMsg = explicitAmountMatch;
  } else {
    const stripped = lower.replace(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20[23]\d)\b/g,
      '$1'
    );
    amountInMsg = stripped.match(/\b(\d{2,6})\b/);
  }

  // ── 0. ORDINAL DATE ENTRY ──────────────────────────────────────────
  const ordinalDateMatch = lower.match(/(\d{1,2})(?:st|nd|rd|th)\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(20\d{2}))?/i);
  if (ordinalDateMatch && amountInMsg && ENTRY_KW.test(lower)) {
    const day    = parseInt(ordinalDateMatch[1]);
    const monKey = ordinalDateMatch[2].toLowerCase().slice(0, 3);
    const mon    = MONTH_NAME_TO_NUM[monKey];
    const yearStr = ordinalDateMatch[3];
    const year   = yearStr ? parseInt(yearStr) : new Date().getFullYear();
    if (mon) {
      const entryDate = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const amount    = parseInt(amountInMsg[1]);
      return { intent: 'add_entries', entries: [{ category: detectCategory(lower), amount, date: entryDate }] };
    }
  }

  // ── 0b. PLAIN DATE ENTRY (no ordinal suffix) ───────────────────────
  const plainDateMatch = lower.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(20\d{2}))?\b/i);
  if (plainDateMatch && ENTRY_KW.test(lower)) {
    let plainAmount: number | null = null;
    if (explicitAmountMatch) {
      plainAmount = parseInt(explicitAmountMatch[1]);
    } else {
      const withoutDate = lower.replace(plainDateMatch[0], ' ').replace(/\s+/g, ' ').trim();
      const amtMatch = withoutDate.match(/\b(\d{1,6})\b/);
      if (amtMatch) plainAmount = parseInt(amtMatch[1]);
    }
    if (plainAmount !== null && plainAmount >= 10) {
      const day    = parseInt(plainDateMatch[1]);
      const monKey = plainDateMatch[2].toLowerCase().slice(0, 3);
      const mon    = MONTH_NAME_TO_NUM[monKey];
      const yearStr = plainDateMatch[3];
      const year   = yearStr ? parseInt(yearStr) : new Date().getFullYear();
      if (mon && day >= 1 && day <= 31) {
        const entryDate = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return { intent: 'add_entries', entries: [{ category: detectCategory(lower), amount: plainAmount, date: entryDate }] };
      }
    }
  }

  // ── 0c. TODAY/AAJ ENTRY ────────────────────────────────────────────
  const hasTodayKw = /\b(today|aaj)\b/.test(lower);
  const todayAmtMatch = lower.match(/\b(\d{2,6})\b/);
  if (hasTodayKw && todayAmtMatch && ENTRY_KW.test(lower)) {
    const amount = parseInt(todayAmtMatch[1]);
    const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const entryDate = nowIST.toISOString().split('T')[0];
    return { intent: 'add_entries', entries: [{ category: detectCategory(lower), amount, date: entryDate }] };
  }

  // ── 0d. YESTERDAY/KAL ENTRY ────────────────────────────────────────
  // e.g. "Ginger expenses for yesterday is 138", "milk 552 kal"
  const hasYesterdayKw = /\byesterday\b|\bkal\b/.test(lower);
  const yestAmtMatch = lower.replace(/\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/gi, ' ').match(/\b(\d{1,6})\b/);
  if (hasYesterdayKw && yestAmtMatch && ENTRY_KW.test(lower)) {
    const amount = parseInt(yestAmtMatch[1]);
    if (amount >= 1) {
      // FIX: use getUTCDate/setUTCDate so Vercel's non-UTC server timezone
      // doesn't shift the day (e.g. US-East would make "today" = yesterday UTC)
      const nowIST2 = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
      nowIST2.setUTCDate(nowIST2.getUTCDate() - 1);
      const yesterdayIST = nowIST2.toISOString().split('T')[0];
      return { intent: 'add_entries', entries: [{ category: detectCategory(lower), amount, date: yesterdayIST }] };
    }
  }

  const spPeriod: string | undefined =
    /\baaj\b|\btoday\b/.test(lower)     ? undefined :
    /\bkal\b|\byesterday\b/.test(lower) ? 'yesterday' : 'mtd';

  // ── 0e. AVERAGE QUERY ────────────────────────────────────────────
  // e.g. "average daily sales for this month", "ausat sales", "avg milk cost"
  // Must come BEFORE section 1 (trend), since "average daily sales" contains
  // "daily" which would otherwise be caught by the trend/day-wise pattern.
  if (/\baverage\b|\bavg\b|\bauasat\b|\baushat\b/.test(lower)) {
    let avgMetric = 'sales';
    for (const { pattern, column } of DIRECT_COLUMN_KEYWORDS) {
      if (pattern.test(lower) && column !== 'sales') { avgMetric = column; break; }
    }
    if (avgMetric === 'sales' && /expense|cost|cogs|kharch/.test(lower)) avgMetric = 'cogs';

    const specificMonth = extractSpecificMonth(lower);
    if (specificMonth) {
      return { intent: 'query_specific', metric: avgMetric, period: 'specific_month', month: specificMonth, average: true } as any;
    }
    if (/last\s+month|pichle?\s+mahine?/.test(lower)) {
      return { intent: 'query_specific', metric: avgMetric, period: 'last_month', average: true } as any;
    }
    const lastNMatchAvg = lower.match(/(?:last|past)\s+(\d+)\s+days?/);
    if (lastNMatchAvg) {
      return { intent: 'query_specific', metric: avgMetric, period: 'last_n_days', days: parseInt(lastNMatchAvg[1]), average: true } as any;
    }
    // Default: this month / mtd
    return { intent: 'query_specific', metric: avgMetric, period: 'mtd', average: true } as any;
  }

  // ── 1. TREND / LAST N DAYS ─────────────────────────────────────────
  const lastNMatch = lower.match(/(?:last|past)\s+(\d+)\s+days?/);
  if (/\btrend\b|day[\s-]?wise|day\s+by\s+day/.test(lower) || lastNMatch) {
    const days = lastNMatch ? parseInt(lastNMatch[1]) : 7;
    let metric = 'sales';
    for (const { pattern, column } of DIRECT_COLUMN_KEYWORDS) {
      if (pattern.test(lower) && column !== 'sales') { metric = column; break; }
    }
    // Only override to 'cogs' if NO specific column was matched
    // Prevents "milk expense trend" → cogs (should stay milk)
    if (metric === 'sales' && /expense|cost|cogs|kharch/.test(lower)) metric = 'cogs';

    // Detect specific period before defaulting to last_n_days
    const firstNDaysMatch = lower.match(/(?:first|pehle?)\s+(\d+)\s+days?/);
    const lastNOfMatch    = lower.match(/last\s+(\d+)\s+days?\s+(?:of|in)/);
    const specificMonth   = extractSpecificMonth(lower);

    if (firstNDaysMatch) {
      // "first 10 days of April 2026" / "first 7 days of March"
      return { intent: 'query_daily_breakdown', metric,
               period: 'first_n_days_of_month',
               days: parseInt(firstNDaysMatch[1]),
               ...(specificMonth ? { month: specificMonth } : {}) } as any;
    }
    if (lastNOfMatch && specificMonth) {
      // "last 7 days of March 2026"
      return { intent: 'query_daily_breakdown', metric,
               period: 'last_n_days_of_month',
               days: parseInt(lastNOfMatch[1]),
               month: specificMonth } as any;
    }
    if (specificMonth && !lastNMatch) {
      // "entire month of March 2026" / "daily sales for March 2026"
      return { intent: 'query_daily_breakdown', metric,
               period: 'specific_month', month: specificMonth } as any;
    }
    if (/this\s+month|is\s+mahine|mahine\s+ka/.test(lower) && !lastNMatch) {
      return { intent: 'query_daily_breakdown', metric, period: 'this_month' };
    }
    return { intent: 'query_daily_breakdown', metric, period: 'last_n_days', days };
  }

  // ── 2. P&L ────────────────────────────────────────────────────────
  if (/p[&n]l\b|pnl|profit.*loss|loss.*profit|monthly\s+report|hisaab/.test(lower)) {
    const isDetail = /detail|detailed|full|complete|itemwise|poora|breakdown/.test(lower);
    const month = extractSpecificMonth(lower);
    if (isDetail) {
      if (/this\s+month|is\s+mahine|mtd/.test(lower))   return { intent: 'query_pnl_detail', period: 'mtd' };
      if (/\baaj\b|\btoday\b/.test(lower))              return { intent: 'query_pnl_detail', period: 'today' };
      if (/\bkal\b|\byesterday\b/.test(lower))          return { intent: 'query_pnl_detail', period: 'yesterday' };
      if (/last\s+month|pichle?\s+mahine?/.test(lower)) return { intent: 'query_pnl_detail', period: 'last_month' };
      if (month)                                         return { intent: 'query_pnl_detail', period: 'specific_month', month };
      return { intent: 'query_pnl_detail' };
    }
    if (/\baaj\b|\btoday\b/.test(lower))              return { intent: 'query_pnl', period: 'today' };
    if (/\bkal\b|\byesterday\b/.test(lower))          return { intent: 'query_pnl', period: 'yesterday' };
    if (/last\s+month|pichle?\s+mahine?/.test(lower)) return { intent: 'query_pnl', period: 'last_month' };
    if (/this\s+month|is\s+mahine|mtd/.test(lower))  return { intent: 'query_pnl', period: 'mtd' };
    if (month)                                         return { intent: 'query_pnl', period: 'specific_month', month };
    return { intent: 'query_pnl', period: 'mtd' };
  }

  // Guard: comparison queries and multi-month queries must bypass sections 3 & 4
  // "comparison of item cost vs fixed cost for Mar, Apr, May, June" → parser handles it
  const isComparisonQuery = /\bcompar(e|ison|ing)\b|\bversus\b|\bvs\.?\b/.test(lower);
  const monthMatches = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/gi) || [];
  const hasMultipleMonths = monthMatches.length >= 2;

  // ── 3. TOTAL SALES / REVENUE ───────────────────────────────────────
  if (!isComparisonQuery && !hasMultipleMonths &&
      /total\s+sales|\brevenue\b|kitna\s+(?:bika|sales)|(?:sales|revenue)\s+kitna|how\s+much.*(?:sell|sold|sales)|what\s+is.*(?:total\s+)?(?:sales?|revenue)/.test(lower)) {
    if (/last\s+\d+\s+months?/.test(lower)) return null;
    if (/last\s+month|pichle?\s+mahine?/.test(lower)) return { intent: 'query_specific', metric: 'sales', period: 'last_month' };
    const month = extractSpecificMonth(lower);
    if (month) return { intent: 'query_specific', metric: 'sales', period: 'specific_month', month };
    return { intent: 'query_specific', metric: 'sales', period: spPeriod };
  }

  // ── 4. TOTAL EXPENSES ─────────────────────────────────────────────
  // Skip if asking about a SPECIFIC ingredient — so parser handles as query_ingredient.
  // Check 1: known keyword list (butter, zepto, etc.)
  // Check 2: message contains "on [specific item]" — catches "expense on Butter",
  //           "how much did i do on French fries", "spent on Carrot", etc.
  //           Excludes time/general words like "this", "last", "total", "all".
  const hasItemOnPattern = /\bon\s+(?!(?:this|last|that|the|a|an|total|all|everything|my|your|our)\s)\S/.test(lower);
  const hasSpecificIngredient =
    ITEM_COST_KEYWORDS.some(({ pattern }) => pattern.test(lower)) || hasItemOnPattern;

  if (!isComparisonQuery && !hasMultipleMonths && !hasSpecificIngredient &&
      /total\s+(?:expenses?|costs?|spending)|kitna\s+kharch|how\s+much.*(?:expense|cost|spent\s+on|spending)|what\s+(?:are|is).*(?:total\s+)?(?:expenses?|costs?)/.test(lower)) {
    if (/last\s+\d+\s+months?/.test(lower)) return null;
    if (/last\s+month|pichle?\s+mahine?/.test(lower)) return { intent: 'query_specific', metric: 'cogs', period: 'last_month' };
    const month = extractSpecificMonth(lower);
    if (month) return { intent: 'query_specific', metric: 'cogs', period: 'specific_month', month };
    return { intent: 'query_specific', metric: 'cogs', period: 'mtd' };
  }

  // ── 5. UPLOAD HISTORY (before metricMap — bigbasket.*bill matches both) ──
  if (/\b(last|recent|latest)\b.*\b(bill|upload|invoice)\b|\b(bill|upload|invoice)\b.*\b(last|recent|latest)\b|\bwhen.*\b(bill|upload)\b|\buploaded\b/.test(lower)) {
    const vendor = /hyperpure/.test(lower) ? 'hyperpure' :
                   /bigbasket|big\s*basket/.test(lower) ? 'bigbasket' :
                   /\bdmart\b/.test(lower) ? 'dmart' : null;
    return { intent: 'query_upload_history', vendor_filter: vendor, target: 'last' } as any;
  }

  // ── 6. SPECIFIC METRIC QUESTIONS ──────────────────────────────────
  const metricMap: [RegExp, string][] = [
    [/how\s+much.*\bmilk\b|milk.*(?:expense|cost|bill|ka\s+kitna)|what\s+is.*milk/,   'milk'],
    [/how\s+much.*\bbread\b|bread.*(?:expense|cost)/,                                  'bread'],
    [/how\s+much.*\bwater\b|water.*(?:expense|cost)/,                                  'water'],
    [/how\s+much.*hyperpure|hyperpure.*(?:bill|expense|cost|total|ka\s+kitna)/,        'hyperpure'],
    [/how\s+much.*bigbasket|bigbasket.*(?:bill|expense|cost|total)/,                   'bigbasket'],
    [/how\s+much.*\bdmart\b|dmart.*(?:bill|expense|cost|total)/,                       'dmart'],
    [/how\s+much.*\brent\b|what\s+is.*rent/,                                           'rent'],
    [/how\s+much.*\bswiggy\b|swiggy.*(?:total|income|revenue)/,                        'swiggy'],
    [/how\s+much.*\bzomato\b|zomato.*(?:total|income|revenue)/,                        'zomato'],
    [/how\s+much.*\bphonepe\b|phonepe.*(?:total|income|revenue)/,                      'phonepe'],
    [/how\s+much.*(?:salary|wages)|salary.*(?:this\s+month|is\s+mahine)/,              'salary'],
    [/how\s+much.*electricity|electricity.*(?:bill|total)/,                             'electricity'],
    [/how\s+much.*\bgas\b|gas.*(?:bill|total)/,                                        'gas'],
  ];
  for (const [pattern, metric] of metricMap) {
    if (pattern.test(lower)) {
      const periodInfo = extractPeriodForSpecific(lower);
      if (periodInfo === null) return null;
      return { intent: 'query_specific', metric, ...periodInfo };
    }
  }

  // ── 7. CATCH-ALL: ENTRY WITH UNRECOGNISED CATEGORY ────────────────
  // e.g. "Food expense for both Chef is 300" — ENTRY_KW has "expense",
  // amount is 300, no date → save as today's unknown entry, ask-once
  // flow handles classification ("Is 'Food' a fixed or item cost?").
  const looksLikeQuestion = /^\s*(how|what|when|where|why|give|show|tell|which)\b|[?？]\s*$/.test(lower);
  const amtInMsg = lower.replace(/\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/gi, ' ').match(/\b(\d{2,6})\b/);
  const clearAmount = amtInMsg ? parseInt(amtInMsg[1]) : null;
  if (!looksLikeQuestion && ENTRY_KW.test(lower) && clearAmount && clearAmount >= 1) {
    const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
    return { intent: 'add_entries', entries: [{ category: 'other', amount: clearAmount, date: todayIST }] } as any;
  }

  return null;
}

// ── Main handler ─────────────────────────────────────────────────────
export async function handleTextMessage(from: string, restaurantId: string, body: string) {
  console.log(`[TextHandler] Processing: "${body}"`);

  try {
    const todayDate = new Date().toISOString().split('T')[0];
    const lower = body.toLowerCase().trim();

    const preOverride = preParseIntent(body);
    let parsed: ParsedIntent;

    if (preOverride) {
      console.log(`[TextHandler] Fast path: intent=${preOverride.intent} metric=${(preOverride as any).metric} period=${(preOverride as any).period}`);
      parsed = preOverride;
    } else {
      parsed = await parser.parseTextMessage(body, todayDate);
      console.log(`[TextHandler] Parsed:`, parsed);

      // Parser returned query_ingredient + last N months → multi-month ingredient
      if (parsed.intent === 'query_ingredient' && /last\s+(\d+)\s+months?/.test(lower)) {
        const nMatch  = lower.match(/last\s+(\d+)\s+months?/);
        const nMonths = nMatch ? parseInt(nMatch[1]) : 3;
        const ingredient = (parsed as any).ingredient || '';
        parsed.intent = 'query_specific' as any;
        (parsed as any).metric = ingredient.toLowerCase();
        (parsed as any).period = 'multi_month';
        (parsed as any).months = buildMonthsArray(nMonths);
      }

      else if (parsed.intent === 'query_freeform' || parsed.intent === 'unknown') {
        const lastNMatch = lower.match(/(?:last|past)\s+(\d+)\s+days?/);

        if (/\btrend\b|\bdaily\b|\bdin\s+ka\b|day[\s-]?wise|day\s+by\s+day/.test(lower) || lastNMatch) {
          const days = lastNMatch ? parseInt(lastNMatch[1]) : 7;
          let metric = 'sales';
          for (const { pattern, column } of DIRECT_COLUMN_KEYWORDS) {
            if (pattern.test(lower) && column !== 'sales') { metric = column; break; }
          }
          if (/expense|cost|cogs|kharch/.test(lower)) metric = 'cogs';
          parsed.intent = 'query_daily_breakdown' as any;
          (parsed as any).metric = metric;
          (parsed as any).period = 'last_n_days';
          (parsed as any).days   = days;
        }

        else if (/p[&n]l\b|pnl|profit.*loss|loss.*profit/.test(lower)) {
          const isDetail = /detail|detailed|full|complete|itemwise|poora|breakdown/.test(lower);
          parsed.intent = (isDetail ? 'query_pnl_detail' : 'query_pnl') as any;
          (parsed as any).period = /this\s+month|is\s+mahine/.test(lower) ? 'mtd' :
                                   /\baaj\b|\btoday\b/.test(lower) ? 'today' :
                                   /\bkal\b|\byesterday\b/.test(lower) ? 'yesterday' : 'mtd';
        }

        else if (/last\s+(\d+)\s+months?/.test(lower)) {
          const nMatch  = lower.match(/last\s+(\d+)\s+months?/);
          const nMonths = nMatch ? parseInt(nMatch[1]) : 3;
          const months  = buildMonthsArray(nMonths);
          let metric = 'sales';
          const kwRes = resolveFromKeywords(lower);
          if (kwRes && kwRes.pnlColumn !== 'other' && kwRes.pnlColumn !== 'misc') {
            metric = kwRes.pnlColumn;
          } else if (/expense|cost|kharch/.test(lower)) {
            const ingredient = extractIngredientFromMessage(lower);
            metric = (ingredient && !PNL_COLUMNS.has(ingredient)) ? ingredient : 'cogs';
          }
          parsed.intent = 'query_specific' as any;
          (parsed as any).metric = metric;
          (parsed as any).period = 'multi_month';
          (parsed as any).months = months;
        }

        else if (/\b(last|recent|latest)\b.*\b(bill|upload|invoice)\b|\buploaded\b/.test(lower)) {
          const vendor = /hyperpure/.test(lower) ? 'hyperpure' :
                         /bigbasket|big\s*basket/.test(lower) ? 'bigbasket' :
                         /\bdmart\b/.test(lower) ? 'dmart' : null;
          parsed.intent = 'query_upload_history' as any;
          (parsed as any).vendor_filter = vendor;
          (parsed as any).target = 'last';
        }
      }
    }

    // ── Route: add_entries ──────────────────────────────────────────
    if (parsed.intent === "add_entries" && parsed.entries && parsed.entries.length > 0) {
      let savedCount = 0;

      for (const entry of parsed.entries) {
        let finalDate: string;
        if (entry.date) {
          finalDate = entry.date;
        } else {
          const entryDate = new Date();
          entryDate.setDate(entryDate.getDate() + (entry.date_offset || 0));
          finalDate = entryDate.toISOString().split('T')[0];
        }

        const rawCategory = (entry.category || '').toLowerCase().trim();

        // FIX: pass full message body as `lower` so keyword classifier can detect
        // ingredients like "eggs", "butter" even when parser returns category='other'
        const resolution = await resolveExpenseCategory(restaurantId, lower, rawCategory);
        const pnlColumn = resolution.pnlColumn;

        // Unknown category → ask user once before saving
        if (resolution.needsClassification) {
          // Extract item name from message (e.g. "Expense for Tea Cup for 15 june 111" → "Tea Cup")
          const extractedLabel = (() => {
            const cleaned = lower
              .replace(/\b(expense|kharch|for|is|on|of|the|a|an|this|month|week|today|aaj|kal)\b/g, ' ')
              .replace(/\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/g, ' ')
              .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
              .replace(/[₹$,]/g, ' ')
              .replace(/\s+/g, ' ').trim();
            if (!cleaned || cleaned.length < 2) return resolution.label || 'this expense';
            return cleaned.split(' ')
              .filter(w => w.length > 0)
              .map(w => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ');
          })();

          await dataService.createPendingConfirmation(
            restaurantId,
            {
              categoryName: resolution.rawCategory,
              displayLabel: extractedLabel,
              amount:       entry.amount || 0,
              date:         finalDate,
            },
            'classify_expense'
          );

          await sendMessage(from,
            `Is '${extractedLabel}' a fixed recurring expense (like rent, salary)\n` +
            `or does it vary based on how much you sell?\n\n` +
            `Reply *1* → Fixed Cost\n` +
            `Reply *2* → Item Cost`
          );
          console.log(`[TextHandler] Asked user to classify: ${extractedLabel}`);
          break; // Only ask one at a time
        }

        // Duplicate check
        const dupCheck = await dataService.checkDuplicateTextEntry(
          restaurantId, pnlColumn, finalDate, entry.amount || 0
        );

        if (dupCheck.isDuplicate || dupCheck.csvExists) {
          const existing    = dupCheck.existingAmount || 0;
          const newAmount   = entry.amount || 0;
          const dateLabel   = formatDate(finalDate);
          const displayName = resolution.label;

          await dataService.createPendingConfirmation(
            restaurantId,
            { category: pnlColumn, date: finalDate, amount: newAmount, existingAmount: existing, type: 'text', breakdownLabel: resolution.breakdownLabel },
            'confirm_text_entry'
          );

          let warnMsg: string;
          if (dupCheck.csvExists) {
            warnMsg = `⚠️ CSV Already Uploaded for This Date\n\nYou uploaded a CSV for ${dateLabel} which already has ₹${existing.toLocaleString('en-IN')} recorded.\n\nAdding ₹${newAmount.toLocaleString('en-IN')} manually will make the total ₹${(existing + newAmount).toLocaleString('en-IN')}.\n\nReply *haan* to add anyway · *nahi* to cancel`;
          } else if (pnlColumn === 'swiggy' || pnlColumn === 'zomato') {
            warnMsg = `⚠️ ${displayName} ₹${existing.toLocaleString('en-IN')} already saved for ${dateLabel}.\n\nIf this is a new settlement, save anyway.\nReply *haan* to add ₹${newAmount.toLocaleString('en-IN')} more · *nahi* to cancel`;
          } else {
            warnMsg = `⚠️ Possible Duplicate Entry\n\n${displayName} ₹${newAmount.toLocaleString('en-IN')} for ${dateLabel}\n\nYou already have ${displayName} ₹${existing.toLocaleString('en-IN')} saved for this date.\nReply *haan* to save anyway · *nahi* to cancel`;
          }
          await sendMessage(from, warnMsg);
          break;
        }

        // Save with metadata label
        await dataService.accumulatePnlEntry(
          restaurantId,
          pnlColumn,
          finalDate,
          entry.amount || 0,
          'whatsapp',
          resolution.breakdownLabel
        );

        const costTypeLabel = resolution.breakdownLabel
          ? (['other', 'local_market'].includes(pnlColumn) ? ' (Item Cost)' : ' (Fixed Cost)')
          : '';

        await sendMessage(from,
          `✅ ${resolution.label} ₹${(entry.amount || 0).toLocaleString('en-IN')} saved for ${formatDate(finalDate)}${costTypeLabel}`
        );
        savedCount++;
      }

      if (savedCount > 1) {
        await sendMessage(from, `✅ ${savedCount} entries saved successfully!`);
      }
    }

    else if (
      ['query_today','query_mtd','query_lastmonth',
       'query_specific','query_pnl','query_pnl_detail','query_items','query_ingredient',
       'query_vendor_breakdown','query_daily_breakdown',
       'query_upload_history'].includes(parsed.intent)
    ) {
      await handlePnlQuery(from, restaurantId, body, parsed);
    }
    else if (parsed.intent === 'correct_entry_replace' || parsed.intent === 'correct_entry_reduce') {
      await handleCorrectEntry(from, restaurantId, parsed);
    }
    else if (parsed.intent === 'query_freeform') {
      await handleFreeformQuery(from, restaurantId, parsed.question || body);
    }
    else {
      await handleFreeformQuery(from, restaurantId, body);
    }

    return true;

  } catch (error) {
    console.error("[TextHandler] Error:", error);
    await sendMessage(from, "Sorry, something went wrong while processing your message.");
    return true;
  }
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata'
  });
}

async function sendMessage(to: string, body: string) {
  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await twilio.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER as string,
    to: `whatsapp:${to}`,
    body,
  });
}
