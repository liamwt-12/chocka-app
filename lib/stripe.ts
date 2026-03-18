const STRIPE_API = 'https://api.stripe.com/v1';

function stripeHeaders() {
  return {
    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

// Create a Stripe customer
export async function createCustomer(email: string, name: string, metadata?: Record<string, string>) {
  const params = new URLSearchParams({ email, name });
  if (metadata) {
    Object.entries(metadata).forEach(([k, v]) => params.append(`metadata[${k}]`, v));
  }
  const res = await fetch(`${STRIPE_API}/customers`, {
    method: 'POST',
    headers: stripeHeaders(),
    body: params,
  });
  if (!res.ok) throw new Error(`Stripe create customer failed: ${await res.text()}`);
  return res.json();
}

// Create a Checkout Session
export async function createCheckoutSession(params: {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}) {
  const body = new URLSearchParams({
    'customer': params.customerId,
    'mode': 'subscription',
    'line_items[0][price]': params.priceId,
    'line_items[0][quantity]': '1',
    'success_url': params.successUrl,
    'cancel_url': params.cancelUrl,
    'allow_promotion_codes': 'true',
  });
  if (params.metadata) {
    Object.entries(params.metadata).forEach(([k, v]) => body.append(`metadata[${k}]`, v));
    Object.entries(params.metadata).forEach(([k, v]) => body.append(`subscription_data[metadata][${k}]`, v));
  }
  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: stripeHeaders(),
    body,
  });
  if (!res.ok) throw new Error(`Stripe checkout session failed: ${await res.text()}`);
  return res.json();
}

// Create a billing portal session
export async function createBillingPortalSession(customerId: string, returnUrl: string) {
  const res = await fetch(`${STRIPE_API}/billing_portal/sessions`, {
    method: 'POST',
    headers: stripeHeaders(),
    body: new URLSearchParams({ customer: customerId, return_url: returnUrl }),
  });
  if (!res.ok) throw new Error(`Stripe billing portal failed: ${await res.text()}`);
  return res.json();
}

// Cancel a subscription
export async function cancelSubscription(subscriptionId: string) {
  const res = await fetch(`${STRIPE_API}/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
    headers: stripeHeaders(),
  });
  if (!res.ok) throw new Error(`Stripe cancel subscription failed: ${await res.text()}`);
  return res.json();
}

// Verify Stripe webhook signature
export async function verifyWebhookSignature(payload: string, signature: string): Promise<any> {
  const crypto = await import('crypto');
  const secret = process.env.STRIPE_WEBHOOK_SECRET!;

  const elements = signature.split(',');
  const timestamp = elements.find(e => e.startsWith('t='))?.split('=')[1];
  const v1Signature = elements.find(e => e.startsWith('v1='))?.split('=')[1];

  if (!timestamp || !v1Signature) throw new Error('Invalid signature format');

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(v1Signature, 'hex')
  );
  if (!isValid) throw new Error('Signature mismatch');

  // Reject events older than 5 minutes
  if (Date.now() / 1000 - parseInt(timestamp) > 300) throw new Error('Webhook too old');

  return JSON.parse(payload);
}

// Get price ID from plan type
export function getPriceId(plan: 'monthly' | 'yearly'): string {
  return plan === 'yearly'
    ? process.env.STRIPE_YEARLY_PRICE_ID!
    : process.env.STRIPE_MONTHLY_PRICE_ID!;
}
