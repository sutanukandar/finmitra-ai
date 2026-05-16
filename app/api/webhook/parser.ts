import Anthropic from '@anthropic-ai/sdk';
import { ParsedIntent, MediaParseResult } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export const parser = {

  /**
   * Parse normal text messages (Hinglish)
   */
  async parseTextMessage(message: string, todayDate: string): Promise<ParsedIntent> {
    const systemPrompt = `You are FinMitra, an AI CFO for Indian restaurant owners.
Today's date is ${todayDate}.
You understand natural Hinglish.

Parse the user message and return ONLY valid JSON.
Supported intents: add_entries, query_today, query_mtd, query_lastmonth, help, unknown.

Categories allowed: swiggy, phonepe, hyperpure, bigbasket, milk, bread, rent, electricity, gas, salary, fixed.

Example output:
{"intent": "add_entries", "entries": [{"category": "swiggy", "amount": 4500, "date_offset": 0}]}`;

    try {
      const aiResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: "user", content: message }]
      });

      const text = aiResponse.content?.[0]?.type === 'text' 
        ? aiResponse.content[0].text.trim() 
        : '{}';

      return JSON.parse(text) as ParsedIntent;
    } catch (error) {
      console.error("[Parser] parseTextMessage failed:", error);
      return { intent: "unknown" };
    }
  },

  /**
   * Parse media (photo or PDF) using Claude Vision
   */
  async parseMedia(mediaUrl: string, mediaType: string | null): Promise<MediaParseResult> {
    try {
      console.log(`[Parser] Parsing media: ${mediaType || 'unknown'} from ${mediaUrl}`);

      // TODO: In future we will add Supabase Storage bridge + Vision call
      // For now returning structured placeholder
      return {
        success: true,
        extracted: `✅ Parsed Bill

📅 Date: 16-May-2026
🏪 Vendor: Hyperpure
💰 Total Amount: ₹2,845

Key Items:
• Toned Milk 5L × 12 = ₹696
• Paneer 500g × 8 = ₹1,680
• Butter 100g × 5 = ₹280
• Fresh Cream 1L × 3 = ₹189
• ... + 8 more items`,
        vendor: "Hyperpure",
        date: "2026-05-16",
        total: 2845
      };

    } catch (error) {
      console.error("[Parser] parseMedia failed:", error);
      return {
        success: false,
        extracted: "Could not parse media"
      };
    }
  }
};
