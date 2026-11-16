import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { retentionEnabled, retentionSignals, retentionCsv, retentionOrder, THRESHOLDS, type RetentionFacts } from './retention';
import { markSeen } from './retention-data';

const F = (o: Partial<RetentionFacts> = {}): RetentionFacts => ({ connected: true, live: true, statusLabel: 'Live', invited: true, daysSinceInvited: 40, daysSinceJoined: 40, daysSinceSeen: 2, daysRecording: 60, managed: false, postsOn: true, repliesOn: true, scoreAtStart: 40, scoreNow: 61, changesMade: 3, ...o });
const keys = (o: Partial<RetentionFacts>) => retentionSignals(F(o)).signals.map((s) => s.key);

describe('the retention view is off by default', () => {
  it('only "on" switches it on', () => {
    expect(retentionEnabled({})).toBe(false);
    expect(retentionEnabled({ RETENTION_VIEW: 'true' })).toBe(false);
    expect(retentionEnabled({ RETENTION_VIEW: ' ON ' })).toBe(true);
  });
});

describe('signals are checkable facts', () => {
  it('a healthy shop has none', () => {
    expect(retentionSignals(F())).toEqual({ signals: [], risk: 'none' });
  });
  it('not connected: only once it has had a week, serious after two', () => {
    const nc = { connected: false, live: false, statusLabel: 'Not opened', daysSinceJoined: null };
    expect(keys({ ...nc, daysSinceInvited: THRESHOLDS.notConnectedDays - 1 })).toEqual([]);
    expect(retentionSignals(F({ ...nc, daysSinceInvited: 8 }))).toMatchObject({ risk: 'some', signals: [{ key: 'not_connected', serious: false }] });
    const late = retentionSignals(F({ ...nc, daysSinceInvited: 15 }));
    expect(late.risk).toBe('high');
    expect(late.signals[0].label).toBe('Invited 15 days ago, not connected (not opened)');
    expect(keys({ ...nc, invited: false, daysSinceInvited: null })).toEqual([]); // never invited is not a risk
  });
  it('connected but held is always serious', () => {
    expect(retentionSignals(F({ live: false, statusLabel: 'Check listing' }))).toMatchObject({ risk: 'high', signals: [{ key: 'held', label: 'Connected but not live: check listing' }] });
  });
  it('dashboard visits: never opened after a week, or quiet for a month', () => {
    expect(keys({ daysSinceSeen: null, daysSinceJoined: 3 })).toEqual([]);
    expect(keys({ daysSinceSeen: null })).toEqual(['never_opened']);
    // "Never" only counts from when visits began to be recorded, and never for a shop an operator looks after.
    expect(keys({ daysSinceSeen: null, daysRecording: 2 })).toEqual([]);
    expect(keys({ daysSinceSeen: null, daysRecording: null })).toEqual([]);
    expect(retentionSignals(F({ daysSinceSeen: null, daysRecording: 9 })).signals[0].label).toBe('Has not opened its dashboard in the 9 days visits have been recorded');
    expect(keys({ daysSinceSeen: null, managed: true })).toEqual([]);
    expect(keys({ daysSinceSeen: 90, managed: true })).toEqual([]);
    expect(keys({ daysSinceSeen: THRESHOLDS.quietDays - 1 })).toEqual([]);
    expect(keys({ daysSinceSeen: 45 })).toEqual(['gone_quiet']);
  });
  it('nothing on, no suggestion taken, no improvement', () => {
    expect(keys({ postsOn: false, repliesOn: false })).toEqual(['nothing_on']);
    expect(keys({ postsOn: false })).toEqual([]);
    expect(keys({ changesMade: 0 })).toEqual(['no_suggestions_taken']);
    expect(keys({ changesMade: 0, daysSinceJoined: 5 })).toEqual([]);
    expect(keys({ scoreNow: 40 })).toEqual(['no_improvement']);
    expect(keys({ scoreNow: 40, daysSinceJoined: 10 })).toEqual([]);
    expect(keys({ scoreNow: null })).toEqual([]); // not measured is not "no improvement"
  });
  it('three small signals together count as high', () => {
    expect(retentionSignals(F({ daysSinceSeen: 45, changesMade: 0, scoreNow: 40 })).risk).toBe('high');
  });
});

describe('the export', () => {
  const row = (o: any = {}) => ({ name: 'Floors A', town: 'Leeds', status: 'Live', joinedOn: '2026-10-01', lastSeenOn: null, postsOn: true, repliesOn: false, scoreAtStart: 40, scoreNow: 61, changesMade: 2, signals: ['One', 'Two'], risk: 'some' as const, ...o });
  it('has no contact details, in the columns or the loader\'s queries', () => {
    const csv = retentionCsv([row()]);
    expect(csv.split('\n')[0]).toBe('Shop,Town,Status,Joined,Dashboard last opened,Posts on,Replies on,Score at start,Score now,Changes made,At risk,Why');
    expect(csv).toContain('Floors A,Leeds,Live,2026-10-01,,yes,no,40,61,2,some,One; Two');
    const loader = readFileSync(new URL('./retention-data.ts', import.meta.url), 'utf8');
    expect(loader).not.toMatch(/contact_email|phone_number|\bemail\b(?! address)/);
  });
  it('a name cannot be read as a formula', () => {
    expect(retentionCsv([row({ name: '=cmd()', town: 'A, B' })])).toContain('"\'=cmd()","A, B"');
    expect(retentionCsv([row({ name: ' \t=cmd()' })])).toContain('"\' \t=cmd()"');
  });
  it('most at risk first', () => {
    expect(retentionOrder([row({ name: 'c', risk: 'none', signals: [] }), row({ name: 'b', risk: 'high' }), row({ name: 'a', risk: 'some' })]).map((r) => r.name)).toEqual(['b', 'a', 'c']);
  });
});

describe('the dashboard stamp', () => {
  const db = () => { const calls: any[] = []; return { calls, from: (t: string) => ({ update: (v: any) => ({ eq: async (_c: string, id: string) => { calls.push({ t, v, id }); return {}; } }) }) }; };
  const now = new Date('2026-12-01T12:00:00Z');
  it('writes once, then not again within the hour', async () => {
    const d = db();
    await markSeen(d, { id: 'u1', last_seen_at: null }, now);
    await markSeen(d, { id: 'u1', last_seen_at: '2026-12-01T11:30:00Z' }, now);
    await markSeen(d, { id: 'u1', last_seen_at: '2026-12-01T10:30:00Z' }, now);
    expect(d.calls).toHaveLength(2);
    expect(d.calls[0]).toEqual({ t: 'users', v: { last_seen_at: now.toISOString() }, id: 'u1' });
  });
  it('never throws, and is only called while the view is on', async () => {
    await expect(markSeen({ from: () => { throw new Error('down'); } }, { id: 'u1' }, now)).resolves.toBeUndefined();
    expect(readFileSync(new URL('../app/api/dashboard/route.ts', import.meta.url), 'utf8')).toMatch(/if \(retentionEnabled\(\)\) await markSeen\(/);
  });
});

describe('the loader', () => {
  it('reads the change log in pages and treats a failed read as an error, not as "no changes"', () => {
    const src = readFileSync(new URL('./retention-data.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/\.range\(from, from \+ PAGE - 1\)/);
    expect(src.match(/must\(await db\.from/g)!.length).toBe(3);
  });
});
