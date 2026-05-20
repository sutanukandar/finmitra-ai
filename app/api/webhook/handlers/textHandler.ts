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
        const pnlEntry: any = {
          date: todayDate,
          date_offset: entry.date_offset || 0
        };

        // Proper mapping for sales and other categories
        const category = (entry.category || '').toLowerCase();

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
          // Fallback for all other categories
          pnlEntry[category] = entry.amount || 0;
        }

        await dataService.upsertPnlEntry(restaurantId, pnlEntry);
        console.log(`[TextHandler] Saved ${category} = ₹${entry.amount}`);
      }

      await sendMessage(from, `✅ Saved ${parsed.entries.length} entries successfully!`);
    } 
    else if (parsed.intent === "query_today" || parsed.intent === "query_mtd" || parsed.intent === "query_lastmonth") {
      // Query handling will be done in queryHandler.ts
      await sendMessage(from, "Query received. Processing P&L...");
    } 
    else {
      await sendMessage(from, "✅ Got it!\nTry:\n• today sales 3500\n• aaj ka P&L\n• hyperpure 2400");
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
