import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Handles the very first message from an unregistered WhatsApp number.
 * Single-question onboarding: just ask for the restaurant name, then
 * self-activate immediately (is_active = true).
 *
 * Flow:
 *   1. Unknown number sends ANY message
 *      → bot asks "What's your restaurant's name?"
 *      → pending_confirmations row created with action='onboarding_name'
 *   2. User replies with the name
 *      → INSERT into restaurants (mobile, whatsapp_number, name, is_active=true)
 *      → bot sends welcome + quick-start message
 *      → pending_confirmations row deleted
 *
 * Returns true if the message was handled as part of onboarding
 * (caller should stop processing and return early).
 */
export async function handleOnboarding(from: string, body: string): Promise<boolean> {
  // Check if this number already has a pending onboarding step
  const { data: pending } = await supabase
    .from('pending_confirmations_onboarding')
    .select('*')
    .eq('whatsapp_number', from)
    .maybeSingle();

  // Treat expired pending steps as if none existed — restart onboarding
  const isExpired = !!pending && new Date(pending.expires_at) < new Date();
  if (isExpired) {
    await supabase.from('pending_confirmations_onboarding').delete().eq('whatsapp_number', from);
  }

  if (pending && !isExpired && pending.step === 'awaiting_name') {
    const restaurantName = body.trim();

    if (!restaurantName || restaurantName.length < 2) {
      await sendMessage(from, "Please share your restaurant or outlet's name (e.g. \"Tea Day Munnekollal\").");
      return true;
    }

    // Title-case the name for a clean display
    const cleanName = restaurantName
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');

    // Create the restaurant — self-activated immediately
    const { error: insertError } = await supabase
      .from('restaurants')
      .insert({
        mobile: from,
        whatsapp_number: from,
        name: cleanName,
        is_active: true,
        activated_by: 'self_onboarding',
        activated_at: new Date().toISOString(),
        onboarded_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error('[Onboarding] Insert failed:', insertError);
      await sendMessage(from, "Something went wrong setting up your account. Please try again in a moment.");
      return true;
    }

    // Clear the pending onboarding step
    await supabase
      .from('pending_confirmations_onboarding')
      .delete()
      .eq('whatsapp_number', from);

    await sendMessage(from,
      `✅ Welcome to Hisaab AI, ${cleanName}! 🎉\n\n` +
      `You're all set up. Here's how to get started:\n\n` +
      `📥 *Log today's sales:*\n` +
      `   "Sales 4200"\n\n` +
      `📥 *Log an expense:*\n` +
      `   "Milk 552" or "Gas 850"\n\n` +
      `📄 *Upload a bill:*\n` +
      `   Just send the photo or PDF\n\n` +
      `📊 *Check your P&L:*\n` +
      `   "P&L for this month"\n\n` +
      `Try sending today's sales now!`
    );
    return true;
  }

  // No pending step — this is genuinely the first message from this number.
  // Start the onboarding flow by creating a pending step and asking the question.
  const { error: createPendingError } = await supabase
    .from('pending_confirmations_onboarding')
    .insert({
      whatsapp_number: from,
      step: 'awaiting_name',
    });

  if (createPendingError) {
    console.error('[Onboarding] Failed to create pending step:', createPendingError);
  }

  await sendMessage(from,
    `👋 Welcome to *Hisaab AI*!\n\n` +
    `I'm your restaurant's AI finance assistant — track sales, expenses, and P&L right here on WhatsApp.\n\n` +
    `Let's get you set up. *What's your restaurant or outlet's name?*`
  );
  return true;
}

async function sendMessage(to: string, body: string) {
  const twilio = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  await twilio.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER as string,
    to: `whatsapp:${to}`,
    body,
  });
}
