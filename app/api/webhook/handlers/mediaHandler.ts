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

      // ── STEP 1: check pending_confirmations (bill sent twice before confirming) ──
      const pendingDup = await dataService.checkDuplicatePending(
        restaurantId, vendor, billDate, billTotal
      );

      if (pendingDup.isDuplicate) {
        await sendMessage(from,
`⚠️ You already sent this bill a moment ago and haven't confirmed yet.

${vendor} ₹${billTotal} for ${formatDate(billDate)}

Reply *haan* → save it
Reply *nahi* → cancel`
        );
        // Overwrite the stale pending with a fresh duplicate_bill_check
        await dataService.deletePendingConfirmation(restaurantId);
        await dataService.createPendingConfirmation(restaurantId, payload, 'duplicate_bill_check');

      } else {
        // ── STEP 2: check upload_records (bill already confirmed and saved) ──
        const savedDup = await dataService.checkDuplicateBill(
          restaurantId, vendor, billDate, billTotal
        );

        if (savedDup.isDuplicate && savedDup.existingRecord) {
          const ex         = savedDup.existingRecord;
          const uploadedOn = formatDateTime(ex.created_at);

          await sendMessage(from,
`⚠️ Duplicate bill detected!

A ${vendor} bill of ₹${ex.amount} for ${formatDate(billDate)}
was already uploaded on ${uploadedOn}

Do you still want to upload this?
Reply *haan* → upload anyway
Reply *nahi* → cancel`
          );

          await dataService.createPendingConfirmation(restaurantId, payload, 'duplicate_bill_check');

        } else {
          // ── STEP 3: clean bill — normal preview ──
          const shortPreview = `✅ Bill Parsed Successfully!

Vendor: ${vendor || 'Hyperpure'}
Date: ${billDate}
Total: ₹${billTotal}${parseResult.delivery_fee ? ` (incl. ₹${parseResult.delivery_fee} delivery)` : ''}

${parseResult.items?.length || 0} items extracted.

Reply *haan* to save this bill or *nahi* to cancel.`;

          await sendMessage(from, shortPreview);
          await dataService.createPendingConfirmation(restaurantId, payload, 'confirm_bill');
        }
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
    day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata'
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
