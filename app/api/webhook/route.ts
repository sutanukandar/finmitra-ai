import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    console.log("✅ Webhook received request");

    const formData = await req.formData();
    const from = (formData.get('From') as string)?.replace('whatsapp:', '');
    const body = formData.get('Body') as string || '';

    console.log(`Message from ${from}: ${body}`);

    if (!from) {
      return NextResponse.json({ error: 'No sender' }, { status: 400 });
    }

    const reply = `✅ FinMitra Test Reply!\n\nYou said: "${body}"\n\nThis is working! 🎉\nFull features (Claude parsing, P&L, photo support) coming soon.`;

    // Send reply using Twilio
    const twilio = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await twilio.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,   // Should be whatsapp:+1415...
      to: `whatsapp:${from}`,
      body: reply,
    });

    console.log("✅ Reply sent successfully");
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("❌ Webhook Error:", error.message);
    console.error("Full error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// For browser testing
export async function GET() {
  return NextResponse.json({ 
    status: "✅ FinMitra Webhook is live!",
    message: "Send a WhatsApp message to test"
  });
}
