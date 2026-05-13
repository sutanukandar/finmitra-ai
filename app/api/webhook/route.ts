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
  let from = '';

  try {
    const formData = await req.formData();
    from = (formData.get('From') as string)?.replace('whatsapp:', '') || '';
    const body = formData.get('Body') as string || '';

    console.log(`[DEBUG] Raw From: ${formData.get('From')}`);
    console.log(`[DEBUG] Cleaned mobile: ${from}`);
    console.log(`[DEBUG] Message body: ${body}`);

    if (!from) {
      return NextResponse.json({ error: 'No sender' }, { status: 400 });
    }

    // Lookup restaurant
    const { data: restaurant, error: lookupError } = await supabase
      .from('restaurants')
      .select('id, name, mobile')
      .eq('mobile', from)
      .single();

    console.log(`[DEBUG] Restaurant lookup result:`, restaurant);
    if (lookupError) console.error(`[DEBUG] Lookup error:`, lookupError);

    if (!restaurant) {
      await sendMessage(from, `Namaste! 👋\nYour number (${from}) not found.\nStored: +919886962078\nPlease check exact match.`);
      return NextResponse.json({ success: true });
    }

    // Claude parsing
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      system: `You are FinMitra, a helpful financial assistant for Indian restaurant owners. 
      Respond in natural Hinglish. Be short and friendly.`,
      messages: [{ role: "user", content: body }]
    });

    let reply = "✅ Message received! FinMitra is working.";
    if (message.content?.[0]?.type === 'text') {
      reply = message.content[0].text;
    }

    await sendMessage(from, reply);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Webhook Error:", error);
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
    status: "✅ FinMitra Webhook is running",
    message: "Send WhatsApp message to test"
  });
}
