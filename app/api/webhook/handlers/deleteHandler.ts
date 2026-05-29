import { createClient } from '@supabase/supabase-js';
import { dataService } from '../../../../lib/db/dataService';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PNL_COLUMNS = [
  'milk', 'bread', 'water', 'phonepe', 'swiggy', 'zomato', 'sales',
  'hyperpure', 'bigbasket', 'rent', 'electricity', 'salary', 'gas', 'fixed', 'other'
];

const MONTH_MAP: Record<string, string> = {
  jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
  apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
  aug: '08', august: '08', sep: '09', september: '09', oct: '10', october: '10',
  nov: '11', november: '11', dec: '12', december: '12',
};

function extractDate(body: string): string | null {
  const lower = body.toLowerCase();
  const re = /(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?/i;
  const m = lower.match(re);
  if (m) {
    const day  = m[1].padStart(2, '0');
    const mon  = MONTH_MAP[m[2].toLowerCase()] || '01';
    const year = m[3] || new Date().getFullYear().toString();
    return `${year}-${mon}-${day}`;
  }
  return null;
}

function formatDate(isoDate: string): string {
  if (!isoDate) return 'that date';
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata'
  });
}

function getTimeAgo(updatedAt: string): string {
  const diff = Date.now() - new Date(updatedAt).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(diff / 3600000);
  if (mins < 2)  return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (hrs  < 24) return 'today';
  if (hrs  < 48) return 'yesterday';
  return formatDate(updatedAt.split('T')[0]);
}

export async function handleDelete(from: string, restaurantId: string, body: string) {
  console.log(`[DeleteHandler] Processing: "${body}"`);

  const lower    = body.toLowerCase();
  const category = PNL_COLUMNS.find(col => lower.includes(col));

  if (!category) {
    await sendMessage(from,
      'Which category to delete? e.g.\n• *hata do milk*\n• *delete water*\n• *phonepe hatao*'
    );
    return;
  }

  // ── Specific date mentioned → skip picker, go straight to confirm ────
  const date = extractDate(body);

  if (date) {
    const { data } = await supabase
      .from('pnl_entries')
      .select(`date, ${category}`)
      .eq('restaurant_id', restaurantId)
      .eq('date', date)
      .maybeSingle();

    const amount = data ? Number((data as any)[category] || 0) : 0;

    if (!amount) {
      await sendMessage(from, `No ${category} entry found for ${formatDate(date)}.`);
      return;
    }

    await dataService.createPendingConfirmation(restaurantId, {
      category,
      date,
      amount,
    }, 'confirm_delete');

    await sendMessage(from,
      `🗑️ *${category} ₹${amount.toLocaleString('en-IN')} for ${formatDate(date)}*\n\nDelete? Reply *haan* · *nahi*`
    );
    return;
  }

  // ── No date → fetch last 3 entries for this category ────────────────
  const { data: rawRows } = await supabase
    .from('pnl_entries')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .gt(category as string, 0)
    .order('updated_at', { ascending: false })
    .limit(3);

  const rows = (rawRows || []) as any[];

  if (rows.length === 0) {
    await sendMessage(from, `No ${category} entries found to delete.`);
    return;
  }

  const numberEmoji = ['1️⃣', '2️⃣', '3️⃣'];
  const lines = rows.map((r, i) => {
    const amount  = Number(r[category]);
    const timeAgo = getTimeAgo(r.updated_at as string);
    return `${numberEmoji[i]} ${formatDate(r.date)} — ₹${amount.toLocaleString('en-IN')} (${timeAgo})`;
  });

  await dataService.createPendingConfirmation(restaurantId, {
    category,
    options: rows.map((r: any) => ({
      date:   r.date,
      amount: Number(r[category]),
    })),
  }, 'delete_pick');

  await sendMessage(from,
    `Which *${category}* entry to delete?\n\n${lines.join('\n')}\n\nReply 1, 2 or 3`
  );
}

async function sendMessage(to: string, body: string) {
  const twilio = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  await twilio.messages.create({
    from: 'whatsapp:+14155238886',
    to:   `whatsapp:${to}`,
    body,
  });
}
