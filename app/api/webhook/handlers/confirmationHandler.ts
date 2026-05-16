import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function handleConfirmation(from: string, restaurantId: string, body: string) {
  const isConfirm = ['haan', 'yes', 'confirm', 'okay'].includes(body);
  const isCancel = ['nahi', 'no', 'cancel'].includes(body);

  if (!isConfirm && !isCancel) {
    return false; // Not a confirmation message
  }

  try {
    if (isConfirm) {
      // TODO: In future we will move data from pending_confirmations to pnl_entries
      await sendMessage(from, "✅ Saved successfully!\nBill has been added to your P&L.");
    } else {
      await sendMessage(from, "❌ Cancelled. No data was saved.");
    }

    // Clean up pending confirmation
    await supabase
      .from('pending_confirmations')
      .delete()
      .eq('restaurant_id', restaurantId)
      .eq('action', 'add_entries');

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
