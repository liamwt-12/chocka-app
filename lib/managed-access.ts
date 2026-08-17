/**
 * Whose Google credential do we act with, for this user?
 *
 * Two shapes of account exist now:
 *
 *   SELF-MANAGED — the retailer (or tradesperson) did the OAuth consent
 *   themselves, so their own row holds the refresh token. Every Chocka user and
 *   every Route 2 retailer.
 *
 *   MANAGED — Route 1. A rep added Stellar as a manager of the retailer's
 *   listing in the retailer's own Google screen. The retailer never consented to
 *   anything in our app, so their row holds NO token; the credential belongs to
 *   the operator account named by `managed_by_user_id`.
 *
 * THE TRAP THIS FUNCTION EXISTS TO CLOSE
 * Stored tokens are encrypted with additional authenticated data bound to the
 * row they live on (`userTokenAad(user.id)` — see lib/secrets.ts). So when the
 * ciphertext comes from the *manager's* row, the AAD must be the MANAGER's id,
 * not the retailer's. Decrypting a manager's token under the retailer's AAD
 * fails — correctly, that is the whole point of AAD — but it fails at the
 * decryption step, which reads like a corrupt secret rather than like a wiring
 * mistake, and it would do so once per retailer across the whole estate.
 *
 * Hence: this returns the ciphertext and the id to bind it with, together, as
 * one answer. Callers never pick an AAD themselves. Getting them apart is the
 * bug, so they are not available apart.
 *
 * PRECEDENCE: SELF WINS.
 * A retailer who was activated by a rep and later connects their own Google
 * account has a token of their own, and it is more direct, more revocable by
 * them, and survives the operator account being rotated. So a present self token
 * is always preferred, and `managed_by_user_id` becomes a historical note rather
 * than something to unwind.
 */

export interface ManagerRow {
  id?: string | null;
  google_refresh_token?: string | null;
  token_status?: string | null;
}

export interface ManagedAccessRow {
  id?: string | null;
  google_refresh_token?: string | null;
  token_status?: string | null;
  managed_by_user_id?: string | null;
  /**
   * The manager row, embedded by the query as
   * `manager:managed_by_user_id ( id, google_refresh_token, token_status )`.
   * Absent when the caller did not ask for it — which is treated as "no manager
   * access available", never as "manager is fine".
   */
  manager?: ManagerRow | ManagerRow[] | null;
}

/**
 * A discriminated union rather than a bag of nullable fields, so that
 * `if (!access.ok) return;` narrows the rest to non-null. The alternative
 * invites `!` assertions at every call site, and a `!` on a decryption input is
 * exactly where a wrong answer stops being a type error and starts being a
 * runtime failure across the estate.
 */
export type ResolvedAccess =
  | {
      ok: true;
      /** Ciphertext to hand to decryptSecret. */
      encryptedToken: string;
      /** The id to build the AAD from — the row the ciphertext actually lives on. */
      aadUserId: string;
      via: 'self' | 'manager';
      reason: string;
    }
  | {
      ok: false;
      encryptedToken: null;
      aadUserId: null;
      via: null;
      /** Always populated, so a log line explains itself. */
      reason: string;
    };

/** A token we are willing to try. 'invalid' and 'offboarded' are not. */
function usableStatus(status: string | null | undefined): boolean {
  return status === 'valid';
}

/**
 * PostgREST returns an embedded to-one relationship as an object, but returns an
 * array when it cannot prove the relationship is to-one. Both shapes are
 * accepted rather than assuming one, because guessing wrong here degrades to
 * "no manager", which silently disables every managed retailer at once.
 */
function firstManager(manager: ManagedAccessRow['manager']): ManagerRow | null {
  if (!manager) return null;
  if (Array.isArray(manager)) return manager[0] ?? null;
  return manager;
}

export function resolveAccess(user: ManagedAccessRow | null | undefined): ResolvedAccess {
  const deny = (reason: string): ResolvedAccess => ({
    ok: false,
    encryptedToken: null,
    aadUserId: null,
    via: null,
    reason,
  });

  if (!user) return deny('no user row');
  if (!user.id) return deny('user row has no id, so no AAD can be built');

  // Self first — see PRECEDENCE above.
  if (user.google_refresh_token) {
    if (!usableStatus(user.token_status)) {
      // Deliberately NOT falling through to the manager. A self-managed user
      // whose token went bad needs to reconnect; quietly acting on their listing
      // with somebody else's credential is not a repair, it is a substitution
      // they never agreed to.
      return deny(
        `own token is present but token_status=${user.token_status ?? '(none)'} — needs reconnect, ` +
          `and a manager credential is not a substitute for consent the user gave themselves`,
      );
    }
    return {
      ok: true,
      encryptedToken: user.google_refresh_token,
      aadUserId: user.id,
      via: 'self',
      reason: 'own token',
    };
  }

  if (!user.managed_by_user_id) {
    return deny('no own token and no manager — this account has no Google access at all');
  }

  const manager = firstManager(user.manager);
  if (!manager) {
    return deny(
      `managed by ${user.managed_by_user_id} but the manager row was not loaded — ` +
        `the query must embed manager:managed_by_user_id ( id, google_refresh_token, token_status )`,
    );
  }
  if (!manager.id) return deny('manager row has no id, so no AAD can be built');
  if (!manager.google_refresh_token) {
    return deny(`manager ${manager.id} holds no token`);
  }
  if (!usableStatus(manager.token_status)) {
    // Worth shouting about: one manager going bad takes out every retailer
    // underneath it at once, which is a fleet-wide outage wearing the costume of
    // a per-retailer problem.
    return deny(
      `manager ${manager.id} has token_status=${manager.token_status ?? '(none)'} — ` +
        `every retailer managed by this account is affected, not just this one`,
    );
  }

  return {
    ok: true,
    encryptedToken: manager.google_refresh_token,
    // The manager's id, NOT the user's. See the trap described at the top.
    aadUserId: manager.id,
    via: 'manager',
    reason: `token borrowed from manager ${manager.id}`,
  };
}

/**
 * The embed every query needs in order for resolveAccess to work.
 *
 * Exported as a constant so the three-part string cannot drift between the six
 * or so call sites that need it. A query that forgets it does not error — it
 * returns rows whose `manager` is undefined, which resolveAccess correctly
 * refuses, so the failure is loud but the cause is one level removed. Sharing
 * the string removes the chance entirely.
 */
export const MANAGER_EMBED = 'manager:managed_by_user_id ( id, google_refresh_token, token_status )';
