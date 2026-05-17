import Anthropic from '@anthropic-ai/sdk';
import { ParsedIntent, MediaParseResult } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export const parser = {

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
   * Improved Media Parsing with Twilio Authentication
   */
  async parseMedia(mediaUrl: string, mediaType: string | null): Promise<MediaParseResult> {
    console.log(`[Parser] Starting media parsing. Type: ${mediaType || 'unknown'}`);

    try {
      // Add Twilio Basic Auth when downloading media
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

      const response = await fetch(mediaUrl, {
        headers: {
          'Authorization': `Basic ${auth}`
        }
      });

      if (!response.ok) {
        throw new Error(`Twilio media download failed: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      console.log(`[Parser] Downloaded size: ${(buffer.byteLength / 1024).toFixed(1)} KB`);

      const base64Data = Buffer.from(buffer).toString('base64');

      const aiResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        messages: [{
          role: "user",
          content: [
            { 
              type: "text", 
              text: "This is a supplier bill from India. Extract: Vendor name, Date, Total Amount, and list main items with amounts." 
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

      const extracted = aiResponse.content?.[0]?.type === 'text' 
        ? aiResponse.content[0].text 
        : "Could not extract data.";

      console.log(`[Parser] Claude parsing successful`);

      return {
        success: true,
        extracted: extracted
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
