import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Shared, logging-aware WhatsApp sender.
 * Every handler (textHandler, mediaHandler, confirmationHandler,
 * deleteHandler, onboardingHandler, route.ts) should import this instead
 * of defining its own local sendMessage() copy, so every outbound reply
 * is automatically logged to the `messages` table for admin monitoring.
 *
 * restaurantId is optional (onboarding messages happen before a
 * restaurants row exists) — pass it whenever the caller has it.
 */
export async function sendMessage(
  to: string,
  body: string,
  restaurantId: string | null = null,
  errorDetail: string | null = null
) {
  const twilio = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  await twilio.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER as string,
    to: `whatsapp:${to}`,
    body,
  });

  try {
    await supabase.from('messages').insert({
      restaurant_id:   restaurantId,
      whatsapp_number: to,
      direction:       'outbound',
      body:            body || '',
      error:           errorDetail,
    });
  } catch (logErr) {
    console.error('[sendMessage] Failed to log outbound message:', logErr);
  }
}
