import { parser } from '../parser';
import { dataService } from '../../../../lib/db/dataService';
import { ParsedIntent } from '../types';

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

        if (dupCheck.isDuplicate) {
          console.log(`[TextHandler] Duplicate detected: ${pnlColumn} ₹${entry.amount} on ${finalDate}`);

          await dataService.createPendingConfirmation(
            restaurantId,
            { category: pnlColumn, date: finalDate, amount: entry.amount || 0, type: 'text', pnlEntry },
            'duplicate_text_check'
          );

          const dateLabel = formatDate(finalDate);
          const timeLabel = formatTime(dupCheck.enteredAt);
          const existing  = dupCheck.existingAmount || 0;
          const newAmount = entry.amount || 0;

          await sendMessage(from,
`⚠️ Duplicate entry detected!

${pnlColumn} ₹${newAmount} was already added for ${dateLabel}
Entered at: ${timeLabel}

Do you still want to add this?
Reply *haan* → add ₹${newAmount} again (total will be ₹${existing + newAmount})
Reply *nahi* → cancel`
          );

          // Stop processing further entries in this message
          break;
        }

        await dataService.upsertPnlEntry(restaurantId, pnlEntry);
        console.log(`[TextHandler] Saved ${pnlColumn} = ₹${entry.amount} for date ${finalDate}`);
        savedCount++;
      }

      if (savedCount > 0 && savedCount === parsed.entries.length) {
        await sendMessage(from, `✅ Saved ${savedCount} ${savedCount === 1 ? 'entry' : 'entries'} successfully!`);
      }
    } 
    else if (parsed.intent === "query_today" || parsed.intent === "query_mtd" || parsed.intent === "query_lastmonth") {
      await sendMessage(from, "Query received. Processing P&L...");
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

function formatTime(isoTs?: string): string {
  if (!isoTs) return 'unknown time';
  return new Date(isoTs).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata'
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
