/**
 * classifyExpenseHandler.ts
 *
 * Handles the user's "1" or "2" response to the ask-once classification question:
 *   "Is 'pest control' a fixed recurring expense or variable? Reply 1 → Fixed · 2 → Item Cost"
 *
 * Called from confirmationHandler.ts when pending action = 'classify_expense'
 */

import { dataService } from '../../../../lib/db/dataService';

export async function handleClassifyExpense(
  from: string,
  restaurantId: string,
  body: string,  // "1" or "2"
  payload: {
    categoryName: string;   // raw keyword: "cylinder", "pest control"
    displayLabel: string;   // display: "Gas Cylinder", "Pest Control"
    amount: number;
    date: string;
  }
): Promise<boolean> {
  const trimmed = body.trim();

  // Only handle 1 or 2
  if (trimmed !== '1' && trimmed !== '2') return false;

  const isFixed = trimmed === '1';

  const costType  = isFixed ? 'fixed_cost'  : 'item_cost';
  const pnlBucket = isFixed ? 'misc'         : 'other';

  // Save classification so we never ask again for this restaurant
  await dataService.saveExpenseCategory(
    restaurantId,
    payload.categoryName,
    payload.displayLabel,
    costType,
    pnlBucket
  );

  // Save the pending entry now that we know the bucket
  await dataService.accumulatePnlEntry(
    restaurantId,
    pnlBucket,
    payload.date,
    payload.amount,
    'whatsapp',
    payload.displayLabel
  );

  const typeLabel = isFixed ? 'Fixed Cost' : 'Item Cost';
  const bucketLabel = isFixed ? 'Fixed' : 'Item';

  await sendMessage(from,
    `✅ ${payload.displayLabel} ₹${payload.amount.toLocaleString('en-IN')} saved as ${typeLabel}.\n\n` +
    `I'll remember this — all future "${payload.categoryName}" entries will go to ${bucketLabel} Cost automatically.`
  );

  console.log(`[ClassifyExpenseHandler] Saved: ${payload.categoryName} → ${costType} (${pnlBucket}) for restaurant ${restaurantId}`);
  return true;
}

async function sendMessage(to: string, body: string) {
  const twilio = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  await twilio.messages.create({
    from: 'whatsapp:+14155238886',
    to: `whatsapp:${to}`,
    body,
  });
}
