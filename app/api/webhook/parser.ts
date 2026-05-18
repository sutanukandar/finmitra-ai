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
        extracted: parsed.extracted || text,   // keep nice text for user
        vendor: parsed.vendor,
        date: parsed.date,
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
