import { dataService } from '../../../../lib/db/dataService';
import { ParsedIntent } from '../types';

export async function handleCorrectEntry(
  from: string,
  restaurantId: string,
  parsed: ParsedIntent
) {
  const category = (parsed.category || '').toLowerCase().trim();
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
  const date = parsed.date || today;

  if (!category) {
    await sendMessage(from, "Could not identify which category to correct. Please try again (e.g. 'sales kal 4200 karo').");
    return;
  }

  const currentVal = await dataService.getPnlColumn(restaurantId, category, date);
  const displayCat = category.charAt(0).toUpperCase() + category.slice(1);
  const dateLabel  = formatDate(date);

  if (parsed.intent === 'correct_entry_replace') {
    const newAmount = parsed.new_amount ?? 0;

    if (parsed.new_amount === undefined) {
      await sendMessage(from, "Please mention the new amount. Example: 'sales kal 4200 karo'.");
      return;
    }

    await dataService.createPendingConfirmation(
      restaurantId,
      { category, date, old_amount: currentVal, new_amount: newAmount },
      'confirm_replace'
    );

    await sendMessage(from,
      `📝 *Correction Preview*\n\n` +
      `${displayCat} for ${dateLabel}\n` +
      `Current: ₹${currentVal.toLocaleString('en-IN')}\n` +
      `New: ₹${newAmount.toLocaleString('en-IN')}\n\n` +
      `Reply *haan* to save · *nahi* to cancel`
    );

  } else if (parsed.intent === 'correct_entry_reduce') {
    const reduceBy = parsed.reduce_by ?? 0;

    if (parsed.reduce_by === undefined) {
      await sendMessage(from, "Please mention the amount to reduce by. Example: 'sales se 500 kato'.");
      return;
    }

    const newAmount = Math.max(0, currentVal - reduceBy);

    await dataService.createPendingConfirmation(
      restaurantId,
      { category, date, old_amount: currentVal, reduce_by: reduceBy, new_amount: newAmount },
      'confirm_reduce'
    );

    await sendMessage(from,
      `📝 *Correction Preview*\n\n` +
      `${displayCat} for ${dateLabel}\n` +
      `Current: ₹${currentVal.toLocaleString('en-IN')}\n` +
      `Reduce by: ₹${reduceBy.toLocaleString('en-IN')}\n` +
      `New: ₹${newAmount.toLocaleString('en-IN')}\n\n` +
      `Reply *haan* to save · *nahi* to cancel`
    );
  }
}

function formatDate(isoDate: string): string {
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
