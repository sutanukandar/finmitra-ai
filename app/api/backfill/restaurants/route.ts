import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name, city')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) {
    return Response.json({ restaurants: [] }, { status: 500 });
  }

  return Response.json({ restaurants: data });
}
