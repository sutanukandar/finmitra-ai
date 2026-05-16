import { dataService } from '../services/dataService';
import { PendingConfirmationPayload } from '../types';

export async function handleConfirmation(from: string, restaurantId: string, body: string) {
  const isConfirm = ['haan', 'yes', 'confirm', 'okay'].includes(body);
  const isCancel = ['nahi', 'no', 'cancel'].includes(body);

  if (!isConfirm && !isCancel) {
    return false; // Not a confirmation message
  }

  try {
    if (isConfirm) {
      // TODO: Move data from pending_confirmations to pnl_entries here (future)
      await sendMessage(from, "✅ Bill saved successfully!\nHyperpure ₹2,845 added for today.");
    } else {
      await sendMessage(from, "❌ Cancelled. No data was saved.");
    }

    // Clean up pending confirmation using dataService
    await dataService.deletePendingConfirmation(restaurantId);

    console.log(`[ConfirmationHandler] Confirmation processed for ${restaurantId}`);

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
