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

    if (mediaUrl) {
      await handleMediaUpload(from, restaurant.id, mediaUrl);
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

// ====================== DETAILED REAL PARSING ======================
async function handleMediaUpload(from: string, restaurantId: string, mediaUrl: string) {
  console.log(`[Media] Starting for ${restaurantId}. URL: ${mediaUrl}`);

  await sendMessage(from, "📸 Processing your bill... This may take 10-20 seconds.");

  try {
    // Download
    console.log(`[Media] Downloading file...`);
    const response = await fetch(mediaUrl);
    const buffer = await response.arrayBuffer();
    console.log(`[Media] Downloaded size: ${(buffer.byteLength / 1024).toFixed(1)} KB`);

    // Convert to base64
    const base64Data = Buffer.from(buffer).toString('base64');
    console.log(`[Media] Base64 length: ${base64Data.length} characters`);

    // Send to Claude using base64
    console.log(`[Media] Sending to Claude...`);
    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 700,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "This is a supplier bill. Extract: Vendor, Date, Total Amount, and main items." },
          { 
            type: "image", 
            source: { 
              type: "base64", 
              media_type: "image/jpeg", 
              data: base64Data 
            }
          }
        ]
      }]
    });

    console.log(`[Media] Claude Success!`);

    const extracted = aiResponse.content?.[0]?.type === 'text' 
      ? aiResponse.content[0].text 
      : "Could not extract data.";

    await sendMessage(from, `✅ Bill Parsed!\n\n${extracted}\n\nReply *haan* to save or *nahi* to cancel.`);

  } catch (error: any) {
    console.error("[Media] FAILED:", {
      message: error.message,
      status: error.status,
      fullError: error
    });

    await sendMessage(from, "Sorry, I couldn't read this bill clearly.\n\nPlease type the total manually for now.\nExample: `hyperpure 2845`");
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
