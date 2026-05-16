import { handlePnlQuery } from './queryHandler';

export async function handleTextMessage(from: string, restaurantId: string, body: string) {
  try {
    // Full P&L Queries
    if (body.includes('aaj') || body.includes('today') || body.includes('p&l')) {
      await handlePnlQuery(from, restaurantId, 'today');
      return;
    }

    if (body.includes('this month') || body.includes('month')) {
      await handlePnlQuery(from, restaurantId, 'month');
      return;
    }

    if (body.includes('kal') || body.includes('yesterday')) {
      await handlePnlQuery(from, restaurantId, 'yesterday');
      return;
    }

    // Default response for other text messages
    await sendMessage(from, "✅ Got it!\nTry:\n• `aaj ka P&L`\n• `this month`\n• `swiggy 4500 aaj`");

  } catch (error) {
    console.error("[TextHandler] Error:", error);
    await sendMessage(from, "Sorry, something went wrong.");
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
