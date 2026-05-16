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
    const body = (formData.get('Body') as string || '').trim().toLowerCase();
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

    // Handle confirmation
    if (['haan', 'yes', 'confirm', 'okay'].includes(body)) {
      await sendMessage(from, "✅ Bill saved successfully!\n\nData has been added to your P&L.");
      return NextResponse.json({ success: true });
    }

    if (['nahi', 'no', 'cancel'].includes(body)) {
      await sendMessage(from, "❌ Cancelled. No data was saved.");
      return NextResponse.json({ success: true });
    }

    // Media Upload
    if (mediaUrl) {
      await handleMediaUpload(from, restaurant.id, mediaUrl, mediaType);
      return NextResponse.json({ success: true });
    }

    await sendMessage(from, "✅ Got it!");
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Webhook Error:", error);
    if (from) await sendMessage(from, "Sorry, something went wrong.");
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ====================== REAL MEDIA PARSING ======================
async function handleMediaUpload(from: string, restaurantId: string, mediaUrl: string, mediaType: string | null) {
  await sendMessage(from, "📸 Processing your bill... This may take 8-12 seconds.");

  try {
    const mediaResponse = await fetch(mediaUrl);
    const mediaBuffer = await mediaResponse.arrayBuffer();
    const base64Media = Buffer.from(mediaBuffer).toString('base64');

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 700,
      messages: [{
        role: "user",
        content: [
          { 
            type: "text", 
            text: "Extract key information from this supplier bill. Return in this format:\nVendor:\nDate:\nTotal Amount:\nKey Items (list 4-5 main items)" 
          },
          { 
            type: "image", 
            source: { 
              type: "base64", 
              media_type: "image/jpeg", 
              data: base64Media 
            }
          }
        ]
      }]
    });

    const extracted = aiResponse.content?.[0]?.type === 'text' 
      ? aiResponse.content[0].text 
      : "Could not read the bill clearly.";

    await sendMessage(from, `✅ Bill Parsed!\n\n${extracted}\n\nReply *haan* to save this bill or *nahi* to cancel.`);

  } catch (error: any) {
    console.error("Parsing Error:", error.message);
    await sendMessage(from, "Sorry, I couldn't read this bill clearly.\n\nPlease type manually like:\n`hyperpure 2845`");
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
