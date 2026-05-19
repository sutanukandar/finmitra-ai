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
      const pending = await dataService.getPendingConfirmation(restaurantId);

      if (pending && pending.payload?.success) {
        const parseResult = pending.payload;

        // 1. Save item-level data
        await dataService.saveInvoiceItems(
          restaurantId,
          parseResult.vendor || "Supplier",
          parseResult.date || new Date().toISOString().split('T')[0],
          parseResult.items || []
        );

        // 2. Save aggregated total to pnl_entries (complete flow)
        const totalAmount = parseResult.total || 0;
        await dataService.upsertPnlEntry(restaurantId, {
          date: parseResult.date || new Date().toISOString().split('T')[0],
          hyperpure: totalAmount,   // or map dynamically later
          // Add other categories if needed
        });

        await sendMessage(from, `✅ Bill saved successfully!\n\n${parseResult.vendor || 'Bill'} (₹${totalAmount}) added to P&L and invoice_items.`);
      } else {
        await sendMessage(from, "✅ Bill saved successfully!\n\nYour bill has been added to today's P&L.");
      }

    } else {
      await sendMessage(from, "❌ Cancelled. No data was saved.");
    }

    // Clean up
    await dataService.deletePendingConfirmation(restaurantId);

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
