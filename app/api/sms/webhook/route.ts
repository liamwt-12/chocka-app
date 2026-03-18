import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const from = formData.get('From') as string;
    const body = (formData.get('Body') as string || '').trim().toUpperCase();

    if (!from) {
      return twimlResponse('');
    }

    // Find user by phone number
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('phone_number', from)
      .single();

    if (!user) {
      // Also try without country code
      const normalised = from.replace(/^\+44/, '0');
      const { data: userAlt } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('phone_number', normalised)
        .single();

      if (!userAlt) return twimlResponse('');
    }

    const targetUser = user || userAlt;
    if (!targetUser) return twimlResponse('');

    // Handle STOP
    if (body === 'STOP') {
      await supabaseAdmin
        .from('users')
        .update({ sms_enabled: false, updated_at: new Date().toISOString() })
        .eq('id', targetUser.id);

      // Log it
      await supabaseAdmin.from('sms_log').insert({
        user_id: targetUser.id,
        phone_number: from,
        message_type: 'opt_out',
        message_body: 'STOP',
        status: 'received',
      });

      return twimlResponse('You\'ve been unsubscribed from Chocka texts. Reply START anytime to re-enable.');
    }

    // Handle START
    if (body === 'START') {
      await supabaseAdmin
        .from('users')
        .update({ sms_enabled: true, updated_at: new Date().toISOString() })
        .eq('id', targetUser.id);

      await supabaseAdmin.from('sms_log').insert({
        user_id: targetUser.id,
        phone_number: from,
        message_type: 'opt_in',
        message_body: 'START',
        status: 'received',
      });

      return twimlResponse('Welcome back! You\'ll receive Chocka texts again. - Chocka');
    }

    // Log any other inbound messages for future reference
    await supabaseAdmin.from('sms_log').insert({
      user_id: targetUser.id,
      phone_number: from,
      message_type: 'inbound',
      message_body: body,
      status: 'received',
    });

    return twimlResponse('');
  } catch (err) {
    console.error('SMS webhook error:', err);
    return twimlResponse('');
  }
}

function twimlResponse(message: string): NextResponse {
  const twiml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}
