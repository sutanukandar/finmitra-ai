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

    console.log(`[Webhook] 📥 From: ${from} | Body: "${body.substring(0, 80)}${body.length > 80 ? '...' : ''}" | Media: ${mediaType || 'None'}`);

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
      await sendMessage(from, "Namaste! 👋\n\nThis number is not registered with FinMitra yet.\nPlease contact your founder to activate.");
      return NextResponse.json({ success: true });
    }

    // === Media Upload Handling ===
    if (mediaUrl) {
      await sendMessage(from, `📸 ${mediaType?.includes('pdf') ? 'PDF' : 'Photo'} received!\n\nI'll show you the extracted data and ask for confirmation before saving.`);
      // Full media confirmation flow will be added in next phase
      return NextResponse.json({ success: true });
    }

    // === Text Message - Claude Parsing ===
    const systemPrompt = `You are FinMitra, a smart financial assistant for Indian restaurant owners.
Today's date is ${new Date().toISOString().split('T')[0]}.
Respond in natural Hinglish. Be short, friendly and actionable.`;

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
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
    console.error("[Webhook] ❌ Critical Error:", error.message);
    if (from) {
      await sendMessage(from, "Sorry, something went wrong. Please try again.");
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Helper Function
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
    console.error("[sendMessage] Failed:", err);
  }
}

// For testing in browser
export async function GET() {
  return NextResponse.json({ 
    status: "✅ FinMitra Webhook Module is running (Production Ready Foundation)",
    message: "Send WhatsApp messages to test"
  });
}
