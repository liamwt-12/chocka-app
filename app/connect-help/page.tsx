// Where a shop lands when signing in with Google did not finish.
//
// Every way that can happen (pressed Cancel, left a box unticked, used a Google
// account that does not manage the shop, Google did not answer) used to end in
// a dead end or a misleading message. This page says what happened in plain
// words, says nothing has changed, and offers one button that goes back to
// Google STILL CARRYING THE SHOP'S INVITE, so trying again actually works.
//
// It never mutates anything. The button is a plain link to the sign-in start,
// which is a GET that only redirects to Google.
import { getRequestTenant } from '@/lib/tenant-request';
import { supabaseAdmin } from '@/lib/supabase';
import { parseInviteRef } from '@/lib/invite-token';
import { HELP, isHelpReason } from '@/lib/connect-help';

async function shopFor(inviteRef: string | undefined): Promise<{ name: string; town: string | null } | null> {
  try {
    const id = parseInviteRef(inviteRef);
    if (!id) return null;
    const { data } = await supabaseAdmin.from('retailer_invites').select('retailers ( name, town )').eq('id', id).maybeSingle();
    const r: any = Array.isArray((data as any)?.retailers) ? (data as any).retailers[0] : (data as any)?.retailers;
    return r?.name ? { name: r.name, town: r.town ?? null } : null;
  } catch { return null; }
}

export default async function ConnectHelpPage({ searchParams }: { searchParams: { why?: string; invite?: string } }) {
  const tenant = getRequestTenant();
  const why = isHelpReason(searchParams.why) ? searchParams.why : 'unknown';
  const text = HELP[why];
  const inviteRef = parseInviteRef(searchParams.invite) ? searchParams.invite! : null;
  const shop = await shopFor(inviteRef ?? undefined);
  // With a valid invite reference the button restarts sign-in with the invite
  // attached. Without one, the only safe advice is the original link.
  const retry = inviteRef ? `/api/auth/callback/google?invite=${encodeURIComponent(inviteRef)}` : null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-extrabold text-brand mb-5 text-center" style={{ fontFamily: 'var(--hd)' }}>{tenant.brandName}</h1>
        <div className="bg-white/70 rounded-2xl p-6 mb-5 border border-black/5">
          {shop && <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">{shop.name}{shop.town ? `, ${shop.town}` : ''}</p>}
          <h2 className="text-xl font-bold text-charcoal mb-3">{text.title}</h2>
          <p className="text-base text-gray-700 mb-3">{text.what}</p>
          {text.next.map((line, i) => <p key={i} className="text-base text-gray-600 mb-3">{line}</p>)}
        </div>
        {retry ? (
          <a href={retry} className="block w-full text-center rounded-xl bg-brand text-white font-semibold text-lg py-4 no-underline">{text.button}</a>
        ) : (
          <p className="text-base text-gray-600 text-center">Open the link in your invitation again to have another go.</p>
        )}
        <p className="text-sm text-gray-500 mt-5 text-center">
          Stuck? Email <a className="underline" href={`mailto:${tenant.supportEmail}`}>{tenant.supportEmail}</a>{tenant.fundedBy ? ` or ask your ${tenant.fundedBy} rep` : ''}. Tell us the name of your shop and we will help.
        </p>
      </div>
    </div>
  );
}
