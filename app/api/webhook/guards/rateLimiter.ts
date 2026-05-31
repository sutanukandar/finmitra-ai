const messageCount = new Map<string, { count: number; resetAt: number }>();

const LIMIT  = 30;               // max messages per window per user
const WINDOW = 60 * 60 * 1000;  // 1 hour in ms

export function isRateLimited(phoneNumber: string): boolean {
  const now   = Date.now();
  const entry = messageCount.get(phoneNumber);

  if (!entry || now > entry.resetAt) {
    messageCount.set(phoneNumber, { count: 1, resetAt: now + WINDOW });
    return false;
  }

  if (entry.count >= LIMIT) return true;

  entry.count++;
  return false;
}
