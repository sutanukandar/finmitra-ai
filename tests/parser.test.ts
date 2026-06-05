/**
 * Parser test suite — makes real Claude API calls.
 * Run: npm run test:parser
 *
 * Tests parser.parseTextMessage() directly (the Claude LLM call).
 * Runs sequentially to avoid rate-limit bursts.
 */

import { parser } from '../app/api/webhook/parser';
import type { ParsedIntent } from '../app/api/webhook/types';

const TODAY = '2026-06-05';

interface TestCase {
  message: string;
  expectedIntent?: ParsedIntent['intent'];
  notIntent?: ParsedIntent['intent'];
  expectedMetric?: string;
  expectedPeriod?: string;
  expectedMonth?: string;
  expectedDays?: number;
  expectedCategory?: string;
  expectedAmount?: number;
}

const tests: TestCase[] = [

  // ── query_pnl ──────────────────────────────────────────────────────────
  {
    message: 'P&L this month',
    expectedIntent: 'query_pnl',
    expectedPeriod: 'mtd',
  },
  {
    message: 'monthly report',
    expectedIntent: 'query_pnl',
  },
  {
    message: 'Give me a P&L for this month',
    expectedIntent: 'query_pnl',
    notIntent: 'query_freeform',
  },
  {
    message: 'Give me PNL for this month',
    expectedIntent: 'query_pnl',
    notIntent: 'query_freeform',
  },
  {
    message: 'Show me profit and loss',
    expectedIntent: 'query_pnl',
    notIntent: 'query_freeform',
  },
  {
    message: 'P&L dikhao',
    expectedIntent: 'query_pnl',
  },
  {
    message: 'aaj ka P&L',
    expectedIntent: 'query_pnl',
    expectedPeriod: 'today',
  },
  {
    message: 'P&L for May 2026',
    expectedIntent: 'query_pnl',
    expectedPeriod: 'specific_month',
    expectedMonth: '2026-05',
  },

  // ── query_pnl_detail ───────────────────────────────────────────────────
  {
    message: 'detailed P&L',
    expectedIntent: 'query_pnl_detail',
    notIntent: 'query_freeform',
  },
  {
    message: 'detailed PnL of May 2026',
    expectedIntent: 'query_pnl_detail',
    expectedPeriod: 'specific_month',
    expectedMonth: '2026-05',
    notIntent: 'query_freeform',
  },

  // ── query_specific: sales / revenue ───────────────────────────────────
  {
    message: 'What is total sales for this month?',
    expectedIntent: 'query_specific',
    expectedMetric: 'sales',
    expectedPeriod: 'mtd',
    notIntent: 'query_freeform',
  },
  {
    message: 'total sales this month',
    expectedIntent: 'query_specific',
    expectedMetric: 'sales',
    expectedPeriod: 'mtd',
  },
  {
    message: 'How much did I sell today?',
    expectedIntent: 'query_specific',
    expectedMetric: 'sales',
    notIntent: 'query_freeform',
  },
  {
    message: 'revenue this month',
    expectedIntent: 'query_specific',
    expectedMetric: 'sales',
    expectedPeriod: 'mtd',
  },

  // ── query_specific: vendor / expense metrics ──────────────────────────
  {
    message: 'milk expense this month',
    expectedIntent: 'query_specific',
    expectedMetric: 'milk',
    notIntent: 'query_freeform',
  },
  {
    message: 'How much is my Hyperpure bill this month?',
    expectedIntent: 'query_specific',
    expectedMetric: 'hyperpure',
    notIntent: 'query_freeform',
  },
  {
    message: 'What are my total expenses this month?',
    expectedIntent: 'query_specific',
    expectedMetric: 'cogs',
    notIntent: 'query_freeform',
  },
  {
    message: 'what is my rent this month',
    expectedIntent: 'query_specific',
    expectedMetric: 'rent',
    notIntent: 'query_freeform',
  },
  {
    message: 'dmart spend this month',
    expectedIntent: 'query_specific',
    expectedMetric: 'dmart',
    notIntent: 'query_freeform',
  },

  // ── query_daily_breakdown ─────────────────────────────────────────────
  {
    message: 'Sales trend of last 7 days',
    expectedIntent: 'query_daily_breakdown',
    expectedMetric: 'sales',
    expectedPeriod: 'last_n_days',
    expectedDays: 7,
    notIntent: 'query_freeform',
  },
  {
    message: 'Sales trend last 7 days',
    expectedIntent: 'query_daily_breakdown',
    expectedMetric: 'sales',
    expectedPeriod: 'last_n_days',
    expectedDays: 7,
    notIntent: 'query_freeform',
  },
  {
    message: 'daily sales for last week',
    expectedIntent: 'query_daily_breakdown',
    expectedMetric: 'sales',
    notIntent: 'query_freeform',
  },
  {
    message: 'Daily expense trend for this month',
    expectedIntent: 'query_daily_breakdown',
    notIntent: 'query_freeform',
  },
  {
    message: 'milk expense trend last 30 days',
    expectedIntent: 'query_daily_breakdown',
    expectedMetric: 'milk',
    expectedPeriod: 'last_n_days',
    expectedDays: 30,
    notIntent: 'query_freeform',
  },
  {
    message: 'Sales trend for first 7 days of May 2026',
    expectedIntent: 'query_daily_breakdown',
    expectedMetric: 'sales',
    expectedPeriod: 'first_n_days_of_month',
    expectedDays: 7,
    expectedMonth: '2026-05',
    notIntent: 'query_freeform',
  },

  // ── add_entries ───────────────────────────────────────────────────────
  {
    message: 'today sales 3500',
    expectedIntent: 'add_entries',
    expectedCategory: 'sales',
  },
  {
    message: 'milk 456 aaj',
    expectedIntent: 'add_entries',
    expectedCategory: 'milk',
  },
  {
    message: '31 May sales 4200',
    expectedIntent: 'add_entries',
    expectedCategory: 'sales',
  },
  // Ordinal date — no year
  {
    message: 'Sales of 4th June 3245',
    expectedIntent: 'add_entries',
    expectedCategory: 'sales',
    expectedAmount: 3245,
  },
  // Ordinal date + year — amount must be 3245, NOT the year 2026
  {
    message: 'Sales of 4th June 2026 is 3245',
    expectedIntent: 'add_entries',
    expectedCategory: 'sales',
    expectedAmount: 3245,
  },
  {
    message: 'Milk of 4th June 456',
    expectedIntent: 'add_entries',
    expectedCategory: 'milk',
    expectedAmount: 456,
  },

  // ── correct_entry ─────────────────────────────────────────────────────
  {
    message: 'correct QR sales for 31 May to 4200',
    expectedIntent: 'correct_entry_replace',
    expectedCategory: 'sales',
  },
  {
    message: 'reduce QR sales for 31 May by 1506',
    expectedIntent: 'correct_entry_reduce',
    expectedCategory: 'sales',
  },

  // ── query_ingredient ──────────────────────────────────────────────────
  {
    message: 'how much butter this month',
    expectedIntent: 'query_ingredient',
  },
  {
    message: 'potato purchased this month',
    expectedIntent: 'query_ingredient',
  },

  // ── query_vendor_breakdown ────────────────────────────────────────────
  {
    message: 'Hyperpure breakdown',
    expectedIntent: 'query_vendor_breakdown',
  },
  {
    message: 'vendor wise expense this month',
    expectedIntent: 'query_vendor_breakdown',
    expectedPeriod: 'mtd',
  },

  // ── query_upload_history ──────────────────────────────────────────────
  {
    message: 'last bill uploaded',
    expectedIntent: 'query_upload_history',
  },
  {
    message: 'show recent uploads',
    expectedIntent: 'query_upload_history',
  },

  // ── NEGATIVE assertions: these must NEVER be query_freeform ──────────
  {
    message: 'Give me a P&L for this month',
    notIntent: 'query_freeform',
  },
  {
    message: 'Give me PNL for this month',
    notIntent: 'query_freeform',
  },
  {
    message: 'What is total sales this month?',
    notIntent: 'query_freeform',
  },
];

// ── runner ────────────────────────────────────────────────────────────────────

async function runTests() {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const tc of tests) {
    let result: ParsedIntent;
    try {
      result = await parser.parseTextMessage(tc.message, TODAY);
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.log(`❌ "${tc.message}" → EXCEPTION: ${msg.slice(0, 80)}`);
      failed++;
      failures.push(`"${tc.message}" → EXCEPTION: ${msg.slice(0, 80)}`);
      continue;
    }

    const errors: string[] = [];

    if (tc.expectedIntent && result.intent !== tc.expectedIntent) {
      errors.push(`intent: got "${result.intent}", expected "${tc.expectedIntent}"`);
    }

    if (tc.notIntent && result.intent === tc.notIntent) {
      errors.push(`intent must NOT be "${tc.notIntent}", but was`);
    }

    if (tc.expectedMetric !== undefined && (result as any).metric !== tc.expectedMetric) {
      errors.push(`metric: got "${(result as any).metric}", expected "${tc.expectedMetric}"`);
    }

    if (tc.expectedPeriod !== undefined && (result as any).period !== tc.expectedPeriod) {
      errors.push(`period: got "${(result as any).period}", expected "${tc.expectedPeriod}"`);
    }

    if (tc.expectedMonth !== undefined && (result as any).month !== tc.expectedMonth) {
      errors.push(`month: got "${(result as any).month}", expected "${tc.expectedMonth}"`);
    }

    if (tc.expectedDays !== undefined && (result as any).days !== tc.expectedDays) {
      errors.push(`days: got ${(result as any).days}, expected ${tc.expectedDays}`);
    }

    if (tc.expectedCategory !== undefined) {
      const entries = (result as any).entries as Array<{ category: string }> | undefined;
      const cat = entries?.[0]?.category;
      if (cat !== tc.expectedCategory) {
        errors.push(`category: got "${cat}", expected "${tc.expectedCategory}"`);
      }
    }

    if (tc.expectedAmount !== undefined) {
      const entries = (result as any).entries as Array<{ amount: number }> | undefined;
      const amt = entries?.[0]?.amount;
      if (amt !== tc.expectedAmount) {
        errors.push(`amount: got ${amt}, expected ${tc.expectedAmount}`);
      }
    }

    if (errors.length === 0) {
      console.log(`✅ "${tc.message}"`);
      passed++;
    } else {
      console.log(`❌ "${tc.message}" → ${errors.join('; ')}`);
      failed++;
      failures.push(`"${tc.message}" → ${errors.join('; ')}`);
    }
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`Results: ${passed}/${passed + failed} passed`);

  if (failures.length > 0) {
    console.log(`\nFailed (${failures.length}):`);
    failures.forEach(f => console.log(`  • ${f}`));
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
