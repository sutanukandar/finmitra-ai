/**
 * Parser test suite — makes real Claude API calls.
 * Run: npm run test:parser
 *
 * Each test calls parser.parseTextMessage() directly and verifies the returned ParsedIntent.
 * Tests run sequentially to avoid rate-limit bursts.
 */

import { parser } from '../app/api/webhook/parser';
import type { ParsedIntent } from '../app/api/webhook/types';

const TODAY = '2026-06-04';

interface TestCase {
  message: string;
  expectedIntent?: ParsedIntent['intent'];
  notIntent?: ParsedIntent['intent'];   // assert this intent is NOT returned
  expectedMetric?: string;
  expectedPeriod?: string;
  expectedDays?: number;
  expectedMonth?: string;
  expectedCategory?: string;
  expectedAmount?: number;              // assert entries[0].amount (add_entries only)
  description?: string;
}

const tests: TestCase[] = [
  // ── query_pnl ─────────────────────────────────────────────────────────
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
    message: 'show me profit and loss',
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

  // ── query_pnl_detail ──────────────────────────────────────────────────
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
  {
    message: 'poora P&L dikhao',
    expectedIntent: 'query_pnl_detail',
  },
  {
    message: 'full breakdown this month',
    expectedIntent: 'query_pnl_detail',
    expectedPeriod: 'mtd',
  },

  // ── query_specific: sales ─────────────────────────────────────────────
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
    expectedPeriod: 'today',
    notIntent: 'query_freeform',
  },
  {
    message: 'what is my revenue today',
    expectedIntent: 'query_specific',
    expectedMetric: 'sales',
    expectedPeriod: 'today',
    notIntent: 'query_freeform',
  },
  {
    message: 'revenue this month',
    expectedIntent: 'query_specific',
    expectedMetric: 'sales',
    expectedPeriod: 'mtd',
  },

  // ── query_specific: vendor/expense metrics ────────────────────────────
  {
    message: 'milk expense this month',
    expectedIntent: 'query_specific',
    expectedMetric: 'milk',
    expectedPeriod: 'mtd',
    notIntent: 'query_freeform',
  },
  {
    message: 'How much is my Hyperpure bill this month?',
    expectedIntent: 'query_specific',
    expectedMetric: 'hyperpure',
    expectedPeriod: 'mtd',
    notIntent: 'query_freeform',
  },
  {
    message: 'What are my total expenses this month?',
    expectedIntent: 'query_specific',
    expectedMetric: 'cogs',
    expectedPeriod: 'mtd',
    notIntent: 'query_freeform',
  },
  {
    message: 'what is my rent this month',
    expectedIntent: 'query_specific',
    expectedMetric: 'rent',
    expectedPeriod: 'mtd',
    notIntent: 'query_freeform',
  },
  {
    message: 'dmart spend this month',
    expectedIntent: 'query_specific',
    expectedMetric: 'dmart',
    expectedPeriod: 'mtd',
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
    message: 'sales trend last 7 days',
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
  // Ordinal date + year: amount must be AFTER "is", NOT the year 2026
  {
    message: 'Sales of 4th June 2026 is 3245',
    expectedIntent: 'add_entries',
    expectedCategory: 'sales',
    expectedAmount: 3245,
    description: 'year in date must not be confused with amount',
  },
  {
    message: 'Sales of 3rd May 2026 is 4200',
    expectedIntent: 'add_entries',
    expectedCategory: 'sales',
    expectedAmount: 4200,
    description: 'year in date must not be confused with amount',
  },
  // Ordinal date without year — no "is" — amount is the standalone number
  {
    message: 'Sales of 4th June 3245',
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
];

// ── runner ────────────────────────────────────────────────────────────────────

async function runTests() {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const tc of tests) {
    const label = tc.message;

    let result: ParsedIntent;
    try {
      result = await parser.parseTextMessage(tc.message, TODAY);
    } catch (err) {
      console.error(`❌ "${label}" → EXCEPTION: ${err}`);
      failed++;
      failures.push(`"${label}" → EXCEPTION`);
      continue;
    }

    const errors: string[] = [];

    if (tc.expectedIntent && result.intent !== tc.expectedIntent) {
      errors.push(`intent: got "${result.intent}", expected "${tc.expectedIntent}"`);
    }

    if (tc.notIntent && result.intent === tc.notIntent) {
      errors.push(`intent must NOT be "${tc.notIntent}", but was`);
    }

    if (tc.expectedMetric && (result as any).metric !== tc.expectedMetric) {
      errors.push(`metric: got "${(result as any).metric}", expected "${tc.expectedMetric}"`);
    }

    if (tc.expectedPeriod && (result as any).period !== tc.expectedPeriod) {
      errors.push(`period: got "${(result as any).period}", expected "${tc.expectedPeriod}"`);
    }

    if (tc.expectedDays !== undefined && (result as any).days !== tc.expectedDays) {
      errors.push(`days: got ${(result as any).days}, expected ${tc.expectedDays}`);
    }

    if (tc.expectedMonth && (result as any).month !== tc.expectedMonth) {
      errors.push(`month: got "${(result as any).month}", expected "${tc.expectedMonth}"`);
    }

    if (tc.expectedCategory) {
      const entries = (result as any).entries as Array<{ category: string }> | undefined;
      const firstCat = entries?.[0]?.category;
      if (firstCat !== tc.expectedCategory) {
        errors.push(`category: got "${firstCat}", expected "${tc.expectedCategory}"`);
      }
    }

    if (tc.expectedAmount !== undefined) {
      const entries = (result as any).entries as Array<{ amount: number }> | undefined;
      const firstAmount = entries?.[0]?.amount;
      if (firstAmount !== tc.expectedAmount) {
        errors.push(`amount: got ${firstAmount}, expected ${tc.expectedAmount}`);
      }
    }

    if (errors.length === 0) {
      console.log(`✅ "${label}"`);
      passed++;
    } else {
      const detail = errors.join('; ');
      console.log(`❌ "${label}" → ${detail}`);
      failed++;
      failures.push(`"${label}" → ${detail}`);
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed}/${passed + failed} passed`);

  if (failures.length > 0) {
    console.log(`\nFailed tests:`);
    failures.forEach(f => console.log(`  • ${f}`));
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
