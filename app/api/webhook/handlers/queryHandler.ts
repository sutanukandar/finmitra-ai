import { dataService } from '../../../../lib/db/dataService';

export async function handlePnlQuery(from: string, restaurantId: string, body: string) {
  try {
    const today = new Date().toISOString().split('T')[0];

    let startDate = today;
    let endDate: string | undefined;

    if (body.includes('aaj') || body.includes('today') || body.includes('p&l')) {
      startDate = today;
    } else if (body.includes('kal') || body.includes('yesterday')) {
      startDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    } else if (body.includes('this month') || body.includes('month')) {
      startDate = today.slice(0, 7) + '-01';
      endDate = today;
    } else {
      await sendMessage(from, "Please specify period like `aaj ka P&L`, `this month`, or `kal ka P&L`");
      return;
    }

    // Use centralized dataService
    const { data: entries, error } = await dataService.getPnlData(restaurantId, startDate, endDate);

    if (error || !entries || entries.length === 0) {
      await sendMessage(from, "No data found for this period yet.");
      return;
    }

    // Calculate P&L
    let revenue = 0, cogs = 0, fixed = 0;

    entries.forEach((e: any) => {
      revenue += (e.swiggy || 0) + (e.phonepe || 0);
      cogs += (e.hyperpure || 0) + (e.bigbasket || 0) + (e.milk || 0) + (e.bread || 0);
      fixed += (e.rent || 0) + (e.electricity || 0) + (e.gas || 0) + (e.salary || 0) + (e.fixed || 0);
    });

    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - fixed;
    const margin = revenue > 0 ? Math.round((grossProfit / revenue) * 100) : 0;

    const reply = `📊 *P&L Summary*

Revenue     : ₹${revenue.toLocaleString('en-IN')}
COGS        : ₹${cogs.toLocaleString('en-IN')}
Gross Profit: ₹${grossProfit.toLocaleString('en-IN')} (${margin}%)
Fixed Cost  : ₹${fixed.toLocaleString('en-IN')}
Net Profit  : ₹${netProfit.toLocaleString('en-IN')}

Period: ${body.includes('month') ? 'This Month' : body.includes('kal') ? 'Yesterday' : 'Today'}`;

    await sendMessage(from, reply);

  } catch (error) {
    console.error("[QueryHandler] Error:", error);
    await sendMessage(from, "Unable to fetch P&L right now. Please try again.");
  }
}

async function sendMessage(to: string, body: string) {
  const twilio = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  await twilio.messages.create({
    from: 'whatsapp:+14155238886',
    to: `whatsapp:${to}`,
    body: body,
  });
}
