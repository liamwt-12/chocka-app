import { describe, it, expect } from 'vitest';
import { invitationDecision, partitionInvitations, type Invitation } from './gbp-invitations';

// This decides what we take control of on a real business's Google presence, so
// the cases below are weighted towards proving it does NOT accept. Every
// ambiguous, malformed or unfamiliar input must resolve to 'hold'.

const managerInvite: Invitation = {
  name: 'accounts/111/invitations/222',
  role: 'MANAGER',
  targetType: 'LOCATIONS_ONLY',
  targetLocation: { locationName: 'Oakfield Flooring', address: 'Harrogate' },
};

describe('invitationDecision — the accept path', () => {
  it('accepts a MANAGER invitation to a single location', () => {
    const d = invitationDecision(managerInvite);
    expect(d.action).toBe('accept');
    expect(d.label).toBe('Oakfield Flooring');
  });

  it('accepts SITE_MANAGER too', () => {
    expect(invitationDecision({ ...managerInvite, role: 'SITE_MANAGER' }).action).toBe('accept');
  });

  it('is case-insensitive about the role and target type Google sends', () => {
    const d = invitationDecision({ ...managerInvite, role: 'manager', targetType: 'locations_only' });
    expect(d.action).toBe('accept');
  });

  it('gives a reason even when accepting, so the log is an audit trail', () => {
    expect(invitationDecision(managerInvite).reason).toBeTruthy();
  });
});

describe('invitationDecision — ownership is never automatic', () => {
  // The load-bearing rule. The pitch, the terms, the retailer page and the rep
  // field guide all promise the retailer stays the owner. A retailer picking the
  // wrong role on a screen they have never opened before must not be able to
  // hand us their business by accident.
  it('NEVER accepts OWNER', () => {
    const d = invitationDecision({ ...managerInvite, role: 'OWNER' });
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('ownership');
  });

  it('NEVER accepts PRIMARY_OWNER', () => {
    const d = invitationDecision({ ...managerInvite, role: 'PRIMARY_OWNER' });
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('ownership');
  });

  it('reports ownership as the reason even when the target type is also wrong', () => {
    // Two problems at once should surface the alarming one, not the procedural one.
    const d = invitationDecision({ ...managerInvite, role: 'OWNER', targetType: 'ACCOUNTS_ONLY' });
    expect(d.reason).toContain('ownership');
  });
});

describe('invitationDecision — everything else holds', () => {
  it('holds an account-level invitation', () => {
    const d = invitationDecision({ ...managerInvite, targetType: 'ACCOUNTS_ONLY' });
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('account-level');
  });

  it('holds roles that cannot do the work', () => {
    for (const role of ['STAFF', 'SITE_MANAGER_LIMITED', 'ADMIN_ROLE_UNSPECIFIED']) {
      expect(invitationDecision({ ...managerInvite, role }).action).toBe('hold');
    }
  });

  it('holds a role Google has not told us about yet', () => {
    expect(invitationDecision({ ...managerInvite, role: 'SOME_NEW_ROLE_2027' }).action).toBe('hold');
  });

  it('holds an invitation with no resource name — there is nothing to accept', () => {
    const d = invitationDecision({ ...managerInvite, name: undefined });
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('resource name');
  });

  it('holds on missing, null and empty input rather than throwing', () => {
    expect(invitationDecision(null).action).toBe('hold');
    expect(invitationDecision(undefined).action).toBe('hold');
    expect(invitationDecision({}).action).toBe('hold');
  });

  it('holds when the role or target type is missing entirely', () => {
    expect(invitationDecision({ name: 'accounts/1/invitations/2' }).action).toBe('hold');
    expect(
      invitationDecision({ name: 'accounts/1/invitations/2', targetType: 'LOCATIONS_ONLY' }).action,
    ).toBe('hold');
  });

  it('always produces some label, so a held invitation is identifiable', () => {
    expect(invitationDecision({}).label).toBeTruthy();
    expect(invitationDecision({ name: 'accounts/1/invitations/2' }).label).toBe(
      'accounts/1/invitations/2',
    );
    expect(
      invitationDecision({ name: 'x', targetLocation: { address: '12 High St' } }).label,
    ).toBe('12 High St');
  });
});

describe('partitionInvitations', () => {
  it('splits a mixed batch and keeps the held ones', () => {
    const p = partitionInvitations([
      managerInvite,
      { ...managerInvite, name: 'accounts/111/invitations/333', role: 'OWNER' },
      { ...managerInvite, name: 'accounts/111/invitations/444', targetType: 'ACCOUNTS_ONLY' },
    ]);
    expect(p.accept).toHaveLength(1);
    // Held, not dropped: a shop whose rep picked the wrong role is a shop still
    // waiting to be activated.
    expect(p.hold).toHaveLength(2);
  });

  it('handles null and empty input', () => {
    expect(partitionInvitations(null).accept).toHaveLength(0);
    expect(partitionInvitations([]).hold).toHaveLength(0);
    expect(partitionInvitations([null, undefined]).hold).toHaveLength(2);
  });

  it('accepts nothing at all from a batch of only bad invitations', () => {
    const p = partitionInvitations([
      { role: 'OWNER', targetType: 'LOCATIONS_ONLY', name: 'a' },
      { role: 'STAFF', targetType: 'LOCATIONS_ONLY', name: 'b' },
      { role: 'MANAGER', targetType: 'ACCOUNTS_ONLY', name: 'c' },
    ]);
    expect(p.accept).toHaveLength(0);
    expect(p.hold).toHaveLength(3);
  });
});
