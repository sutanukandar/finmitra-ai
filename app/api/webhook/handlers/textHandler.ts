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

// Pre-parser fast path: deterministic routing BEFORE calling the Claude API.
// Catches unambiguous patterns with regex — avoids token spend and LLM mis-classification.
function preParseIntent(body: string): ParsedIntent | null {
  const lower = body.toLowerCase().trim();

  // ── 0. ORDINAL DATE ENTRY → add_entries ─────────────────────────────
  // Catches "Sales of 4th June 3245", "milk 3rd May 456", "Expense of 2nd June 1200"
  // Fires ONLY when: financial category + ordinal date + amount all present.
  const ordinalDateMatch = lower.match(/(\d{1,2})(?:st|nd|rd|th)\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(20\d{2}))?/i);
  const amountInMsg = lower.match(/\b(\d{3,6})\b/);

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

  // Period helper for query_specific
  // 'mtd' = this month; undefined = today (falls to else-branch in handler)
  const spPeriod: string | undefined =
    /\baaj\b|\btoday\b/.test(lower) ? undefined : 'mtd';

  // ── 1. TREND / LAST N DAYS / DAY-WISE → query_daily_breakdown ──────
  // "daily" alone is intentionally excluded — "daily milk 200" is add_entries.
  const lastNMatch = lower.match(/(?:last|past)\s+(\d+)\s+days?/);
  if (/\btrend\b|day[\s-]?wise|day\s+by\s+day/.test(lower) || lastNMatch) {
    const days = lastNMatch ? parseInt(lastNMatch[1]) : 7;
    let metric = 'sales';
    if (/\bmilk\b/.test(lower))                      metric = 'milk';
    else if (/\bbread\b/.test(lower))                metric = 'bread';
    else if (/\bwater\b/.test(lower))                metric = 'water';
    else if (/\bhyperpure\b/.test(lower))            metric = 'hyperpure';
    else if (/bigbasket|big\s*basket/.test(lower))   metric = 'bigbasket';
    else if (/\bdmart\b/.test(lower))                metric = 'dmart';
    else if (/\bswiggy\b/.test(lower))               metric = 'swiggy';
    else if (/\bzomato\b/.test(lower))               metric = 'zomato';
    else if (/\bphonepe\b/.test(lower))              metric = 'phonepe';
    else if (/expense|cost|cogs|kharch/.test(lower)) metric = 'cogs';
    return { intent: 'query_daily_breakdown', metric, period: 'last_n_days', days };
  }

  // ── 2. TOTAL SALES / REVENUE ────────────────────────────────────────
  if (/total\s+sales|kitna\s+(?:bika|sales)|(?:sales|revenue)\s+kitna|how\s+much.*(?:sell|sold|sales)|what\s+is.*(?:total\s+)?(?:sales?|revenue)/.test(lower)) {
    return { intent: 'query_specific', metric: 'sales', period: spPeriod };
  }

  // ── 3. TOTAL EXPENSES / COGS ─────────────────────────────────────────
  if (/total\s+(?:expenses?|costs?|spending)|kitna\s+kharch|how\s+much.*(?:expense|cost|spent\s+on|spending)|what\s+(?:are|is).*(?:total\s+)?(?:expenses?|costs?)/.test(lower)) {
    return { intent: 'query_specific', metric: 'cogs', period: 'mtd' };
  }

  // ── 4. SPECIFIC METRIC QUESTIONS ────────────────────────────────────
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
      return { intent: 'query_specific', metric, period: 'mtd' };
    }
  }

  return null;
}

export async function handleTextMessage(from: string, restaurantId: string, body: string) {
  console.log(`[TextHandler] Processing text message from ${restaurantId}: "${body}"`);

  try {
    const todayDate = new Date().toISOString().split('T')[0];

    // Try pre-parser fast path first (no Claude call)
    const preOverride = preParseIntent(body);
    let parsed: ParsedIntent;

    if (preOverride) {
      console.log(`[TextHandler] Pre-parser fast path: intent=${preOverride.intent} metric=${preOverride.metric} period=${preOverride.period}`);
      parsed = preOverride;
    } else {
      parsed = await parser.parseTextMessage(body, todayDate);
      console.log(`[TextHandler] Parsed intent:`, parsed);

      // Post-parser safety: backup for any trend/daily that slips through pre-parser
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
      }
    }

    if (parsed.intent === "add_entries" && parsed.entries && parsed.entries.length > 0) {
      let savedCount = 0;

      for (const entry of parsed.entries) {
        // Prefer explicit date from parser; fall back to date_offset for relative references
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
          // swiggy, zomato, milk, bread, water, phonepe, rent, etc. map directly
          pnlEntry[category] = entry.amount || 0;
        }

        // Resolve the column name that was actually set
        const pnlColumn = Object.keys(pnlEntry).find(k => k !== 'date') || category;

        // Duplicate check before saving
        const dupCheck = await dataService.checkDuplicateTextEntry(
          restaurantId, pnlColumn, finalDate, entry.amount || 0
        );

        if (dupCheck.isDuplicate || dupCheck.csvExists) {
          console.log(`[TextHandler] Duplicate detected: ${pnlColumn} ₹${entry.amount} on ${finalDate} (csvExists=${dupCheck.csvExists})`);

          const existing     = dupCheck.existingAmount || 0;
          const newAmount    = entry.amount || 0;
          const dateLabel    = formatDate(finalDate);
          const displayName  = pnlColumn.charAt(0).toUpperCase() + pnlColumn.slice(1);

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

          // Stop processing further entries in this message
          break;
        }

        await dataService.accumulatePnlEntry(restaurantId, pnlColumn, finalDate, entry.amount || 0, 'whatsapp');
        console.log(`[TextHandler] Accumulated ${pnlColumn} += ₹${entry.amount} for date ${finalDate}`);
        const displayName = pnlColumn.charAt(0).toUpperCase() + pnlColumn.slice(1);
        await sendMessage(from, `✅ ${displayName} ₹${(entry.amount || 0).toLocaleString('en-IN')} saved for ${formatDate(finalDate)}`);
        savedCount++;
      }

      // Multi-entry success (savedCount > 1 — individual saves already messaged above
      // only for single-entry messages; send a summary if all entries saved cleanly)
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
      // unknown / help — try freeform before giving up
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
