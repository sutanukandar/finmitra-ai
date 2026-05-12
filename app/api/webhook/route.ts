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
  try {
    const formData = await req.formData();
    const from = (formData.get('From') as string)?.replace('whatsapp:', '');
    const body = formData.get('Body') as string || '';
    const mediaUrl = formData.get('MediaUrl0') as string | null;

    if (!from) {
      return NextResponse.json({ error: 'No sender' }, { status: 400 });
    }

    // Find restaurant
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('id, name')
      .eq('mobile', from)
      .single();

    if (!restaurant) {
      await sendMessage(from, "Namaste! 👋\nThis number is not registered with *FinMitra*. Please ask your founder to activate you.");
      return NextResponse.json({ success: true });
    }

    // Basic response for now (we'll add full Claude parsing next)
    let reply = `✅ Hello from FinMitra!\n\nRestaurant: ${restaurant.name}\nMessage received: "${body}"\n\nMore features (Claude parsing, photo/PDF support) coming very soon.`;

    if (mediaUrl) {
      reply += "\n\n📸 Media received. I'll be able to read photos/PDFs soon!";
    }

    await sendMessage(from, reply);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

async function sendMessage(to: string, body: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_WHATSAPP_NUMBER!;

  const twilio = require('twilio')(accountSid, authToken);

  await twilio.messages.create({
    from: from,
    to: `whatsapp:${to}`,
    body: body,
  });
}
