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

      // Duplicate bill check before showing preview
      const dupCheck = await dataService.checkDuplicateBill(
        restaurantId,
        parseResult.vendor || '',
        parseResult.date || new Date().toISOString().split('T')[0],
        parseResult.total || 0
      );

      if (dupCheck.isDuplicate && dupCheck.existingRecord) {
        const ex = dupCheck.existingRecord;
        const billDate  = formatDate(parseResult.date || '');
        const uploadedOn = formatDateTime(ex.created_at);

        await sendMessage(from,
`⚠️ Duplicate bill detected!

A ${parseResult.vendor} bill of ₹${ex.amount} for ${billDate}
was already uploaded on ${uploadedOn}

Do you still want to upload this?
Reply *haan* → upload anyway
Reply *nahi* → cancel`
        );

        await dataService.createPendingConfirmation(restaurantId, payload, 'duplicate_bill_check');

      } else {
        // Clean bill — normal preview flow
        const shortPreview = `✅ Bill Parsed Successfully!

Vendor: ${parseResult.vendor || 'Hyperpure'}
Date: ${parseResult.date || 'Today'}
Total: ₹${parseResult.total || 0}${parseResult.delivery_fee ? ` (incl. ₹${parseResult.delivery_fee} delivery)` : ''}

${parseResult.items?.length || 0} items extracted.

Reply *haan* to save this bill or *nahi* to cancel.`;

        await sendMessage(from, shortPreview);
        await dataService.createPendingConfirmation(restaurantId, payload, 'confirm_bill');
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
