import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select(`*, profiles (*)`)
    .eq('subscription_status', 'active')
    .eq('token_status', 'valid')
    .or('pause_until.is.null,pause_until.lt.now()');

  return NextResponse.json({ data, error, count: data?.length });
}
