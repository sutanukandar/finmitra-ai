import { dataService } from '../../../../lib/db/dataService';
import { handleClassifyExpense } from './classifyExpenseHandler';

export async function handleConfirmation(from: string, restaurantId: string, body: string) {
  const lowerBody = body.toLowerCase().trim();

  try {
    const pending = await dataService.getPendingConfirmation(restaurantId);
    const action  = pending?.action || '';

    // pnl_context is read-only — never a haan/nahi confirmation
    if (action === 'pnl_context') return false;

    // ── classify_expense: user answering 1/2 from ask-once flow ──────────
    // Must be checked BEFORE the haan/nahi block so "1" and "2" are routed
    if (action === 'classify_expense' && /^[12]$/.test(lowerBody)) {
      const handled = await handleClassifyExpense(
        from, restaurantId, lowerBody, pending!.payload
      );
      if (handled) {
        await dataService.deletePendingConfirmation(restaurantId);
        return true;
      }
    }

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

      // ── confirm_delete ────────────────────────────────────────────────
      if (action === 'confirm_delete') {
        const { category, date, amount } = pending.payload || {};
        await dataService.zeroPnlColumn(restaurantId, category, date);
        await dataService.writeAuditLog(restaurantId, {
          action: 'delete', date_affected: date, pnl_field: category, amount_reversed: amount,
        });
        await sendMessage(from,
          `✅ Deleted. ${category} ₹${Number(amount).toLocaleString('en-IN')} for ${formatDate(date)} removed from P&L.`
        );

      // ── confirm_text_entry ────────────────────────────────────────────
      } else if (action === 'confirm_text_entry') {
        const { category, date, amount, breakdownLabel } = pending.payload || {};
        const { newTotal } = await dataService.accumulatePnlEntry(
          restaurantId, category, date, amount, 'whatsapp', breakdownLabel
        );
        await dataService.writeAuditLog(restaurantId, {
          action: 'duplicate_override', date_affected: date, pnl_field: category, amount_reversed: amount,
        });
        await sendMessage(from, `✅ Saved. ${category} for ${formatDate(date)} is now ₹${newTotal}.`);

      // ── confirm_bill ──────────────────────────────────────────────────
      } else if (action === 'confirm_bill') {
        const parseResult = pending.payload;

        if (parseResult?.success) {
          const vendorName = (parseResult.vendor || '').toLowerCase().trim();
          const today      = new Date().toISOString().split('T')[0];
          const entryDate  = parseResult.date || today;
          const deliveryFee = parseResult.delivery_fee || 0;
          const foodTotal   = (parseResult.total || 0) - deliveryFee;

          const pnlField =
            vendorName.includes('hyperpure') || vendorName.includes('zomato hyperpure') ? 'hyperpure'
            : vendorName.includes('bigbasket') || vendorName.includes('big basket') ||
              vendorName.includes('bbnow') || vendorName.includes('bb now') ||
              vendorName.includes('innovative retail') ? 'bigbasket'
            : vendorName.includes('dmart') || vendorName.includes('d-mart') ||
              vendorName.includes('avenue e-commerce') || vendorName.includes('avenue e commerce') ? 'dmart'
            : 'other';

          // Short display label for metadata breakdown (used when pnlField = 'other')
          const vendorDisplayLabel = getDisplayVendor(parseResult.vendor || 'Other');

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

          // FIX: use accumulatePnlEntry (not upsertPnlEntry) so:
          // 1. Multiple bills on same day stack correctly (no overwrite)
          // 2. Unknown vendor bills write to metadata.other_breakdown for P&L breakdown
          if (pnlField === 'hyperpure') {
            await dataService.accumulatePnlEntry(restaurantId, 'hyperpure', entryDate, foodTotal, 'whatsapp');
          } else if (pnlField === 'bigbasket') {
            await dataService.accumulatePnlEntry(restaurantId, 'bigbasket', entryDate, foodTotal, 'whatsapp');
          } else if (pnlField === 'dmart') {
            await dataService.accumulatePnlEntry(restaurantId, 'dmart', entryDate, foodTotal, 'whatsapp');
          } else {
            // Unknown vendor → 'other' column + write vendor label to metadata breakdown
            await dataService.accumulatePnlEntry(
              restaurantId, 'other', entryDate, foodTotal, 'whatsapp', vendorDisplayLabel
            );
          }

          // Delivery fee always goes to 'other' with its own label
          if (deliveryFee > 0) {
            await dataService.accumulatePnlEntry(
              restaurantId, 'other', entryDate, deliveryFee, 'whatsapp', 'Delivery'
            );
          }

          if (parseResult.is_duplicate) {
            await dataService.writeAuditLog(restaurantId, {
              action: 'duplicate_override', date_affected: entryDate,
              pnl_field: pnlField, amount_reversed: parseResult.total || 0,
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

      // ── confirm_replace ───────────────────────────────────────────────
      } else if (action === 'confirm_replace') {
        const { category, date, old_amount, new_amount } = pending.payload || {};
        await dataService.upsertPnlEntry(restaurantId, { date, [category]: new_amount });
        await dataService.writeAuditLog(restaurantId, {
          action: 'correct_replace', date_affected: date, pnl_field: category, amount_reversed: old_amount,
        });
        const displayCat = (category as string).charAt(0).toUpperCase() + (category as string).slice(1);
        await sendMessage(from,
          `✅ Corrected. ${displayCat} for ${formatDate(date)} updated to ₹${Number(new_amount).toLocaleString('en-IN')}.`
        );

      // ── confirm_reduce ────────────────────────────────────────────────
      } else if (action === 'confirm_reduce') {
        const { category, date, old_amount, new_amount } = pending.payload || {};
        await dataService.upsertPnlEntry(restaurantId, { date, [category]: new_amount });
        await dataService.writeAuditLog(restaurantId, {
          action: 'correct_reduce', date_affected: date, pnl_field: category, amount_reversed: old_amount,
        });
        const displayCat = (category as string).charAt(0).toUpperCase() + (category as string).slice(1);
        await sendMessage(from,
          `✅ Corrected. ${displayCat} for ${formatDate(date)} updated to ₹${Number(new_amount).toLocaleString('en-IN')}.`
        );

      } else {
        await sendMessage(from, "✅ Done!");
      }

    } else {
      // ── nahi / cancel ─────────────────────────────────────────────────
      if (action === 'confirm_delete') {
        await sendMessage(from, "Cancelled. Nothing was deleted.");
      } else if (action === 'confirm_text_entry') {
        await sendMessage(from, "Cancelled. Nothing was saved.");
      } else if (action === 'confirm_replace' || action === 'confirm_reduce') {
        await sendMessage(from, "Cancelled. Nothing was changed.");
      } else if (action === 'classify_expense') {
        await sendMessage(from, "Cancelled. Entry was not saved.");
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

// Convert full legal vendor name to a short display label for the P&L breakdown
function getDisplayVendor(vendor: string): string {
  const v = (vendor || '').toLowerCase();
  if (v.includes('swiggy'))    return 'Swiggy Instamart';
  if (v.includes('zepto'))     return 'Zepto';
  if (v.includes('blinkit') || v.includes('grofers')) return 'Blinkit';
  if (v.includes('dunzo'))     return 'Dunzo';
  if (v.includes('geddit'))    return 'Geddit';
  if (v.includes('jiomart'))   return 'JioMart';
  if (v.includes('amazon'))    return 'Amazon';
  if (v.includes('flipkart'))  return 'Flipkart';
  // Strip common legal suffixes and capitalise first word
  const cleaned = vendor
    .replace(/\s+(private limited|pvt\.?\s*ltd\.?|limited|ltd\.?|llp|inc\.?|corp\.?)\s*$/i, '')
    .trim();
  // Return first two words max
  return cleaned.split(/\s+/).slice(0, 2).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
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
    from: process.env.TWILIO_WHATSAPP_NUMBER as string,
    to:   `whatsapp:${to}`,
    body,
  });
}
