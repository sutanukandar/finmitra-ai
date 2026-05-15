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

// Helper to send WhatsApp message
async function sendMessage(to: string, body: string) {
  try {
    const twilio = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await twilio.messages.create({
      from: 'whatsapp:+14155238886',
      to: `whatsapp:${to}`,
      body: body,
    });
  } catch (err) {
    console.error("[sendMessage] Twilio error:", err);
  }
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let from = '';

  try {
    const formData = await req.formData();
    from = (formData.get('From') as string)?.replace('whatsapp:', '') || '';
    const body = (formData.get('Body') as string) || '';
    const mediaUrl = formData.get('MediaUrl0') as string | null;

    console.log(`[Webhook] 📥 ${from} | "${body.substring(0, 60)}${body.length > 60 ? '...' : ''}"`);

    if (!from) {
      return NextResponse.json({ error: 'No sender' }, { status: 400 });
    }

    // Lookup restaurant
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('id, name')
      .eq('mobile', from)
      .single();

    if (!restaurant) {
      await sendMessage(from, "Namaste! 👋 This number is not registered with FinMitra yet.");
      return NextResponse.json({ success: true });
    }

    // TODO: Media handling with confirmation (Phase 5)
    if (mediaUrl) {
      await sendMessage(from, "📸 Media received!\n\nFull bill parsing with confirmation flow coming soon.");
      return NextResponse.json({ success: true });
    }

    // Claude NLP Parsing
    const systemPrompt = `You are FinMitra, a helpful AI CFO for Indian restaurant owners.
Today's date: ${new Date().toISOString().split('T')[0]}.
Respond in natural Hinglish. Be short, friendly and actionable.`;

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: "user", content: body }]
    });

    let reply = "✅ Got it!";

    if (aiResponse.content?.[0]?.type === 'text') {
      reply = aiResponse.content[0].text;
    }

    await sendMessage(from, reply);

    console.log(`[Webhook] ✅ Completed in ${Date.now() - startTime}ms for ${restaurant.name}`);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("[Webhook] ❌ Error:", error.message);

    if (from) {
      await sendMessage(from, "Sorry, something went wrong internally. Please try again.");
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// For browser testing
export async function GET() {
  return NextResponse.json({ 
    status: "✅ FinMitra Webhook Module (Phase 7 Optimized) is running",
    message: "Ready for WhatsApp messages"
  });
}
