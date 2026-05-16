import { parser } from '../parser';
import { dataService } from '../../../../lib/db/dataService';
import { ParsedIntent } from '../types';

export async function handleTextMessage(from: string, restaurantId: string, body: string) {
  try {
    const todayDate = new Date().toISOString().split('T')[0];

    // Use centralized parser (as per TRD)
    const parsed: ParsedIntent = await parser.parseTextMessage(body, todayDate);

    if (parsed.intent === "add_entries" && parsed.entries) {
      for (const entry of parsed.entries) {
        const fieldMap: any = {
          swiggy: 'swiggy',
          phonepe: 'phonepe',
          hyperpure: 'hyperpure',
          bigbasket: 'bigbasket',
          milk: 'milk',
          bread: 'bread',
          rent: 'rent',
          electricity: 'electricity',
          gas: 'gas',
          salary: 'salary',
          fixed: 'fixed'
        };

        const field = fieldMap[entry.category] || 'fixed';

        await dataService.upsertPnlEntry(restaurantId, todayDate, {
          [field]: entry.amount || 0
        });
      }

      await sendMessage(from, `✅ Saved ${parsed.entries.length} entries successfully!`);
    } 
    else if (parsed.intent === "query_today" || parsed.intent === "query_mtd") {
      await import('./queryHandler').then(m => m.handlePnlQuery(from, restaurantId, body));
    } 
    else {
      await sendMessage(from, "✅ Got it!\nTry:\n• `aaj ka P&L`\n• `this month`\n• `swiggy 4500 aaj`");
    }

  } catch (error) {
    console.error("[TextHandler] Error:", error);
    await sendMessage(from, "Sorry, something went wrong.");
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
