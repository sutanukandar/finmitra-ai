import Anthropic from '@anthropic-ai/sdk';
import { ParsedIntent, MediaParseResult } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export const parser = {

  async parseTextMessage(message: string, todayDate: string): Promise<ParsedIntent> {
    const systemPrompt = `You are FinMitra. Today's date is ${todayDate}.
Parse the user message and return ONLY valid JSON (no markdown, no code blocks, no extra text).

Supported intents: add_entries, query_today, query_mtd, query_lastmonth, help, unknown.

Categories for add_entries:
- sales / revenue / bika / aaj bika / today sales
- swiggy, phonepe, hyperpure, bigbasket, milk, bread, rent, electricity, gas, salary, fixed

If the message is about sales/revenue, use category: "sales".

Example output:
{"intent": "add_entries", "entries": [{"category": "sales", "amount": 3500, "date_offset": 0}]}`;

    try {
      const aiResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: "user", content: message }]
      });

      let text = aiResponse.content?.[0]?.type === 'text' 
        ? aiResponse.content[0].text.trim() 
        : '{}';

      text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      return JSON.parse(text) as ParsedIntent;
    } catch (error) {
      console.error("[Parser] parseTextMessage failed:", error);
      return { intent: "unknown" };
    }
  },

  // parseMedia function remains the same (no change needed here)
  async parseMedia(mediaUrl: string, mediaType: string | null): Promise<MediaParseResult> {
    // ... (your existing parseMedia code stays unchanged)
    console.log(`[Parser] Starting media parsing. Type: ${mediaType || 'unknown'}`);
    return {
      success: false,
      extracted: "Media parsing not implemented yet"
    };
  }
};
