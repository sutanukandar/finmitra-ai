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

    const parseResult = await parser.parseMedia(mediaUrl, mediaType);

    if (parseResult.success && parseResult.extracted) {
      const payload = { ...parseResult, mediaUrl };

      const vendor    = parseResult.vendor || '';
      const billDate  = parseResult.date || new Date().toISOString().split('T')[0];
      const billTotal = parseResult.total || 0;
      const itemCount = parseResult.items?.length || 0;

      // ── STEP 1: bill sent twice before confirming (check pending_confirmations) ──
      const pendingDup = await dataService.checkDuplicatePending(
        restaurantId, vendor, billDate, billTotal
      );

      // ── STEP 2: bill already confirmed and saved (check upload_records) ──
      const savedDup = pendingDup.isDuplicate
        ? { isDuplicate: false }
        : await dataService.checkDuplicateBill(restaurantId, vendor, billDate, billTotal);

      const isDuplicate = pendingDup.isDuplicate || savedDup.isDuplicate;

      // Resolve existing-bill info for duplicate message
      const existingAmount = pendingDup.isDuplicate
        ? pendingDup.existingAmount
        : savedDup.existingRecord ? Number(savedDup.existingRecord.amount) : undefined;
      const existingUploadedAt = pendingDup.isDuplicate
        ? pendingDup.existingCreatedAt
        : savedDup.existingRecord?.created_at;

      // ── STEP 3: send ONE combined message (preview + save prompt) ──
      if (isDuplicate && existingAmount !== undefined) {
        const uploadedOn = existingUploadedAt ? formatDateTime(existingUploadedAt) : 'earlier';

        await sendMessage(from,
`⚠️ Possible Duplicate Bill

Vendor : ${vendor}
Date   : ${formatDate(billDate)}
Total  : ₹${billTotal}
Items  : ${itemCount} items extracted

You already have a ${vendor} bill of ₹${existingAmount}
saved on ${formatDate(billDate)} (uploaded ${uploadedOn})

Reply *haan* to save anyway · *nahi* to cancel`
        );

        // Overwrite any stale pending, save with is_duplicate flag
        await dataService.deletePendingConfirmation(restaurantId);
        await dataService.createPendingConfirmation(
          restaurantId, { ...payload, is_duplicate: true }, 'confirm_bill'
        );

      } else {
        await sendMessage(from,
`✅ Bill Parsed Successfully!

Vendor : ${vendor}
Date   : ${formatDate(billDate)}
Total  : ₹${billTotal}${parseResult.delivery_fee ? ` (incl. ₹${parseResult.delivery_fee} delivery)` : ''}
Items  : ${itemCount} items extracted

Reply *haan* to save · *nahi* to cancel`
        );

        await dataService.createPendingConfirmation(
          restaurantId, { ...payload, is_duplicate: false }, 'confirm_bill'
        );
      }

    } else {
      await sendMessage(from, "Sorry, I couldn't read this bill clearly.\nPlease type manually like: `hyperpure 2845`");
    }

  } catch (error) {
    console.error("[MediaHandler] Critical error:", error);
    await sendMessage(from, "Sorry, something went wrong while processing the bill.");
  }
}

function formatDate(isoDate: string): string {
  if (!isoDate) return 'that date';
  return new Date(isoDate).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata'
  });
}

function formatDateTime(isoTs: string): string {
  const d = new Date(isoTs);
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  return `${date}, ${time}`;
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
