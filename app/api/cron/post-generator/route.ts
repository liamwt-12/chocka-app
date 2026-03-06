import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyCronSecret, unauthorizedResponse, getActiveUsersWithProfiles, generateCancelHash } from '@/lib/cron';
import { generatePost } from '@/lib/ai';
import { sendEmail, postPreviewEmail } from '@/lib/email';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return unauthorizedResponse();
  try {
    const users = await getActiveUsersWithProfiles(supabaseAdmin);
    const now = new Date();
    const month = now.toLocaleString('en-GB', { month: 'long' });
    let generated = 0;
    for (const user of users) {
      if (!user.auto_post_enabled) continue;
      const profile = user.profiles?.[0];
      if (!profile) continue;
      try {
        const { data: recentPosts } = await supabaseAdmin.from('scheduled_posts').select('content').eq('profile_id', profile.id).order('created_at', { ascending: false }).limit(4);
        const postContent = await generatePost({ businessName: profile.business_name, category: profile.category || 'tradesperson', city: profile.address?.split(',').pop()?.trim() || 'your area', month, season: 'spring', recentPosts: (recentPosts || []).map((p: any) => p.content) });
        const monday = new Date(now); monday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7)); monday.setHours(10,0,0,0);
        const { data: post } = await supabaseAdmin.from('scheduled_posts').insert({ profile_id: profile.id, content: postContent, scheduled_for: monday.toISOString(), status: 'pending_approval' }).select().single();
        if (post && user.email) {
          const hash = generateCancelHash(post.id);
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.chocka.co.uk';
          await sendEmail({ to: user.email, subject: 'Your Google post for this week', html: postPreviewEmail(profile.business_name, postContent, `${appUrl}/api/posts/cancel?id=${post.id}&hash=${hash}`) });
        }
        generated++;
      } catch (err) { console.error('Post gen failed:', err); }
    }
    return NextResponse.json({ success: true, generated });
  } catch (err) {
    console.error('Post generator cron failed:', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
