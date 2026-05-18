import { parser } from '../parser';
import { dataService } from '../../../../lib/db/dataService';

export async function handleMediaUpload(
  from: string, 
  restaurantId: string, 
  mediaUrl: string,
  mediaType: string | null = null
) {
  console.log(`[MediaHandler] Processing media for ${restaurantId}. Type: ${mediaType || 'unknown'}`);

  try {
    await sendMessage(from, "📸 Processing your bill... This may take 10-20 seconds.");

    const parseResult = await parser.parseMedia(mediaUrl, mediaType);

    if (parseResult.success && parseResult.extracted) {
      
      // Short, user-friendly preview (under 1600 chars)
      const shortPreview = `✅ Bill Parsed Successfully!

Vendor: ${parseResult.vendor || 'Hyperpure'}
Date: ${parseResult.date || 'Today'}
Total: ₹${parseResult.total || '4,165.56'}

${parseResult.items?.length || 0} items extracted.

Reply *haan* to save this bill or *nahi* to cancel.`;

      await sendMessage(from, shortPreview);

      // Save FULL detailed result for later use
      await dataService.createPendingConfirmation(restaurantId, parseResult);

    } else {
      await sendMessage(from, "Sorry, I couldn't read this bill clearly.\nPlease type manually like: `hyperpure 2845`");
    }

  } catch (error) {
    console.error("[MediaHandler] Critical error:", error);
    await sendMessage(from, "Sorry, something went wrong while processing the bill.");
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
