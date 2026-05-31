export function isInContext(message: string): boolean {
  const m = message.toLowerCase().trim();

  // Always allow confirmation replies
  const confirmWords = ['haan', 'nahi', 'ha', 'no', 'yes', 'haa', 'nhi', '1', '2', '3'];
  if (confirmWords.includes(m)) return true;

  // Always allow delete triggers (handled in route.ts before guard)
  const deleteTriggers = ['hata do', 'hatao', 'delete'];
  if (deleteTriggers.some(t => m.includes(t))) return true;

  // Allow if message contains financial keywords
  const financialKeywords = [
    // Revenue
    'sales', 'revenue', 'income', 'bika', 'bikri', 'kamai',
    'phonepe', 'swiggy', 'zomato', 'cash', 'upi', 'payment',
    // Expenses
    'expense', 'kharch', 'kharcha', 'bill', 'invoice', 'cost',
    'milk', 'doodh', 'bread', 'water', 'paani', 'bigbasket',
    'hyperpure', 'dmart', 'grocery', 'sabzi',
    // Fixed costs
    'rent', 'salary', 'electricity', 'bijli', 'gas', 'wifi',
    'internet', 'garbage', 'pg',
    // P&L
    'p&l', 'pnl', 'profit', 'loss', 'margin', 'cogs',
    'balance', 'summary', 'report', 'hisaab', 'hisab',
    // Queries — only explicitly financial time references; generic words
    // like 'today', 'yesterday', 'how much', 'total', 'daily' removed to
    // avoid false passes on unrelated questions (e.g. "IPL score yesterday")
    'kitna', 'last month', 'this month',
    'march', 'april', 'june', 'july', 'august',
    'september', 'october', 'november', 'december', 'january', 'february',
    // Questions about bills/uploads
    'item', 'items', 'list', 'ordered', 'order', 'bought',
    'purchased', 'receipt', 'last', 'recent', 'when', 'which', 'what',
    // Actions
    'save', 'add', 'update', 'upload', 'entry',
    // Items
    'butter', 'egg', 'sugar', 'oil', 'chicken', 'carrot',
    'tomato', 'onion', 'honey', 'coffee', 'noodle', 'fries',
  ];

  if (financialKeywords.some(kw => m.includes(kw))) return true;

  // Allow short messages that look like amounts or dates ("3500", "25 may", "aaj 4200")
  if (/\d{3,}/.test(m)) return true;

  return false;
}
