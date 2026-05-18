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
    const systemPrompt = `You are FinMitra. Today's date is ${todayDate}.
Parse the user message and return ONLY valid JSON (no markdown, no code blocks).
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

      text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      return JSON.parse(text) as ParsedIntent;
    } catch (error) {
      console.error("[Parser] parseTextMessage failed:", error);
      return { intent: "unknown" };
    }
  },

  /**
   * Improved Media Parsing - Returns structured data + items array
   */
  async parseMedia(mediaUrl: string, mediaType: string | null): Promise<MediaParseResult> {
    console.log(`[Parser] Starting media parsing. Type: ${mediaType || 'unknown'}`);

    try {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

      const response = await fetch(mediaUrl, {
        headers: { 'Authorization': `Basic ${auth}` }
      });

      if (!response.ok) throw new Error(`Download failed: ${response.status}`);

      const buffer = await response.arrayBuffer();
      const base64Data = Buffer.from(buffer).toString('base64');

      const aiResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        messages: [{
          role: "user",
          content: [
            { 
              type: "text", 
              text: `Extract this Indian supplier bill as structured JSON.
Return ONLY valid JSON with this exact structure:
{
  "success": true,
  "vendor": "Hyperpure",
  "date": "2026-05-18",
  "total": 4165.56,
  "items": [
    {"item_name": "VIVI - Honey, 1 Kg", "quantity": 2, "unit": "Kg", "amount": 420}
  ]
}`
            },
            { 
              type: "image", 
              source: { 
                type: "base64", 
                media_type: "image/jpeg", 
                data: base64Data 
              }
            }
          ]
        }]
      });

      let text = aiResponse.content?.[0]?.type === 'text' 
        ? aiResponse.content[0].text.trim() 
        : '{}';

      text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      const parsed = JSON.parse(text);

      return {
        success: true,
        extracted: parsed.extracted || text,
        vendor: parsed.vendor || "Hyperpure",
        date: parsed.date || new Date().toISOString().split('T')[0],
        total: parsed.total,
        items: parsed.items || []
      };

    } catch (error: any) {
      console.error("[Parser] Media parsing FAILED:", error.message);
      return {
        success: false,
        extracted: "Could not read this bill clearly"
      };
    }
  }
};
