import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Import handlers (as per TRD modular structure)
import { handleTextMessage } from './handlers/textHandler';
import { handleMediaUpload } from './handlers/mediaHandler';
import { handleConfirmation } from './handlers/confirmationHandler';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let from = '';

  try {
    const formData = await req.formData();
    from = (formData.get('From') as string)?.replace('whatsapp:', '') || '';
    const body = (formData.get('Body') as string || '').trim().toLowerCase();
    const mediaUrl = formData.get('MediaUrl0') as string | null;

    if (!from) return NextResponse.json({ error: 'No sender' }, { status: 400 });

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('id, name')
      .eq('mobile', from)
      .single();

    if (!restaurant) {
      await sendMessage(from, "Namaste! This number is not registered with FinMitra.");
      return NextResponse.json({ success: true });
    }

    // 1. Priority: Check for confirmation replies (haan / nahi)
    const confirmationHandled = await handleConfirmation(from, restaurant.id, body);
    if (confirmationHandled) {
      console.log(`[Webhook] Confirmation handled in ${Date.now() - startTime}ms`);
      return NextResponse.json({ success: true });
    }

    // 2. Media Upload
    if (mediaUrl) {
      await handleMediaUpload(from, restaurant.id, mediaUrl);
      return NextResponse.json({ success: true });
    }

    // 3. Normal Text Message (P&L queries, etc.)
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
    from: 'whatsapp:+14155238886',
    to: `whatsapp:${to}`,
    body: body,
  });
}
