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

  async parseMedia(mediaUrl: string, mediaType: string | null): Promise<MediaParseResult> {
    console.log(`[Parser] Starting media parse. URL: ${mediaUrl}, Type: ${mediaType}`);

    try {
      // Download media from Twilio using Basic Auth
      const auth = Buffer.from(
        `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
      ).toString('base64');

      console.log('[Parser] Downloading media from Twilio...');
      const mediaResponse = await fetch(mediaUrl, {
        headers: { Authorization: `Basic ${auth}` }
      });

      if (!mediaResponse.ok) {
        throw new Error(`Twilio download failed: ${mediaResponse.status} ${mediaResponse.statusText}`);
      }

      const mediaBuffer = await mediaResponse.arrayBuffer();
      const base64Data = Buffer.from(mediaBuffer).toString('base64');
      console.log(`[Parser] Downloaded ${mediaBuffer.byteLength} bytes`);

      const contentType = mediaType || 'image/jpeg';
      const isPdf = contentType.includes('pdf');
      console.log(`[Parser] Content type: ${contentType}, isPDF: ${isPdf}`);

      // Build Claude content block for PDF or image
      const mediaBlock = isPdf
        ? {
            type: 'document' as const,
            source: {
              type: 'base64' as const,
              media_type: 'application/pdf' as const,
              data: base64Data
            }
          }
        : {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: contentType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: base64Data
            }
          };

      const prompt = `You are a bill parsing assistant for an Indian restaurant.
Extract all information from this invoice/bill and return ONLY valid JSON (no markdown, no code blocks, no extra text).

Return this exact structure:
{
  "vendor": "vendor name",
  "date": "DD-MM-YYYY",
  "invoice_number": "invoice number or empty string",
  "total": numeric total amount in INR,
  "items": [
    {
      "item_name": "product name",
      "quantity": numeric quantity,
      "unit": "Kg/Pc/L/etc",
      "rate": numeric per-unit price,
      "amount": numeric line total
    }
  ]
}

Rules:
- date must be in DD-MM-YYYY format
- All amounts are numbers only (no ₹ symbol)
- If a field is unclear, use a sensible default (0 for numbers, empty string for text)`;

      console.log('[Parser] Sending to Claude Vision...');
      const aiResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              mediaBlock,
              { type: 'text', text: prompt }
            ]
          }
        ]
      });

      let responseText = aiResponse.content?.[0]?.type === 'text'
        ? aiResponse.content[0].text.trim()
        : '';

      console.log('[Parser] Claude response:', responseText.substring(0, 300));

      // Strip markdown code fences if present
      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      const parsed = JSON.parse(responseText);

      // Convert date DD-MM-YYYY → YYYY-MM-DD
      let isoDate = parsed.date;
      if (parsed.date && /^\d{2}-\d{2}-\d{4}$/.test(parsed.date)) {
        const [dd, mm, yyyy] = parsed.date.split('-');
        isoDate = `${yyyy}-${mm}-${dd}`;
      }
      console.log(`[Parser] Date converted: ${parsed.date} → ${isoDate}`);

      // Enrich each item with mapped_category and ensure 'name' field for compatibility
      const allItems = (parsed.items || []).map((item: any) => ({
        ...item,
        name: item.item_name || item.name || 'Unknown Item',
        mapped_category: 'cogs'
      }));

      // Separate delivery/shipping charges from food items
      const DELIVERY_RE = /delivery|shipping|freight|pay on delivery/i;
      const foodItems     = allItems.filter((i: any) => !DELIVERY_RE.test(i.item_name || ''));
      const deliveryItems = allItems.filter((i: any) =>  DELIVERY_RE.test(i.item_name || ''));
      const deliveryFee   = deliveryItems.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);

      if (deliveryFee > 0) {
        console.log(`[Parser] Separated delivery fee: ₹${deliveryFee} (${deliveryItems.length} line item(s))`);
      }
      console.log(`[Parser] Done. Vendor: ${parsed.vendor}, Total: ${parsed.total}, Food items: ${foodItems.length}`);

      return {
        success: true,
        vendor: parsed.vendor,
        date: isoDate,
        total: parsed.total,
        items: foodItems,
        delivery_fee: deliveryFee,
        extracted: responseText
      };

    } catch (error: any) {
      console.error('[Parser] parseMedia failed:', error);
      return {
        success: false,
        extracted: error.message || 'Unknown error'
      };
    }
  }
};
