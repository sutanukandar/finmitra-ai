import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const from = (formData.get('From') as string)?.replace('whatsapp:', '');
    const body = formData.get('Body') as string || '';

    if (!from) return NextResponse.json({ error: 'No sender' }, { status: 400 });

    // Find restaurant
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('id, name')
      .eq('mobile', from)
      .single();

    if (!restaurant) {
      await sendMessage(from, "Namaste! This number is not registered with FinMitra yet.");
      return NextResponse.json({ success: true });
    }

    // Call Claude for intent parsing
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: "You are FinMitra, a helpful financial assistant for Indian restaurant owners. Respond in Hinglish.",
      messages: [{ role: "user", content: `User said: ${body}` }]
    });

    const reply = message.content[0].text || "✅ Message received!";

    await sendMessage(from, reply);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Error:", error);
    await sendMessage(from || '', "Sorry, something went wrong. Please try again.");
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function sendMessage(to: string, body: string) {
  const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await twilio.messages.create({
    from: 'whatsapp:+14155238886',
    to: `whatsapp:${to}`,
    body: body,
  });
}
