import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Import handlers (as per TRD modular structure)
import { handleTextMessage } from './handlers/textHandler';
import { handleMediaUpload } from './handlers/mediaHandler';
import { handleConfirmation } from './handlers/confirmationHandler';
import { handleDelete } from './handlers/deleteHandler';
import { handleOnboarding } from './handlers/onboardingHandler';
import { isInContext } from './guards/contextGuard';
import { isRateLimited } from './guards/rateLimiter';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  console.log('[Debug] TWILIO_WHATSAPP_NUMBER:', process.env.TWILIO_WHATSAPP_NUMBER);
  let from = '';

  try {
    const formData = await req.formData();
    from = (formData.get('From') as string)?.replace('whatsapp:', '') || '';
    const body = (formData.get('Body') as string || '').trim().toLowerCase();
    const mediaUrl = formData.get('MediaUrl0') as string | null;
    const mediaType = formData.get('MediaContentType0') as string | null;

    if (!from) return NextResponse.json({ error: 'No sender' }, { status: 400 });

    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id, name, is_active')
      .eq('whatsapp_number', from)
      .single();

    // FIX: unregistered number → self-onboarding flow instead of rejection message
    if (!restaurant || restaurantError) {
      // Skip onboarding for media-only messages with no text — ask for a name first
      const rawBody = (formData.get('Body') as string || '').trim();
      await handleOnboarding(from, rawBody);
      console.log(`[Webhook] Onboarding step handled in ${Date.now() - startTime}ms`);
      return NextResponse.json({ success: true });
    }

    if (!restaurant.is_active) {
      await sendMessage(from,
        `Your FinMitra account is currently inactive.\n` +
        `Please contact support to reactivate.`
      );
      return NextResponse.json({ success: true });
    }

    // Guard: rate limit (text-only; media bills always processed)
    if (!mediaUrl && isRateLimited(from)) {
      await sendMessage(from,
        "You've sent a lot of messages in the last hour. Please wait a bit before sending more."
      );
      return NextResponse.json({ success: true });
    }

    // Guard: context filter (text-only; media bills always processed)
    if (!mediaUrl && !isInContext(body)) {
      await sendMessage(from,
        "Hi! I'm FinMitra — your restaurant's finance assistant 🧾\n\n" +
        "I can help you with:\n" +
        "• Saving daily expenses (milk, bread, water)\n" +
        "• Recording sales (PhonePe, Swiggy, Zomato)\n" +
        "• Uploading bills (BigBasket, Hyperpure, DMart)\n" +
        "• P&L summaries and expense queries\n\n" +
        "Try: _aaj ka P&L_ or _today sales 3500_"
      );
      return NextResponse.json({ success: true });
    }

    // 1. Priority: Check for confirmation replies (haan / nahi)
    const confirmationHandled = await handleConfirmation(from, restaurant.id, body);
    if (confirmationHandled) {
      console.log(`[Webhook] Confirmation handled in ${Date.now() - startTime}ms`);
      return NextResponse.json({ success: true });
    }

    // 2. Delete flow ("hata do", "hatao", "delete <category>")
    const DELETE_RE = /hata\s*do|hatao|\bdelete\b/i;
    if (DELETE_RE.test(body)) {
      await handleDelete(from, restaurant.id, body);
      return NextResponse.json({ success: true });
    }

    // 3. Media Upload
    if (mediaUrl) {
      await handleMediaUpload(from, restaurant.id, mediaUrl, mediaType);
      return NextResponse.json({ success: true });
    }

    // 4. Normal Text Message (P&L queries, etc.)
    await handleTextMessage(from, restaurant.id, body);

    console.log(`[Webhook] Processed in ${Date.now() - startTime}ms`);
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Webhook Error:", error);
    if (from) await sendMessage(from, "Sorry, something went wrong.");
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function sendMessage(to: string, body: string) {
  const twilio = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  await twilio.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER as string,
    to: `whatsapp:${to}`,
    body: body,
  });
}
