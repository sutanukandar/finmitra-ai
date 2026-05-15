import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let from = '';

  try {
    const formData = await req.formData();
    from = (formData.get('From') as string)?.replace('whatsapp:', '') || '';
    const body = (formData.get('Body') as string) || '';
    const mediaUrl = formData.get('MediaUrl0') as string | null;
    const mediaType = formData.get('MediaContentType0') as string | null;

    if (!from) return NextResponse.json({ error: 'No sender' }, { status: 400 });

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('id, name')
      .eq('mobile', from)
      .single();

    if (!restaurant) {
      await sendMessage(from, "Namaste! 👋 This number is not registered with FinMitra yet.");
      return NextResponse.json({ success: true });
    }

    // === MEDIA UPLOAD DETECTED ===
    if (mediaUrl) {
      await handleMediaUpload(from, restaurant.id, mediaUrl, mediaType, body);
      return NextResponse.json({ success: true });
    }

    // === TEXT MESSAGE ===
    await handleTextMessage(from, restaurant.id, body);

    console.log(`[Webhook] Processed in ${Date.now() - startTime}ms`);
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("[Webhook] Error:", error);
    if (from) await sendMessage(from, "Sorry, something went wrong. Please try again.");
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ====================== MEDIA CONFIRMATION FLOW ======================
async function handleMediaUpload(from: string, restaurantId: string, mediaUrl: string, mediaType: string | null, body: string) {
  await sendMessage(from, "📸 Processing your media... Please wait.");

  // TODO: Add actual parsing logic (Claude Vision / Documents / Whisper) in next step
  // For now, simulate confirmation flow
  await sendMessage(from, `✅ Media received!\n\nI have processed your upload.\n\nReply *haan* to save it, or *nahi* to cancel.`);
  
  // Store in pending_confirmations (placeholder)
  await supabase.from('pending_confirmations').insert({
    restaurant_id: restaurantId,
    action: 'add_entries',
    payload: { mediaUrl, mediaType, body },
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes TTL
  });
}

// ====================== TEXT MESSAGE HANDLER ======================
async function handleTextMessage(from: string, restaurantId: string, body: string) {
  const aiResponse = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    system: `You are FinMitra. Respond in natural Hinglish.`,
    messages: [{ role: "user", content: body }]
  });

  let reply = "✅ Got it!";
  if (aiResponse.content?.[0]?.type === 'text') {
    reply = aiResponse.content[0].text;
  }

  await sendMessage(from, reply);
}

// Helper
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
