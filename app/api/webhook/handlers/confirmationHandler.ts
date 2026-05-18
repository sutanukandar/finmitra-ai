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
      // Get the pending parsed bill (safe handling)
      const pending = await dataService.getPendingConfirmation(restaurantId);

      if (pending && pending.parse_result?.success) {
        const parseResult = pending.parse_result;

        // Save item-level data into invoice_items
        await dataService.saveInvoiceItems(
          restaurantId,
          parseResult.vendor || "Supplier",
          parseResult.date || new Date().toISOString().split('T')[0],
          parseResult.items || []
        );

        await sendMessage(from, `✅ Bill saved successfully!\n\n${parseResult.vendor || 'Bill'} items added to invoice_items table.`);
      } else {
        await sendMessage(from, "✅ Bill saved successfully!\n\nYour bill has been added to today's P&L.");
      }

    } else {
      await sendMessage(from, "❌ Cancelled. No data was saved.");
    }

    // Clean up
    await dataService.deletePendingConfirmation(restaurantId);

    console.log(`[ConfirmationHandler] Processed for ${restaurantId}`);

    return true;

  } catch (error) {
    console.error("[ConfirmationHandler] Error:", error);
    await sendMessage(from, "Sorry, something went wrong while saving the bill.");
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
