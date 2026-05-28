import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function resolveCanonical(item_name: string, quantity: number, unit: string) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Return ONLY a JSON object with these fields for this item name:
{ "item_canonical": string, "unit_normalised": string, "quantity_normalised": number }

Rules:
- item_canonical: generic ingredient name, strip brand/size/packaging. One or two words, Capitalised.
  Examples: 'fresho! Carrot 1kg' → 'Carrot', 'Amul Curd 900g' → 'Curd', 'Bru Coffee 500g' → 'Coffee Powder'
- unit_normalised: Kg | L | Pc only
- quantity_normalised: quantity in unit_normalised (e.g. 500g → 0.5 Kg)

Item name: "${item_name}", quantity: ${quantity}, unit: "${unit}"`
    }]
  });

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
  return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
}

async function main() {
  const { data: rows, error } = await supabase
    .from('invoice_items')
    .select('id, item_name, quantity, unit')
    .is('item_canonical', null);

  if (error) { console.error('Fetch failed:', error); process.exit(1); }
  if (!rows || rows.length === 0) { console.log('No rows to backfill.'); return; }

  console.log(`Backfilling ${rows.length} rows...`);

  for (const row of rows) {
    try {
      const canonical = await resolveCanonical(row.item_name, row.quantity, row.unit);
      await supabase
        .from('invoice_items')
        .update({
          item_canonical:      canonical.item_canonical || null,
          unit_normalised:     canonical.unit_normalised || null,
          quantity_normalised: canonical.quantity_normalised || null
        })
        .eq('id', row.id);

      console.log(`✅ ${row.item_name} → ${canonical.item_canonical} (${canonical.quantity_normalised} ${canonical.unit_normalised})`);
    } catch (err) {
      console.error(`❌ Failed for "${row.item_name}":`, err);
    }
  }

  console.log('Done.');
}

main();
