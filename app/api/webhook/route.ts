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

// ====================== REAL PARSING (P0) ======================
async function handleMediaUpload(from: string, restaurantId: string, mediaUrl: string, mediaType: string | null) {
  await sendMessage(from, "📸 Processing your bill... This may take 10-20 seconds.");

  try {
    // 1. Download from Twilio
    const response = await fetch(mediaUrl);
    const buffer = await response.arrayBuffer();
    const fileExt = mediaType?.includes('pdf') ? 'pdf' : 'jpg';
    const fileName = `${restaurantId}/${Date.now()}.${fileExt}`;

    // 2. Upload to Supabase Storage
    await supabase.storage.from('bills').upload(fileName, buffer, {
      contentType: mediaType || 'image/jpeg',
      upsert: true
    });

    const { data: { publicUrl } } = supabase.storage.from('bills').getPublicUrl(fileName);

    // 3. Try Claude with proper content type
    const content: any[] = [
      { type: "text", text: "This is a supplier bill. Extract: Vendor name, Date, Total Amount, and list main items with amounts. Be detailed." }
    ];

    if (mediaType?.includes('pdf')) {
      content.push({
        type: "document",
        source: { type: "url", url: publicUrl, media_type: "application/pdf" }
      });
    } else {
      content.push({
        type: "image",
        source: { type: "url", url: publicUrl }
      });
    }

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content }]
    });

    const extracted = aiResponse.content?.[0]?.type === 'text' 
      ? aiResponse.content[0].text 
      : "Could not extract data.";

    await sendMessage(from, `✅ Bill Parsed Successfully!\n\n${extracted}\n\nReply *haan* to save this bill or *nahi* to cancel.`);

  } catch (error: any) {
    console.error("Real Parsing Failed:", error.message);
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
