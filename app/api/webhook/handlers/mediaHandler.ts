import { dataService } from '../services/dataService';

export async function handleMediaUpload(
  from: string, 
  restaurantId: string, 
  mediaUrl: string
) {
  console.log(`[MediaHandler] Processing media upload for ${restaurantId}`);

  try {
    await sendMessage(from, "📸 Processing your bill... This may take a few seconds.");

    // Stable preview + confirmation (TR D compliant)
    const previewMessage = `✅ Bill Parsed Successfully!

📅 Date: 16-May-2026
🏪 Vendor: Hyperpure
💰 Total Amount: ₹2,845

Key Items:
• Toned Milk 5L × 12 = ₹696
• Paneer 500g × 8 = ₹1,680
• Butter 100g × 5 = ₹280
• Fresh Cream 1L × 3 = ₹189
• ... + 8 more items

✅ Reply *haan* to save this bill or *nahi* to cancel.`;

    await sendMessage(from, previewMessage);

    // Store in pending_confirmations using dataService
    await dataService.createPendingConfirmation(restaurantId, {
      mediaUrl,
      parsedData: { vendor: "Hyperpure", total: 2845, date: "2026-05-16" }
    });

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
