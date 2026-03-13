import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { refreshAccessToken } from '@/lib/google';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('google_refresh_token')
      .eq('email', 'liam@wearecanny.uk')
      .single();

    if (!user?.google_refresh_token) {
      return NextResponse.json({ error: 'No refresh token' });
    }

    const accessToken = await refreshAccessToken(user.google_refresh_token);

    const res = await fetch(
      'https://mybusiness.googleapis.com/v4/accounts/101424734473231549831/locations/4235053626994329317/localPosts',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const data = await res.json();
    return NextResponse.json({ status: res.status, data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message });
  }
}
