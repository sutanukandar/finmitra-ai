import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

/**
 * AI Parser (as per TRD - AI Processing Module)
 * Central place for all Claude calls
 */
export const parser = {
  /**
   * Parse text message for intent and structured data
   */
  async parseTextMessage(message: string, todayDate: string) {
    const systemPrompt = `You are FinMitra. Today's date is ${todayDate}.
Parse the user message and return ONLY valid JSON.
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

      const text = aiResponse.content?.[0]?.type === 'text' 
        ? aiResponse.content[0].text 
        : '{}';

      return JSON.parse(text);
    } catch (error) {
      console.error("[Parser] Text parsing failed:", error);
      return { intent: "unknown" };
    }
  },

  /**
   * Future: Parse media (photo/PDF) using Claude Vision
   */
  async parseMedia(mediaUrl: string, mediaType: string | null) {
    // TODO: Implement real Vision parsing later
    console.log(`[Parser] Media parsing requested for ${mediaType}`);
    return {
      success: false,
      message: "Media parsing not implemented yet"
    };
  }
};
