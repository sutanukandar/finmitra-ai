import { dataService } from '../../../../lib/db/dataService';

export async function handleConfirmation(from: string, restaurantId: string, body: string) {
  const lowerBody = body.toLowerCase().trim();

  try {
    // Fetch pending first — needed for delete_pick check before haan/nahi
    const pending = await dataService.getPendingConfirmation(restaurantId);
    const action  = pending?.action || '';

    // pnl_context is read-only context — never a haan/nahi confirmation
    if (action === 'pnl_context') return false;

    // ── delete_pick: numeric selection (1 / 2 / 3) ───────────────────────
    if (action === 'delete_pick' && /^[123]$/.test(lowerBody)) {
      const idx    = parseInt(lowerBody) - 1;
      const option = pending?.payload?.options?.[idx];

      if (!option) {
        await sendMessage(from, 'Please reply 1, 2 or 3.');
        return true;
      }

      await dataService.deletePendingConfirmation(restaurantId);
      await dataService.createPendingConfirmation(restaurantId, {
        category: pending!.payload.category,
        date:     option.date,
        amount:   option.amount,
      }, 'confirm_delete');

      await sendMessage(from,
        `🗑️ *${pending!.payload.category} ₹${Number(option.amount).toLocaleString('en-IN')} for ${formatDate(option.date)}*\n\nConfirm delete? Reply *haan* · *nahi*`
      );
      return true;
    }

    // ── haan / nahi check ────────────────────────────────────────────────
    const isConfirm = ['haan', 'yes', 'confirm', 'okay'].includes(lowerBody);
    const isCancel  = ['nahi', 'no', 'cancel'].includes(lowerBody);

    if (!isConfirm && !isCancel) {
      return false;
    }

    if (isConfirm) {
      if (!pending) {
        await sendMessage(from, "No pending action found. Please resend your bill or entry.");
        return true;
      }

      // ── confirm_delete: zero out the chosen column for that date ─────────
      if (action === 'confirm_delete') {
        const { category, date, amount } = pending.payload || {};
        console.log(`[ConfirmationHandler] Deleting ${category} ₹${amount} for ${date}`);

        await dataService.zeroPnlColumn(restaurantId, category, date);

        await dataService.writeAuditLog(restaurantId, {
          action:          'delete',
          date_affected:   date,
          pnl_field:       category,
          amount_reversed: amount,
        });

        await sendMessage(from,
          `✅ Deleted. ${category} ₹${Number(amount).toLocaleString('en-IN')} for ${formatDate(date)} removed from P&L.`
        );

      // ── confirm_text_entry: duplicate text entry — accumulate on top ─────
      } else if (action === 'confirm_text_entry') {
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

      // ── confirm_replace: SET the column to the new value ───────────────
      } else if (action === 'confirm_replace') {
        const { category, date, old_amount, new_amount } = pending.payload || {};
        console.log(`[ConfirmationHandler] Replacing ${category} ₹${old_amount} → ₹${new_amount} for ${date}`);

        await dataService.upsertPnlEntry(restaurantId, { date, [category]: new_amount });

        await dataService.writeAuditLog(restaurantId, {
          action:          'correct_replace',
          date_affected:   date,
          pnl_field:       category,
          amount_reversed: old_amount,
        });

        const displayCat = (category as string).charAt(0).toUpperCase() + (category as string).slice(1);
        await sendMessage(from,
          `✅ Corrected. ${displayCat} for ${formatDate(date)} updated to ₹${Number(new_amount).toLocaleString('en-IN')}.`
        );

      // ── confirm_reduce: SET the column to the pre-computed lower value ──
      } else if (action === 'confirm_reduce') {
        const { category, date, old_amount, new_amount } = pending.payload || {};
        console.log(`[ConfirmationHandler] Reducing ${category} ₹${old_amount} → ₹${new_amount} for ${date}`);

        await dataService.upsertPnlEntry(restaurantId, { date, [category]: new_amount });

        await dataService.writeAuditLog(restaurantId, {
          action:          'correct_reduce',
          date_affected:   date,
          pnl_field:       category,
          amount_reversed: old_amount,
        });

        const displayCat = (category as string).charAt(0).toUpperCase() + (category as string).slice(1);
        await sendMessage(from,
          `✅ Corrected. ${displayCat} for ${formatDate(date)} updated to ₹${Number(new_amount).toLocaleString('en-IN')}.`
        );

      } else {
        await sendMessage(from, "✅ Done!");
      }

    } else {
      // ── nahi / cancel ────────────────────────────────────────────────────
      if (action === 'confirm_delete') {
        await sendMessage(from, "Cancelled. Nothing was deleted.");
      } else if (action === 'confirm_text_entry') {
        await sendMessage(from, "Cancelled. Nothing was saved.");
      } else if (action === 'confirm_replace' || action === 'confirm_reduce') {
        await sendMessage(from, "Cancelled. Nothing was changed.");
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
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata'
  });
}

async function sendMessage(to: string, body: string) {
  const twilio = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  await twilio.messages.create({
    from: 'whatsapp:+14155238886',
    to:   `whatsapp:${to}`,
    body,
  });
}
