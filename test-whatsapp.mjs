import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const FROM        = 'whatsapp:+14155238886';
const TO          = 'whatsapp:+919886962078';
const WAIT_MS     = 8000;
const DELAY_MS    = 3000;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
const sleep  = ms => new Promise(r => setTimeout(r, ms));

const TEST_CASES = [
  { msg: 'PnL for this month?',                expect: 'total sales',  label: 'PnL — PnL variant' },
  { msg: 'P&L this month',                     expect: 'total sales',  label: 'PnL — P&L variant' },
  { msg: 'detailed P&L for this month',        expect: 'item cost',    label: 'PnL detail' },
  { msg: 'What is total sales for this month?',expect: '₹',            label: 'Sales MTD' },
  { msg: 'revenue this month',                 expect: '₹',            label: 'Revenue MTD' },
  { msg: 'How much is my Hyperpure bill this month?', expect: '₹',     label: 'Hyperpure MTD' },
  { msg: 'How much is my Hyperpure bill in May 2026?', expect: ['₹','may'], label: 'Hyperpure May 2026' },
  { msg: 'How much is my Hyperpure bill last month?',  expect: ['₹','may'], label: 'Hyperpure last month' },
  { msg: 'milk expense this month',            expect: '₹',            label: 'Milk MTD' },
  { msg: 'Sales trend last 7 days',            expect: '₹',            label: 'Sales trend 7d' },
  { msg: 'Daily expense trend for this month', expect: '₹',            label: 'Daily expense trend' },
  { msg: 'today sales 1234',                   expect: '✅',           label: 'Entry — today sales' },
  { msg: 'Water expense for 6th June is 40',   expect: '✅',           label: 'Entry — ordinal date' },
  { msg: 'last bill uploaded',                 expect: ['uploaded','bill','hyperpure','bigbasket'], label: 'Upload history' },
  { msg: 'Give me monthly milk expense for last 3 month', expect: '₹', label: 'Multi-month milk', forbidden: 'something went wrong' },
  { msg: 'How much did I sell yesterday?',     expect: ['₹','sales'],  label: 'Yesterday sales', forbidden: 'something went wrong' },
];

async function getBotReply(afterSid) {
  await sleep(WAIT_MS);
  const msgs = await client.messages.list({ from: FROM, to: TO, limit: 5 });
  return msgs.find(m => m.sid !== afterSid)?.body || null;
}

function check(reply, expect, forbidden) {
  if (!reply) return { pass: false, reason: 'No reply' };
  if (forbidden && reply.toLowerCase().includes(forbidden.toLowerCase()))
    return { pass: false, reason: `Got forbidden: "${forbidden}"` };
  const arr = Array.isArray(expect) ? expect : [expect];
  for (const e of arr)
    if (reply.toLowerCase().includes(e.toLowerCase())) return { pass: true };
  return { pass: false, reason: `Expected "${arr.join('" or "')}"` };
}

async function run() {
  console.log(`\n🧪 FinMitra WhatsApp Test Runner — ${TEST_CASES.length} cases\n`);
  const results = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    process.stdout.write(`[${i+1}/${TEST_CASES.length}] "${tc.msg}" ... `);
    const sent = await client.messages.create({ from: FROM, to: TO, body: tc.msg });
    const reply = await getBotReply(sent.sid);
    const { pass, reason } = check(reply, tc.expect, tc.forbidden);
    console.log(pass ? '✅' : `❌  ${reason}`);
    if (!pass && reply) console.log(`   Got: "${reply.substring(0,80)}"`);
    results.push({ ...tc, pass, reason, reply: reply?.substring(0, 100) });
    if (i < TEST_CASES.length - 1) await sleep(DELAY_MS);
  }

  const passed = results.filter(r => r.pass).length;
  console.log(`\nResult: ${passed}/${results.length} passed`);
  results.filter(r => !r.pass).forEach(r =>
    console.log(`  ❌ ${r.label}: ${r.reason}`)
  );
}

run().catch(console.error);
