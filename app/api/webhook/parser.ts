import Anthropic from '@anthropic-ai/sdk';
import { ParsedIntent, MediaParseResult } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export const parser = {

  /**
   * Parse text message for intent and structured data
   */
  async parseTextMessage(message: string, todayDate: string): Promise<ParsedIntent> {
    const systemPrompt = `You are FinMitra. Today's date is ${todayDate}.
Parse the user message and return ONLY valid JSON (no markdown, no code blocks, no extra text).
Supported intents: add_entries, query_today, query_mtd, query_lastmonth, help, unknown.
Categories: swiggy, phonepe, hyperpure, bigbasket, milk, bread, rent, electricity, gas, salary, fixed.

Example output:
{"intent": "add_entries", "entries": [{"category": "swiggy", "amount": 4500, "date_offset": 0}]}`;

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

      // Clean markdown code blocks if Claude adds them
      text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      const parsed = JSON.parse(text) as ParsedIntent;
      return parsed;

    } catch (error) {
      console.error("[Parser] parseTextMessage failed:", error);
      return { intent: "unknown" };
    }
  },

  /**
   * Parse media (photo or PDF) using Claude Vision
   */
  async parseMedia(mediaUrl: string, mediaType: string | null): Promise<MediaParseResult> {
    console.log(`[Parser] Media parsing requested for ${mediaType || 'unknown'}`);
    return {
      success: false,
      extracted: "Media parsing not implemented yet"
    };
  }
};
