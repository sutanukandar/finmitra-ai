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
      for (const entry of parsed.entries) {
        // Calculate actual date from date_offset
        const entryDate = new Date();
        entryDate.setDate(entryDate.getDate() + (entry.date_offset || 0));
        const finalDate = entryDate.toISOString().split('T')[0];

        const category = (entry.category || '').toLowerCase().trim();

        const pnlEntry: any = {
          date: finalDate
        };

        // Proper mapping
        if (category === 'sales' || category === 'revenue' || category.includes('bika')) {
          pnlEntry.sales = entry.amount || 0;
        } 
        else if (category === 'hyperpure' || category.includes('zomato')) {
          pnlEntry.hyperpure = entry.amount || 0;
        } 
        else if (category === 'bigbasket' || category.includes('big basket') || category.includes('bbnow')) {
          pnlEntry.bigbasket = entry.amount || 0;
        } 
        else {
          // All other categories go to their respective column (or fixed as fallback)
          pnlEntry[category] = entry.amount || 0;
        }

        await dataService.upsertPnlEntry(restaurantId, pnlEntry);
        console.log(`[TextHandler] Saved ${category} = ₹${entry.amount} for date ${finalDate}`);
      }

      await sendMessage(from, `✅ Saved ${parsed.entries.length} entries successfully!`);
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
