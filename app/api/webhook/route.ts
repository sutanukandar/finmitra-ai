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

    console.log(`[Webhook] 📥 From: ${from} | Body: ${body.substring(0, 100)}... | Media: ${mediaType || 'None'}`);

    if (!from) {
      return NextResponse.json({ error: 'No sender' }, { status: 400 });
    }

    // Lookup restaurant
    const { data: restaurant, error: lookupError } = await supabase
      .from('restaurants')
      .select('id, name, mobile, preferred_language')
      .eq('mobile', from)
      .single();

    if (lookupError) console.error("[Webhook] Lookup error:", lookupError);

    if (!restaurant) {
      await sendMessage(from, "Namaste! 👋\n\nThis number is not registered with FinMitra yet.\nPlease ask your founder to activate you.");
      return NextResponse.json({ success: true });
    }

    console.log(`[Webhook] ✅ Restaurant: ${restaurant.name} | Lang: ${restaurant.preferred_language || 'Hinglish'}`);

    // Basic Claude response for now
    const systemPrompt = `You are FinMitra, a helpful financial assistant for Indian restaurant owners. Respond in natural Hinglish. Be short and friendly.`;

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: "user", content: body }]
    });

    let reply = "✅ Got it!";
    if (aiResponse.content?.[0]?.type === 'text') {
      reply = aiResponse.content[0].text;
    }

    if (mediaUrl) {
      reply = "📸 Media received! Full bill parsing with confirmation coming soon.";
    }

    await sendMessage(from, reply);

    console.log(`[Webhook] ✅ Processed in ${Date.now() - startTime}ms`);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("[Webhook] ❌ Error:", error);
    if (from) {
      await sendMessage(from, "Sorry, something went wrong. Please try again.");
    }
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

// For browser testing
export async function GET() {
  return NextResponse.json({ 
    status: "✅ FinMitra Webhook Module is running",
    message: "Send a WhatsApp message to test"
  });
}
