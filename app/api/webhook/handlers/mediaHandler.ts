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

    // Real parsing
    const parseResult = await parser.parseMedia(mediaUrl, mediaType);

    if (parseResult.success && parseResult.extracted) {
      await sendMessage(from, `✅ Bill Parsed Successfully!\n\n${parseResult.extracted}\n\nReply *haan* to save this bill or *nahi* to cancel.`);

      // Make this non-blocking so preview always shows
      try {
        await dataService.createPendingConfirmation(restaurantId, parseResult);
        console.log(`[MediaHandler] Pending confirmation saved successfully`);
      } catch (pendingError) {
        console.error("[MediaHandler] Could not save pending confirmation (non-blocking):", pendingError);
        // Do not break the flow
      }

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
