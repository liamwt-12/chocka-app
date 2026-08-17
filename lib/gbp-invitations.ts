/**
 * Which Google Business Profile invitations we accept automatically, and which
 * a human has to look at.
 *
 * WHY THIS EXISTS
 * Route 1 — the activation method the Stellar deck leads with — is a rep sitting
 * with a retailer and adding Stellar as a manager of their listing, "the same
 * way they would add a member of staff". Google turns that into an *invitation*
 * addressed to the Stellar account, which has to be accepted before we can do
 * anything. With no code for it, accepting is a human clicking in the Google UI,
 * once per shop, up to 180 times.
 *
 * THE RULE THAT MATTERS: WE NEVER AUTO-ACCEPT OWNERSHIP
 * The single most load-bearing promise in the pitch, repeated in the terms, the
 * retailer page and the rep field guide, is this:
 *
 *     "You stay the owner. We are a manager, like a member of staff,
 *      and you can remove us anytime in two taps."
 *
 * An OWNER or PRIMARY_OWNER invitation is an ownership transfer. If a retailer
 * picks the wrong role in the Google UI — which is an easy thing to do while a
 * rep is talking them through a screen they have never opened — blanket-accepting
 * would take ownership of a real business's Google presence, silently, while our
 * own terms said we had not. That is not a bug to fix afterwards; the retailer
 * has to go and get their own listing back.
 *
 * So the default is HOLD, and only the two roles that mean "manager" are
 * accepted. Everything else is surfaced for a person to look at.
 *
 * The same reasoning rules out account-level invitations. ACCOUNTS_ONLY grants a
 * role over every location under an account, present and future. The rep flow
 * produces a single-location invitation; an account-level one means something
 * else happened, and "something else happened" is not a thing to accept
 * automatically.
 */

/** Shape we care about from the Invitation resource. Fields are optional because Google may omit any of them. */
export interface Invitation {
  /** `accounts/{account}/invitations/{invitation}` — required to act on it at all. */
  name?: string | null;
  /** AdminRole: PRIMARY_OWNER | OWNER | MANAGER | SITE_MANAGER | SITE_MANAGER_LIMITED | STAFF | ADMIN_ROLE_UNSPECIFIED */
  role?: string | null;
  /** TargetType: ACCOUNTS_ONLY | LOCATIONS_ONLY | TARGET_TYPE_UNSPECIFIED */
  targetType?: string | null;
  targetLocation?: { locationName?: string | null; address?: string | null } | null;
}

export type InvitationAction = 'accept' | 'hold';

export interface InvitationDecision {
  action: InvitationAction;
  /** Always populated, including on accept — the log line is the audit trail. */
  reason: string;
  /** Best available human label for the shop, for the log and any operator view. */
  label: string;
}

/**
 * The only two roles that mean "manager, like a member of staff".
 *
 * SITE_MANAGER_LIMITED and STAFF are deliberately absent: they cannot do the
 * work (posting, replying, editing the profile), so accepting one would produce
 * a connected-looking retailer whose automation then fails on every write.
 * Better to hold it and have someone ask for the right role.
 */
const ACCEPTABLE_ROLES = new Set(['MANAGER', 'SITE_MANAGER']);

/** Roles that would make us the owner. Never automatic, under any circumstances. */
const OWNERSHIP_ROLES = new Set(['PRIMARY_OWNER', 'OWNER']);

export function invitationDecision(inv: Invitation | null | undefined): InvitationDecision {
  const label =
    inv?.targetLocation?.locationName ||
    inv?.targetLocation?.address ||
    inv?.name ||
    '(unidentified invitation)';

  if (!inv) return { action: 'hold', reason: 'no invitation', label };

  // Without a resource name there is nothing to POST to, so this cannot be
  // accepted even if we wanted to. Held rather than dropped so it still shows up.
  if (!inv.name) {
    return { action: 'hold', reason: 'invitation has no resource name', label };
  }

  const role = (inv.role || '').toUpperCase();
  const targetType = (inv.targetType || '').toUpperCase();

  // Ownership is checked BEFORE target type, so the reason a person reads is the
  // alarming one. An OWNER invitation is worth noticing whatever its target.
  if (OWNERSHIP_ROLES.has(role)) {
    return {
      action: 'hold',
      reason:
        `role ${role} would transfer ownership — never accepted automatically. ` +
        `We promise the retailer stays the owner. Ask them to re-send as Manager.`,
      label,
    };
  }

  if (targetType !== 'LOCATIONS_ONLY') {
    return {
      action: 'hold',
      reason:
        `target type ${targetType || '(none)'} is not a single location — an ` +
        `account-level invitation grants a role over every location under it, ` +
        `now and in future.`,
      label,
    };
  }

  if (!ACCEPTABLE_ROLES.has(role)) {
    return {
      action: 'hold',
      reason:
        `role ${role || '(none)'} is not a management role we can work with. ` +
        `Posting, replying and profile edits all need MANAGER or SITE_MANAGER.`,
      label,
    };
  }

  return { action: 'accept', reason: `role ${role} on a single location`, label };
}

export interface PartitionedInvitations {
  accept: Array<{ invitation: Invitation; decision: InvitationDecision }>;
  hold: Array<{ invitation: Invitation; decision: InvitationDecision }>;
}

/**
 * Split a batch into what may be accepted automatically and what a person needs
 * to see. Held invitations are returned rather than discarded — a shop whose rep
 * chose the wrong role is a shop waiting to be activated, and dropping it on the
 * floor is how it becomes invisible.
 */
export function partitionInvitations(
  invitations: Array<Invitation | null | undefined> | null | undefined,
): PartitionedInvitations {
  const out: PartitionedInvitations = { accept: [], hold: [] };
  for (const inv of invitations || []) {
    const decision = invitationDecision(inv);
    const entry = { invitation: (inv || {}) as Invitation, decision };
    if (decision.action === 'accept') out.accept.push(entry);
    else out.hold.push(entry);
  }
  return out;
}
