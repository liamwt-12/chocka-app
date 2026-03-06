import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const from = formData.get('From') as string;
    const body = (formData.get('Body') as string || '').trim().toUpperCase();
    if (body === 'STOP') {
      await supabaseAdmin.from('users').update({ sms_enabled: false }).eq('phone_number', from);
    } else if (body === 'START') {
      await supabaseAdmin.from('users').update({ sms_enabled: true }).eq('phone_number', from);
    }
    return new NextResponse('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
  } catch (err) {
    console.error('SMS webhook error:', err);
    return new NextResponse('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
  }
}
