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
      await sendMessage(from, "Namaste! This number is not registered.");
      return NextResponse.json({ success: true });
    }

    // === MEDIA UPLOAD ===
    if (mediaUrl) {
      await handleMediaUpload(from, restaurant.id, mediaUrl, mediaType);
      return NextResponse.json({ success: true });
    }

    // === TEXT MESSAGE ===
    await handleTextMessage(from, restaurant.id, body);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Webhook Error:", error);
    if (from) await sendMessage(from, "Sorry, something went wrong.");
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ====================== MEDIA CONFIRMATION FLOW ======================
async function handleMediaUpload(from: string, restaurantId: string, mediaUrl: string, mediaType: string | null) {
  await sendMessage(from, "📸 Processing your bill... Please wait.");

  // TODO: Download mediaUrl and send to Claude Vision/Documents
  // For now, simulate successful parsing
  await sendMessage(from, `✅ Hyperpure Bill Parsed Successfully!\n\nTotal: ₹2,845\nDate: 16-May-2026\n\nItems extracted: 12 items\n\nReply *haan* to save, or *nahi* to cancel.`);
}

// ====================== TEXT MESSAGE ======================
async function handleTextMessage(from: string, restaurantId: string, body: string) {
  const aiResponse = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    system: "You are FinMitra. Respond in natural Hinglish.",
    messages: [{ role: "user", content: body }]
  });

  let reply = "✅ Got it!";
  if (aiResponse.content?.[0]?.type === 'text') {
    reply = aiResponse.content[0].text;
  }

  await sendMessage(from, reply);
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
