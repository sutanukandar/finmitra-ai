import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const expected = process.env.BACKFILL_PASSWORD;

  if (!expected) {
    return Response.json({ ok: false, error: 'Portal password not configured.' }, { status: 500 });
  }

  return Response.json({ ok: password === expected });
}
