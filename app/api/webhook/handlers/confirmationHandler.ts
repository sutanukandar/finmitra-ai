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
        const vendorName = (parseResult.vendor || '').toLowerCase().trim();

        console.log(`[ConfirmationHandler] Detected vendor: "${parseResult.vendor}"`);

        const today = new Date().toISOString().split('T')[0];
        const entryDate = parseResult.date || today;

        // Determine pnl_field (needed for upload_records and totals)
        const pnlField =
          vendorName.includes('hyperpure') || vendorName.includes('zomato')
            ? 'hyperpure'
            : vendorName.includes('bigbasket') || vendorName.includes('big basket') ||
              vendorName.includes('bbnow') || vendorName.includes('bb now') ||
              vendorName.includes('innovative retail')
            ? 'bigbasket'
            : 'other';

        const deliveryFee = parseResult.delivery_fee || 0;
        const foodTotal   = (parseResult.total || 0) - deliveryFee;

        // Write audit row to upload_records and get its id
        const uploadRecordId = await dataService.createUploadRecord(restaurantId, {
          date:      entryDate,
          doc_type:  'invoice',
          source:    'whatsapp',
          amount:    parseResult.total || 0,
          pnl_field: pnlField,
          file_url:  parseResult.mediaUrl,
          metadata:  { vendor: parseResult.vendor, delivery_fee: deliveryFee }
        });

        // Save item-level data with upload_record_id FK
        await dataService.saveInvoiceItems(
          restaurantId,
          parseResult.vendor || "Unknown Vendor",
          entryDate,
          parseResult.items || [],
          uploadRecordId
        );

        // Build pnl totals: food total → vendor column, delivery fee → other
        const totals: any = {};
        if (pnlField === 'hyperpure')  totals.hyperpure  = foodTotal;
        else if (pnlField === 'bigbasket') totals.bigbasket = foodTotal;
        else                           totals.other      = foodTotal;

        if (deliveryFee > 0) {
          totals.other = (totals.other || 0) + deliveryFee;
        }

        await dataService.upsertPnlEntry(restaurantId, { date: entryDate, ...totals });

        await sendMessage(from, `✅ Bill saved successfully!\n\n${parseResult.vendor || 'Bill'} (₹${foodTotal}${deliveryFee > 0 ? ` + ₹${deliveryFee} delivery` : ''}) added to P&L and invoice_items.`);
      } else {
        await sendMessage(from, "✅ Bill saved successfully!\n\nYour bill has been added to today's P&L.");
      }

    } else {
      await sendMessage(from, "❌ Cancelled. No data was saved.");
    }

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
