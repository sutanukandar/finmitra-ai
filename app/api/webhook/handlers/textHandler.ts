import { parser } from '../parser';
import { dataService } from '../../../../lib/db/dataService';
import { ParsedIntent } from '../types';
import { handlePnlQuery } from './queryHandler';

export async function handleTextMessage(from: string, restaurantId: string, body: string) {
  console.log(`[TextHandler] Processing text message from ${restaurantId}: "${body}"`);

  try {
    const todayDate = new Date().toISOString().split('T')[0];
    const parsed: ParsedIntent = await parser.parseTextMessage(body, todayDate);

    console.log(`[TextHandler] Parsed intent:`, parsed);

    if (parsed.intent === "add_entries" && parsed.entries && parsed.entries.length > 0) {
      let savedCount = 0;

      for (const entry of parsed.entries) {
        // Calculate actual date from date_offset
        const entryDate = new Date();
        entryDate.setDate(entryDate.getDate() + (entry.date_offset || 0));
        const finalDate = entryDate.toISOString().split('T')[0];

        const category = (entry.category || '').toLowerCase().trim();

        const pnlEntry: any = { date: finalDate };

        if (category === 'sales' || category === 'revenue' || category.includes('bika')) {
          pnlEntry.sales = entry.amount || 0;
        } else if (category === 'hyperpure' || category.includes('zomato')) {
          pnlEntry.hyperpure = entry.amount || 0;
        } else if (category === 'bigbasket' || category.includes('big basket') || category.includes('bbnow')) {
          pnlEntry.bigbasket = entry.amount || 0;
        } else {
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

          const existing  = dupCheck.existingAmount || 0;
          const newAmount = entry.amount || 0;
          const dateLabel = formatDate(finalDate);

          await dataService.createPendingConfirmation(
            restaurantId,
            { category: pnlColumn, date: finalDate, amount: newAmount, existingAmount: existing, type: 'text' },
            'confirm_text_entry'
          );

          const warnMsg = dupCheck.csvExists
            ? `⚠️ CSV Already Uploaded for This Date

You uploaded a PhonePe CSV for ${dateLabel} which already has ₹${existing.toLocaleString('en-IN')} recorded.

Adding ₹${newAmount.toLocaleString('en-IN')} manually will make the total ₹${(existing + newAmount).toLocaleString('en-IN')}.

Only save if this is an additional payment NOT in your CSV.
Reply *haan* to add anyway · *nahi* to cancel`
            : `⚠️ Possible Duplicate Entry

${pnlColumn} ₹${newAmount} for ${dateLabel}

You already have ${pnlColumn} ₹${existing} saved for this date.
Saving again will add ₹${newAmount} more (total = ₹${existing + newAmount})

Reply *haan* to save anyway · *nahi* to cancel`;

          await sendMessage(from, warnMsg);

          // Stop processing further entries in this message
          break;
        }

        await dataService.accumulatePnlEntry(restaurantId, pnlColumn, finalDate, entry.amount || 0);
        console.log(`[TextHandler] Accumulated ${pnlColumn} += ₹${entry.amount} for date ${finalDate}`);
        await sendMessage(from, `✅ ${pnlColumn} ₹${entry.amount || 0} saved for ${formatDate(finalDate)}`);
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
       'query_specific','query_pnl','query_items','query_ingredient',
       'query_vendor_breakdown'].includes(parsed.intent)
    ) {
      await handlePnlQuery(from, restaurantId, body, parsed);
    } 
    else {
      await sendMessage(from, "✅ Got it!\nTry:\n• today sales 3500\n• aaj sales 4200\n• aaj ka P&L");
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
