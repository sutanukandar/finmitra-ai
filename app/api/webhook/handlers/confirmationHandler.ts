import { dataService } from '../../../../lib/db/dataService';

export async function handleConfirmation(from: string, restaurantId: string, body: string) {
  const lowerBody = body.toLowerCase().trim();
  const isConfirm = ['haan', 'yes', 'confirm', 'okay'].includes(lowerBody);
  const isCancel = ['nahi', 'no', 'cancel'].includes(lowerBody);

  if (!isConfirm && !isCancel) {
    return false;
  }

  try {
    const pending = await dataService.getPendingConfirmation(restaurantId);
    const action  = pending?.action || 'confirm_bill';

    if (isConfirm) {
      if (!pending) {
        await sendMessage(from, "No pending action found. Please resend your bill or entry.");
        return true;
      }

      // ── confirm_text_entry: duplicate text entry — accumulate on top ─────
      if (action === 'confirm_text_entry') {
        const { category, date, amount } = pending.payload || {};
        console.log(`[ConfirmationHandler] Text duplicate override: ${category} ₹${amount} for ${date}`);

        const { newTotal } = await dataService.accumulatePnlEntry(restaurantId, category, date, amount);

        await dataService.writeAuditLog(restaurantId, {
          action:          'duplicate_override',
          date_affected:   date,
          pnl_field:       category,
          amount_reversed: amount,
        });

        await sendMessage(from, `✅ Saved. ${category} for ${formatDate(date)} is now ₹${newTotal}.`);

      // ── confirm_bill: clean or duplicate bill — same save flow ───────────
      } else if (action === 'confirm_bill') {
        const parseResult = pending.payload;

        if (parseResult?.success) {
          const vendorName = (parseResult.vendor || '').toLowerCase().trim();
          const today      = new Date().toISOString().split('T')[0];
          const entryDate  = parseResult.date || today;

          const pnlField =
            vendorName.includes('hyperpure') || vendorName.includes('zomato') ? 'hyperpure'
            : vendorName.includes('bigbasket') || vendorName.includes('big basket') ||
              vendorName.includes('bbnow') || vendorName.includes('bb now') ||
              vendorName.includes('innovative retail') ? 'bigbasket'
            : 'other';

          const deliveryFee = parseResult.delivery_fee || 0;
          const foodTotal   = (parseResult.total || 0) - deliveryFee;

          const uploadRecordId = await dataService.createUploadRecord(restaurantId, {
            date:      entryDate,
            doc_type:  'invoice',
            source:    'whatsapp',
            amount:    parseResult.total || 0,
            pnl_field: pnlField,
            file_url:  parseResult.mediaUrl,
            metadata:  { vendor: parseResult.vendor, delivery_fee: deliveryFee }
          });

          await dataService.saveInvoiceItems(
            restaurantId,
            parseResult.vendor || 'Unknown Vendor',
            entryDate,
            parseResult.items || [],
            uploadRecordId
          );

          const totals: any = {};
          if (pnlField === 'hyperpure')      totals.hyperpure = foodTotal;
          else if (pnlField === 'bigbasket') totals.bigbasket = foodTotal;
          else                               totals.other     = foodTotal;
          if (deliveryFee > 0) totals.other = (totals.other || 0) + deliveryFee;

          await dataService.upsertPnlEntry(restaurantId, { date: entryDate, ...totals });

          if (parseResult.is_duplicate) {
            await dataService.writeAuditLog(restaurantId, {
              action:          'duplicate_override',
              date_affected:   entryDate,
              pnl_field:       pnlField,
              amount_reversed: parseResult.total || 0,
            });
          }

          const itemCount = parseResult.items?.length || 0;
          await sendMessage(from,
`✅ Bill saved!

${parseResult.vendor || 'Bill'} ₹${foodTotal}${deliveryFee > 0 ? ` + ₹${deliveryFee} delivery` : ''} added to ${formatDate(entryDate)} P&L
${itemCount} ${itemCount === 1 ? 'item' : 'items'} saved to purchase history`
          );
        } else {
          await sendMessage(from, "✅ Saved! Your entry has been added to P&L.");
        }

      } else {
        await sendMessage(from, "✅ Done!");
      }

    } else {
      // ── nahi / cancel ────────────────────────────────────────────────────
      if (action === 'confirm_text_entry') {
        await sendMessage(from, "Cancelled. Nothing was saved.");
      } else {
        await sendMessage(from, "Cancelled. Bill was not saved.");
      }
    }

    await dataService.deletePendingConfirmation(restaurantId);
    return true;

  } catch (error) {
    console.error("[ConfirmationHandler] Error:", error);
    await sendMessage(from, "Sorry, something went wrong while saving.");
    return true;
  }
}

function formatDate(isoDate: string): string {
  if (!isoDate) return 'that date';
  return new Date(isoDate).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata'
  });
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
