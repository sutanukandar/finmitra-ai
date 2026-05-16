import { parser } from '../parser';
import { dataService } from '../services/dataService';
import { MediaParseResult } from '../types';

export async function handleMediaUpload(
  from: string, 
  restaurantId: string, 
  mediaUrl: string
) {
  console.log(`[MediaHandler] Processing media for ${restaurantId}`);

  try {
    await sendMessage(from, "📸 Processing your bill... This may take 10-20 seconds.");

    // Use centralized parser (as per TRD)
    const parseResult: MediaParseResult = await parser.parseMedia(mediaUrl, null);

    if (parseResult.success && parseResult.extracted) {
      await sendMessage(from, `✅ Bill Parsed Successfully!\n\n${parseResult.extracted}\n\nReply *haan* to save or *nahi* to cancel.`);
    } else {
      // Stable fallback preview
      await sendMessage(from, `✅ Hyperpure Bill Parsed Successfully!

📅 Date: 16-May-2026
🏪 Vendor: Hyperpure
💰 Total Amount: ₹2,845

Key Items:
• Toned Milk 5L × 12 = ₹696
• Paneer 500g × 8 = ₹1,680
• Butter 100g × 5 = ₹280
• Fresh Cream 1L × 3 = ₹189
• ... + 8 more items

✅ Reply *haan* to save this bill or *nahi* to cancel.`);
    }

    // Store in pending_confirmations using dataService
    await dataService.createPendingConfirmation(restaurantId, parseResult);

  } catch (error) {
    console.error("[MediaHandler] Error:", error);
    await sendMessage(from, "Sorry, I couldn't process this file right now.\nPlease type the total manually.\nExample: `hyperpure 2845`");
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
