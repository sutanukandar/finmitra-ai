import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!   // This should bypass RLS
);

export async function POST(req: NextRequest) {
  let from = '';

  try {
    const formData = await req.formData();
    from = (formData.get('From') as string)?.replace('whatsapp:', '') || '';
    const body = formData.get('Body') as string || '';

    console.log(`[DEBUG] Raw From: ${formData.get('From')}`);
    console.log(`[DEBUG] Cleaned From: ${from}`);

    // Force bypass RLS with service_role
    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .select('*')
      .eq('mobile', from)
      .single();

    console.log(`[DEBUG] Query Result:`, restaurant);
    console.log(`[DEBUG] Query Error:`, error);

    if (!restaurant) {
      await sendMessage(from, `Namaste! 👋\n\nDebug Info:\nSent: ${from}\nStored: +919886962078\n\nStill not found.`);
      return NextResponse.json({ success: true });
    }

    await sendMessage(from, `✅ Hello ${restaurant.name || 'Owner'}!\nFinMitra is connected!\n\nTry: "swiggy 4500 aaj" or "aaj ka P&L"`);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Error:", error);
    if (from) await sendMessage(from, "Technical error occurred.");
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
