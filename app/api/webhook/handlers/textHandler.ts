import { parser } from '../parser';
import { dataService } from '../../../../lib/db/dataService';
import { ParsedIntent } from '../types';
import { handlePnlQuery } from './queryHandler';
import { handleFreeformQuery } from './queryFreeformHandler';
import { handleCorrectEntry } from './correctEntryHandler';

const MONTH_NAME_TO_NUM: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

// Helper: extract specific month from message → "YYYY-MM" or null
function extractSpecificMonth(lower: string): string | null {
  const m = lower.match(
    /\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)(?:\s+(?:20)?(\d{2}))?\b/
  ) || lower.match(
    /(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s*(?:20)?(\d{2})\b/
  );
  if (!m) return null;
  const monKey = m[1].slice(0, 3);
  const mon = MONTH_NAME_TO_NUM[monKey];
  if (!mon) return null;
  const yr = m[2] ? (m[2].length === 2 ? 2000 + parseInt(m[2]) : parseInt(m[2])) : new Date().getFullYear();
  return `${yr}-${String(mon).padStart(2, '0')}`;
}

// Helper: extract period intent from message for query_specific
// Returns: { period, month? } or null to skip fast path
function extractPeriodForSpecific(lower: string): { period: string; month?: string } | null {
  // "last N months" — let the parser handle multi_month
  if (/last\s+\d+\s+months?/.test(lower)) return null;
  // "last month"
  if (/last\s+month|pichle?\s+mahine?|prev(?:ious)?\s+month/.test(lower)) {
    return { period: 'last_month' };
  }
  // "in May 2026", "for April 2026", "May 2026 ka", etc.
  const month = extractSpecificMonth(lower);
  if (month) return { period: 'specific_month', month };
  // "today" / "aaj"
  if (/\baaj\b|\btoday\b/.test(lower)) return { period: 'today' };
  // Default: MTD
  return { period: 'mtd' };
}

// Pre-parser fast path: deterministic routing BEFORE calling the Claude API.
function preParseIntent(body: string): ParsedIntent | null {
  const lower = body.toLowerCase().trim();

  // ── 0. ORDINAL DATE ENTRY → add_entries ─────────────────────────────
  const ordinalDateMatch = lower.match(/(\d{1,2})(?:st|nd|rd|th)\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(20\d{2}))?/i);

  // Handle "Rs X", "Rs. X", "₹X" prefix + allow 2-digit amounts like ₹40
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

  const ENTRY_KW = /\b(sales|revenue|bika|milk|bread|water|swiggy|zomato|phonepe|hyperpure|bigbasket|dmart|rent|electricity|gas|salary|pg|internet|garbage|repairs|marketing|misc|expense|kharch)\b/;

  if (ordinalDateMatch && amountInMsg && ENTRY_KW.test(lower)) {
    const day    = parseInt(ordinalDateMatch[1]);
    const monKey = ordinalDateMatch[2].toLowerCase().slice(0, 3);
    const mon    = MONTH_NAME_TO_NUM[monKey];
    const yearStr = ordinalDateMatch[3];
    const year   = yearStr ? parseInt(yearStr) : new Date().getFullYear();

    if (mon) {
      const entryDate = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const amount    = parseInt(amountInMsg[1]);

      let category = 'sales';
      if (/\bmilk\b/.test(lower))                    category = 'milk';
      else if (/\bbread\b/.test(lower))              category = 'bread';
      else if (/\bwater\b/.test(lower))              category = 'water';
      else if (/\bhyperpure\b/.test(lower))          category = 'hyperpure';
      else if (/bigbasket|big\s*basket/.test(lower)) category = 'bigbasket';
      else if (/\bdmart\b/.test(lower))              category = 'dmart';
      else if (/\bswiggy\b/.test(lower))             category = 'swiggy';
      else if (/\bzomato\b/.test(lower))             category = 'zomato';
      else if (/\bphonepe\b/.test(lower))            category = 'phonepe';
      else if (/\brent\b/.test(lower))               category = 'rent';
      else if (/\belectricity\b/.test(lower))        category = 'electricity';
      else if (/\bgas\b/.test(lower))                category = 'gas';
      else if (/\bsalary\b/.test(lower))             category = 'salary';
      else if (/expense|kharch/.test(lower))         category = 'other';

      return { intent: 'add_entries', entries: [{ category, amount, date: entryDate }] };
    }
  }

  // Period helper for simple queries (MTD unless today)
  const spPeriod: string | undefined =
    /\baaj\b|\btoday\b/.test(lower) ? undefined : 'mtd';

  // ── 1. TREND / LAST N DAYS / DAY-WISE → query_daily_breakdown ──────
  const lastNMatch = lower.match(/(?:last|past)\s+(\d+)\s+days?/);
  if (/\btrend\b|day[\s-]?wise|day\s+by\s+day/.test(lower) || lastNMatch) {
    const days = lastNMatch ? parseInt(lastNMatch[1]) : 7;
    let metric = 'sales';
    if (/\bmilk\b/.test(lower))                                              metric = 'milk';
    else if (/\bbread\b/.test(lower))                                        metric = 'bread';
    else if (/\bwater\b/.test(lower))                                        metric = 'water';
    else if (/\bhyperpure\b/.test(lower))                                    metric = 'hyperpure';
    else if (/bigbasket|big\s*basket/.test(lower))                           metric = 'bigbasket';
    else if (/\bdmart\b/.test(lower))                                        metric = 'dmart';
    else if (/\bswiggy\b/.test(lower))                                       metric = 'swiggy';
    else if (/\bzomato\b/.test(lower))                                       metric = 'zomato';
    else if (/\bphonepe\b/.test(lower))                                      metric = 'phonepe';
    else if (/total\s+expenses?|cogs\s*\+\s*fixed|total\s+cost/.test(lower)) metric = 'total_expenses';
    else if (/expense|cost|cogs|kharch/.test(lower))                         metric = 'cogs';

    if (/this\s+month|is\s+mahine|mahine\s+ka/.test(lower) && !lastNMatch) {
      return { intent: 'query_daily_breakdown', metric, period: 'this_month' };
    }
    return { intent: 'query_daily_breakdown', metric, period: 'last_n_days', days };
  }

  // ── 2. P&L / PnL QUERIES → query_pnl or query_pnl_detail ───────────
  if (/p[&n]l\b|pnl|profit.*loss|loss.*profit|monthly\s+report|hisaab/.test(lower)) {
    const isDetail = /detail|detailed|full|complete|itemwise|poora|breakdown/.test(lower);
    const month = extractSpecificMonth(lower);

    if (isDetail) {
      if (/this\s+month|is\s+mahine|mtd/.test(lower)) return { intent: 'query_pnl_detail', period: 'mtd' };
      if (/\baaj\b|\btoday\b/.test(lower))            return { intent: 'query_pnl_detail', period: 'today' };
      if (/\bkal\b|\byesterday\b/.test(lower))        return { intent: 'query_pnl_detail', period: 'yesterday' };
      if (month)                                       return { intent: 'query_pnl_detail', period: 'specific_month', month };
      return { intent: 'query_pnl_detail' };
    }

    if (/\baaj\b|\btoday\b/.test(lower))              return { intent: 'query_pnl', period: 'today' };
    if (/\bkal\b|\byesterday\b/.test(lower))          return { intent: 'query_pnl', period: 'yesterday' };
    if (/last\s+month|pichle?\s+mahine?/.test(lower)) return { intent: 'query_pnl', period: 'last_month' };
    if (/this\s+month|is\s+mahine|mtd/.test(lower))  return { intent: 'query_pnl', period: 'mtd' };
    if (month)                                         return { intent: 'query_pnl', period: 'specific_month', month };
    return { intent: 'query_pnl', period: 'mtd' };
  }

  // ── 3. TOTAL SALES / REVENUE ────────────────────────────────────────
  if (/total\s+sales|\brevenue\b|kitna\s+(?:bika|sales)|(?:sales|revenue)\s+kitna|how\s+much.*(?:sell|sold|sales)|what\s+is.*(?:total\s+)?(?:sales?|revenue)/.test(lower)) {
    // "last N months" → let parser handle
    if (/last\s+\d+\s+months?/.test(lower)) return null;
    if (/last\s+month|pichle?\s+mahine?/.test(lower)) return { intent: 'query_specific', metric: 'sales', period: 'last_month' };
    const month = extractSpecificMonth(lower);
    if (month) return { intent: 'query_specific', metric: 'sales', period: 'specific_month', month };
    return { intent: 'query_specific', metric: 'sales', period: spPeriod };
  }

  // ── 4. TOTAL EXPENSES / COGS ─────────────────────────────────────────
  if (/total\s+(?:expenses?|costs?|spending)|kitna\s+kharch|how\s+much.*(?:expense|cost|spent\s+on|spending)|what\s+(?:are|is).*(?:total\s+)?(?:expenses?|costs?)/.test(lower)) {
    if (/last\s+\d+\s+months?/.test(lower)) return null;
    if (/last\s+month|pichle?\s+mahine?/.test(lower)) return { intent: 'query_specific', metric: 'cogs', period: 'last_month' };
    const month = extractSpecificMonth(lower);
    if (month) return { intent: 'query_specific', metric: 'cogs', period: 'specific_month', month };
    return { intent: 'query_specific', metric: 'cogs', period: 'mtd' };
  }

  // ── 5. SPECIFIC METRIC QUESTIONS ────────────────────────────────────
  // FIX v4: Extract period instead of defaulting to MTD or skipping entirely
  // "last N months" → return null (let parser handle multi_month)
  // "last month" → period: last_month
  // "in May 2026" → period: specific_month
  // default → period: mtd
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
  ];
  for (const [pattern, metric] of metricMap) {
    if (pattern.test(lower)) {
      const periodInfo = extractPeriodForSpecific(lower);
      // null means "last N months" — let parser handle
      if (periodInfo === null) return null;
      return { intent: 'query_specific', metric, ...periodInfo };
    }
  }

  return null;
}

export async function handleTextMessage(from: string, restaurantId: string, body: string) {
  console.log(`[TextHandler] Processing text message from ${restaurantId}: "${body}"`);

  try {
    const todayDate = new Date().toISOString().split('T')[0];

    const preOverride = preParseIntent(body);
    let parsed: ParsedIntent;

    if (preOverride) {
      console.log(`[TextHandler] Pre-parser fast path: intent=${preOverride.intent} metric=${(preOverride as any).metric} period=${(preOverride as any).period}`);
      parsed = preOverride;
    } else {
      parsed = await parser.parseTextMessage(body, todayDate);
      console.log(`[TextHandler] Parsed intent:`, parsed);

      if (parsed.intent === 'query_freeform' || parsed.intent === 'unknown') {
        const lower = body.toLowerCase();
        const lastNMatch = lower.match(/(?:last|past)\s+(\d+)\s+days?/);
        const hasTrend   = /\btrend\b/.test(lower);
        const hasDaily   = /\bdaily\b|\bdin\s+ka\b/.test(lower);
        const hasDayWise = /day[\s-]?wise|day\s+by\s+day/.test(lower);

        if (hasTrend || hasDaily || hasDayWise || lastNMatch) {
          const days = lastNMatch ? parseInt(lastNMatch[1]) : 7;
          let metric = 'sales';
          if (/\bmilk\b/.test(lower))                           metric = 'milk';
          else if (/\bbread\b/.test(lower))                     metric = 'bread';
          else if (/\bwater\b/.test(lower))                     metric = 'water';
          else if (/\bhyperpure\b/.test(lower))                 metric = 'hyperpure';
          else if (/bigbasket|big\s+basket/.test(lower))        metric = 'bigbasket';
          else if (/\bdmart\b|d[\s-]mart/.test(lower))          metric = 'dmart';
          else if (/\bswiggy\b/.test(lower))                    metric = 'swiggy';
          else if (/\bzomato\b/.test(lower))                    metric = 'zomato';
          else if (/\bphonepe\b/.test(lower))                   metric = 'phonepe';
          else if (/expense|cost|cogs|kharch/.test(lower))      metric = 'cogs';

          console.log(`[TextHandler] Post-parser safety override → query_daily_breakdown metric=${metric} days=${days}`);
          parsed.intent = 'query_daily_breakdown' as any;
          (parsed as any).metric = metric;
          (parsed as any).period = 'last_n_days';
          (parsed as any).days   = days;
        }

        else if (/p[&n]l\b|pnl|profit.*loss|loss.*profit/.test(lower)) {
          console.log(`[TextHandler] Post-parser P&L safety override → query_pnl`);
          const isDetail = /detail|detailed|full|complete|itemwise|poora|breakdown/.test(lower);
          parsed.intent = (isDetail ? 'query_pnl_detail' : 'query_pnl') as any;
          (parsed as any).period = /this\s+month|is\s+mahine/.test(lower) ? 'mtd' :
                                   /\baaj\b|\btoday\b/.test(lower) ? 'today' :
                                   /\bkal\b|\byesterday\b/.test(lower) ? 'yesterday' : 'mtd';
        }
      }
    }

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

        const category = (entry.category || '').toLowerCase().trim();
        const pnlEntry: any = { date: finalDate };

        if (category === 'sales' || category === 'revenue' || category.includes('bika')) {
          pnlEntry.sales = entry.amount || 0;
        } else if (category === 'hyperpure') {
          pnlEntry.hyperpure = entry.amount || 0;
        } else if (category === 'bigbasket' || category.includes('big basket') || category.includes('bbnow')) {
          pnlEntry.bigbasket = entry.amount || 0;
        } else {
          pnlEntry[category] = entry.amount || 0;
        }

        const pnlColumn = Object.keys(pnlEntry).find(k => k !== 'date') || category;

        const dupCheck = await dataService.checkDuplicateTextEntry(
          restaurantId, pnlColumn, finalDate, entry.amount || 0
        );

        if (dupCheck.isDuplicate || dupCheck.csvExists) {
          console.log(`[TextHandler] Duplicate detected: ${pnlColumn} ₹${entry.amount} on ${finalDate}`);

          const existing    = dupCheck.existingAmount || 0;
          const newAmount   = entry.amount || 0;
          const dateLabel   = formatDate(finalDate);
          const displayName = pnlColumn.charAt(0).toUpperCase() + pnlColumn.slice(1);

          await dataService.createPendingConfirmation(
            restaurantId,
            { category: pnlColumn, date: finalDate, amount: newAmount, existingAmount: existing, type: 'text' },
            'confirm_text_entry'
          );

          let warnMsg: string;
          if (dupCheck.csvExists) {
            warnMsg = `⚠️ CSV Already Uploaded for This Date

You uploaded a PhonePe CSV for ${dateLabel} which already has ₹${existing.toLocaleString('en-IN')} recorded.

Adding ₹${newAmount.toLocaleString('en-IN')} manually will make the total ₹${(existing + newAmount).toLocaleString('en-IN')}.

Only save if this is an additional payment NOT in your CSV.
Reply *haan* to add anyway · *nahi* to cancel`;
          } else if (pnlColumn === 'swiggy' || pnlColumn === 'zomato') {
            warnMsg = `⚠️ ${displayName} ₹${existing.toLocaleString('en-IN')} already saved for ${dateLabel}.

If this is a new settlement covering different orders, save anyway.
Reply *haan* to add ₹${newAmount.toLocaleString('en-IN')} more · *nahi* to cancel`;
          } else {
            warnMsg = `⚠️ Possible Duplicate Entry

${displayName} ₹${newAmount.toLocaleString('en-IN')} for ${dateLabel}

You already have ${displayName} ₹${existing.toLocaleString('en-IN')} saved for this date.
Saving again will add ₹${newAmount.toLocaleString('en-IN')} more (total = ₹${(existing + newAmount).toLocaleString('en-IN')})

Reply *haan* to save anyway · *nahi* to cancel`;
          }

          await sendMessage(from, warnMsg);
          break;
        }

        await dataService.accumulatePnlEntry(restaurantId, pnlColumn, finalDate, entry.amount || 0, 'whatsapp');
        console.log(`[TextHandler] Accumulated ${pnlColumn} += ₹${entry.amount} for date ${finalDate}`);
        const displayName = pnlColumn.charAt(0).toUpperCase() + pnlColumn.slice(1);
        await sendMessage(from, `✅ ${displayName} ₹${(entry.amount || 0).toLocaleString('en-IN')} saved for ${formatDate(finalDate)}`);
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
  const twilio = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  await twilio.messages.create({
    from: 'whatsapp:+14155238886',
    to: `whatsapp:${to}`,
    body: body,
  });
}
