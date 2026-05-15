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
    const body = (formData.get('Body') as string) || '';
    const mediaUrl = formData.get('MediaUrl0') as string | null;
    const mediaType = formData.get('MediaContentType0') as string | null;

    if (!from) return NextResponse.json({ error: 'No sender' }, { status: 400 });

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('id, name')
      .eq('mobile', from)
      .single();

    if (!restaurant) {
      await sendMessage(from, "Namaste! This number is not registered with FinMitra yet.");
      return NextResponse.json({ success: true });
    }

    // Media Upload → Ask for confirmation
    if (mediaUrl) {
      await sendMessage(from, "📸 Media received! Processing...\n\nI'll show you the extracted data and ask for confirmation before saving.");
      // TODO: Full media handling in next phase
      return NextResponse.json({ success: true });
    }

    // Text Message → Claude Parsing
    const systemPrompt = `You are FinMitra. Today's date is ${new Date().toISOString().split('T')[0]}.
    Parse user message and return ONLY valid JSON.
    Supported intents: add_entries, query_today, query_mtd, query_lastmonth, help, unknown.
    Categories: swiggy, phonepe, hyperpure, bigbasket, milk, bread, rent, electricity, gas, salary, fixed.
    Example: {"intent": "add_entries", "entries": [{"category": "swiggy", "amount": 4500, "date_offset": 0}]}`;

    const aiResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: "user", content: body }]
    });

    let reply = "✅ Got it!";

    try {
      const jsonText = aiResponse.content[0].text;
      const parsed = JSON.parse(jsonText);

      if (parsed.intent === "add_entries" && parsed.entries) {
        for (const entry of parsed.entries) {
          const field = ['swiggy', 'phonepe'].includes(entry.category) ? entry.category : 
                       (['hyperpure','bigbasket','milk','bread'].includes(entry.category) ? entry.category : 'fixed');

          await supabase
            .from('pnl_entries')
            .upsert({
              restaurant_id: restaurant.id,
              date: new Date(Date.now() + (entry.date_offset || 0) * 86400000).toISOString().split('T')[0],
              [field]: entry.amount || 0
            }, { onConflict: 'restaurant_id,date' });
        }
        reply = `✅ Saved ${parsed.entries.length} entries!`;
      } else if (parsed.intent === "query_today") {
        reply = "📊 Today's P&L coming in next phase.";
      } else if (parsed.intent === "query_mtd") {
        reply = "📅 This month's summary coming soon.";
      } else if (parsed.intent === "help") {
        reply = "Try:\n• swiggy 4500 aaj\n• hyperpure 2400\n• aaj ka P&L\n• this month";
      }
    } catch (e) {
      reply = "I understood your message! Try typing numbers with categories.";
    }

    await sendMessage(from, reply);

    console.log(`[Webhook] Processed in ${Date.now() - startTime}ms`);
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Webhook Error:", error);
    if (from) await sendMessage(from, "Sorry, something went wrong. Please try again.");
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
