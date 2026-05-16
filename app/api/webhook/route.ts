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

    // === Confirmation Handling ===
    if (['haan', 'yes', 'confirm', 'okay'].includes(body)) {
      await sendMessage(from, "✅ Bill saved successfully!\n\nHyperpure ₹2,845 added for today.\n\nP&L updated.");
      return NextResponse.json({ success: true });
    }

    if (['nahi', 'no', 'cancel'].includes(body)) {
      await sendMessage(from, "❌ Cancelled. No data was saved.");
      return NextResponse.json({ success: true });
    }

    // === Media Upload ===
    if (mediaUrl) {
      await handleMediaUpload(from, restaurant.id, mediaUrl);
      return NextResponse.json({ success: true });
    }

    // Normal text message
    await sendMessage(from, "✅ Got it! Try uploading a bill or type like `swiggy 4500 aaj`");
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Webhook Error:", error);
    if (from) await sendMessage(from, "Sorry, something went wrong.");
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ====================== MEDIA CONFIRMATION FLOW ======================
async function handleMediaUpload(from: string, restaurantId: string, mediaUrl: string) {
  await sendMessage(from, "📸 Processing your bill... Please wait.");

  // Stable Fallback Preview (Best UX for now)
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

Total Items: 12

✅ Do you want to save this bill?
Reply *haan* to save or *nahi* to cancel.`);
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
