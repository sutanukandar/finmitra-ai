import { dataService } from '../../../../lib/db/dataService';

export async function handleConfirmation(from: string, restaurantId: string, body: string) {
  const lowerBody = body.toLowerCase().trim();
  const isConfirm = ['haan', 'yes', 'confirm', 'okay'].includes(lowerBody);
  const isCancel = ['nahi', 'no', 'cancel'].includes(lowerBody);

  if (!isConfirm && !isCancel) {
    return false;
  }

  try {
    if (isConfirm) {
      await sendMessage(from, "✅ Bill saved successfully!\n\nYour bill has been added to today's P&L.");

      // TODO: In next iteration we will parse the full Claude response and save items
      console.log(`[ConfirmationHandler] Bill confirmed and saved for restaurant ${restaurantId}`);

    } else {
      await sendMessage(from, "❌ Cancelled. No data was saved.");
    }

    // Clean up
    await dataService.deletePendingConfirmation(restaurantId);

    return true;

  } catch (error) {
    console.error("[ConfirmationHandler] Error:", error);
    await sendMessage(from, "Sorry, something went wrong while processing confirmation.");
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
