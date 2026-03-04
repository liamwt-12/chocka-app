import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { cancelSubscription } from '@/lib/stripe';

// PATCH — update user settings
export async function PATCH(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await request.json();

    // Only allow specific fields to be updated
    const allowedFields = ['auto_post_enabled', 'auto_reply_enabled', 'sms_enabled'];
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };

    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    const { error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', userId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Settings update error:', err);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}

// DELETE — delete account and all data
export async function DELETE(request: NextRequest) {
  try {
    const userId = request.cookies.get('chocka_user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    // Get user for Stripe cancellation
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('stripe_subscription_id')
      .eq('id', userId)
      .single();

    // Cancel Stripe subscription
    if (user?.stripe_subscription_id) {
      try {
        await cancelSubscription(user.stripe_subscription_id);
      } catch (err) {
        console.error('Stripe cancellation failed:', err);
        // Continue with deletion anyway
      }
    }

    // Delete user — cascades to profiles, reviews, posts, etc. via FK constraints
    const { error } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) throw error;

    // Clear session cookie
    const response = NextResponse.json({ success: true });
    response.cookies.delete('chocka_user_id');
    return response;
  } catch (err) {
    console.error('Account deletion error:', err);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}
