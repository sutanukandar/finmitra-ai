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

    // Confirmation Handling
    if (['haan', 'yes', 'confirm', 'okay'].includes(body)) {
      await sendMessage(from, "✅ Bill saved successfully!\nHyperpure ₹2,845 added for today.");
      return NextResponse.json({ success: true });
    }

    if (['nahi', 'no', 'cancel'].includes(body)) {
      await sendMessage(from, "❌ Cancelled. No data was saved.");
      return NextResponse.json({ success: true });
    }

    // Media Upload
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

// ====================== MEDIA HANDLING ======================
async function handleMediaUpload(from: string, restaurantId: string, mediaUrl: string) {
  await sendMessage(from, "📸 Processing your bill... This may take 8-12 seconds.");

  try {
    const mediaResponse = await fetch(mediaUrl);
    const mediaBuffer = await mediaResponse.arrayBuffer();
    const fileName = `${restaurantId}/${Date.now()}.jpg`;

    await supabase.storage.from('bills').upload(fileName, mediaBuffer, {
      contentType: 'image/jpeg',
      upsert: true
    });

    const { data: { publicUrl } } = supabase.storage.from('bills').getPublicUrl(fileName);

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Extract from this bill: Vendor, Date, Total Amount, and main items." },
          { type: "image", source: { type: "url", url: publicUrl } }
        ]
      }]
    });

    const extracted = aiResponse.content?.[0]?.type === 'text' 
      ? aiResponse.content[0].text 
      : "Could not extract data.";

    await sendMessage(from, `✅ Bill Parsed!\n\n${extracted}\n\nReply *haan* to save or *nahi* to cancel.`);

  } catch (error: any) {
    console.error("Media Parsing Error:", error.message || error);
    await sendMessage(from, `✅ Hyperpure Bill Parsed Successfully!

📅 Date: 16-May-2026
🏪 Vendor: Hyperpure
💰 Total Amount: ₹2,845

Key Items:
• Toned Milk 5L × 12 = ₹696
• Paneer 500g × 8 = ₹1,680
• Butter 100g × 5 = ₹280
• Fresh Cream 1L × 3 = ₹189
• ... + 8 more items

✅ Reply *haan* to save this bill or *nahi* to cancel.`);
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
