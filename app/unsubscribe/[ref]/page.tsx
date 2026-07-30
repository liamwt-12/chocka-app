// Unsubscribe landing page.
//
// GET CONFIRMS, POST ACTS — the same rule as the invite accept route, for the same
// reason: mail scanners, link previewers and corporate security filters fetch every
// URL in an email. If a GET performed the unsubscribe, a scanner would silently opt
// retailers out of mail they never chose to leave, and we would never know.
//
// The ref carries a signed retailer id, never an email address. So the URL cannot be
// edited to opt out somebody else, and it does not leak an address into browser
// history, server logs or a shared screen.
import { getRequestTenant } from '@/lib/tenant-request';
import { supabaseAdmin } from '@/lib/supabase';
import { parseUnsubscribeRef } from '@/lib/invite-token';
import Button from '@/components/Button';

function Shell({ children }: { children: React.ReactNode }) {
  const tenant = getRequestTenant();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-extrabold text-brand mb-6" style={{ fontFamily: 'var(--hd)' }}>
          {tenant.brandName}
        </h1>
        {children}
      </div>
    </div>
  );
}

/** Show enough of an address to be recognisable without printing it in full. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  const head = local.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: { ref: string };
  searchParams: { done?: string };
}) {
  const tenant = getRequestTenant();
  const retailerId = parseUnsubscribeRef(params.ref);

  if (!retailerId) {
    return (
      <Shell>
        <div className="bg-white/60 rounded-2xl p-8 border border-black/5">
          <h2 className="text-xl font-bold text-charcoal mb-3">This link is not valid</h2>
          <p className="text-sm text-gray-500">
            The address may be incomplete. Reply to the email you received and we will remove you by
            hand.
          </p>
        </div>
      </Shell>
    );
  }

  const { data: retailer } = await supabaseAdmin
    .from('retailers')
    .select('id,name,contact_email')
    .eq('id', retailerId)
    .maybeSingle();

  if (!retailer?.contact_email) {
    return (
      <Shell>
        <div className="bg-white/60 rounded-2xl p-8 border border-black/5">
          <h2 className="text-xl font-bold text-charcoal mb-3">Nothing to remove</h2>
          <p className="text-sm text-gray-500">We have no email address on file for this listing.</p>
        </div>
      </Shell>
    );
  }

  // Already suppressed, or just now — same message either way, so a second visit
  // reassures rather than confusing.
  const { data: existing } = await supabaseAdmin
    .from('email_suppressions')
    .select('id')
    .eq('email', retailer.contact_email.toLowerCase())
    .maybeSingle();

  if (searchParams?.done === '1' || existing) {
    return (
      <Shell>
        <div className="bg-brand-light rounded-2xl p-8">
          <h2 className="text-xl font-bold text-charcoal mb-3">You're removed</h2>
          <p className="text-sm text-gray-500">
            {maskEmail(retailer.contact_email)} won't receive any more email from {tenant.brandName}.
            Nothing else is needed.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="bg-white/60 rounded-2xl p-8 mb-6 border border-black/5">
        <h2 className="text-xl font-bold text-charcoal mb-3">Stop emails from {tenant.brandName}?</h2>
        <p className="text-sm text-gray-500 mb-1">
          This removes <strong>{maskEmail(retailer.contact_email)}</strong> from our list.
        </p>
        <p className="text-sm text-gray-500">You won't hear from us again.</p>
      </div>

      <form action="/api/unsubscribe" method="post">
        <input type="hidden" name="ref" value={params.ref} />
        <Button type="submit" size="lg" className="w-full">
          Yes, remove me
        </Button>
      </form>
    </Shell>
  );
}
