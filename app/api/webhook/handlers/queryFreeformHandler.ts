import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function handleFreeformQuery(
  from: string,
  restaurantId: string,
  question: string
) {
  console.log(`[FreeformHandler] Question: "${question}"`);

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  const { data: pnlData } = await supabase
    .from('pnl_entries')
    .select('date, sales, phonepe, swiggy, zomato, hyperpure, bigbasket, milk, bread, water, other, rent, electricity, salary, fixed, gas')
    .eq('restaurant_id', restaurantId)
    .gte('date', ninetyDaysAgo)
    .order('date', { ascending: false });

  if (!pnlData || pnlData.length === 0) {
    await sendMessage(from, "No P&L data found yet to answer this question.");
    return;
  }

  const aiResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: `You are a financial analyst for an Indian restaurant called Tea Day.
Answer questions based only on the P&L data provided. Be concise — 2 to 4 lines max.
Format all numbers with ₹ symbol in Indian style (e.g. ₹1,23,456).
Column meanings:
  Revenue   = sales + phonepe + swiggy + zomato
  COGS      = hyperpure + bigbasket + milk + bread + water + other
  Fixed     = rent + electricity + salary + fixed + gas
  Gross profit = Revenue - COGS
  Net profit   = Gross profit - Fixed

STRICT RULE: Only answer questions about THIS restaurant's financial data.
If the question is not about the restaurant's expenses, revenue, bills, P&L,
or operational costs — respond with exactly the word: OUT_OF_SCOPE
Do not answer general knowledge questions, recipes, news, or anything
unrelated to the restaurant's finances.`,
    messages: [{
      role: 'user',
      content: `P&L data (last 90 days):\n${JSON.stringify(pnlData)}\n\nQuestion: ${question}`
    }]
  });

  const answer = aiResponse.content[0]?.type === 'text'
    ? aiResponse.content[0].text.trim()
    : "Sorry, I couldn't process that question.";

  if (answer === 'OUT_OF_SCOPE') {
    await sendMessage(from,
      "I can only help with your restaurant's finances.\nTry asking about your P&L, expenses, or sales."
    );
    return;
  }

  console.log(`[FreeformHandler] Answer: ${answer.slice(0, 100)}...`);
  await sendMessage(from, `🤖 ${answer}`);
}

async function sendMessage(to: string, body: string) {
  const twilio = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  await twilio.messages.create({
    from: 'whatsapp:+14155238886',
    to:   `whatsapp:${to}`,
    body,
  });
}
