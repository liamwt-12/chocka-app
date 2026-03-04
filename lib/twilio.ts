const TWILIO_API = 'https://api.twilio.com/2010-04-01';

interface SendSMSParams {
  to: string;
  body: string;
}

export async function sendSMS({ to, body }: SendSMSParams): Promise<string | null> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_PHONE_NUMBER!;

  try {
    const res = await fetch(`${TWILIO_API}/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });

    if (!res.ok) {
      console.error('Twilio SMS failed:', await res.text());
      return null;
    }

    const data = await res.json();
    return data.sid;
  } catch (err) {
    console.error('Twilio SMS error:', err);
    return null;
  }
}

// Log SMS to database
export async function logSMS(
  supabaseAdmin: any,
  userId: string,
  phoneNumber: string,
  messageType: string,
  messageBody: string,
  twilioSid: string | null
) {
  await supabaseAdmin.from('sms_log').insert({
    user_id: userId,
    phone_number: phoneNumber,
    message_type: messageType,
    message_body: messageBody,
    twilio_sid: twilioSid,
    status: twilioSid ? 'sent' : 'failed',
  });
}
