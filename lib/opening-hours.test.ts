import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  fromGooglePeriods, toGooglePeriods, validateHoursDraft, samePeriods, describeHours, emptyDraft, DAYS,
  validateSpecialDays, toGoogleSpecialPeriods, fromGoogleSpecialPeriods,
} from './opening-hours';

const week = (open: Record<string, [string, string]>) => DAYS.map((day) => (open[day] ? { day, open: true, from: open[day][0], to: open[day][1] } : { day, open: false, from: '', to: '' }));

describe('there is no default week', () => {
  it('a listing with no hours reads as seven closed, empty days', () => {
    const r = fromGooglePeriods(undefined);
    expect(r.daysSet).toBe(0);
    expect(r.complex).toBe(false);
    expect(r.draft).toEqual(emptyDraft());
    expect(r.draft.every((d) => !d.open && d.from === '' && d.to === '')).toBe(true);
  });

  it('an empty week cannot be saved', () => {
    expect(validateHoursDraft(emptyDraft()).ok).toBe(false);
  });

  it('the audit route no longer invents hours', () => {
    const src = readFileSync(new URL('../app/api/audit/route.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/defaultHours/);
    expect(src).not.toMatch(/08:00|18:00|09:00|13:00/);
  });
});

describe('reading Google\'s hours', () => {
  it('reads TimeOfDay objects, with missing minutes meaning zero', () => {
    const r = fromGooglePeriods([{ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 17, minutes: 30 } }]);
    expect(r.draft[0]).toEqual({ day: 'MONDAY', open: true, from: '09:00', to: '17:30' });
    expect(r.daysSet).toBe(1);
  });

  it('reads the older "HH:MM" strings too', () => {
    expect(fromGooglePeriods([{ openDay: 'SATURDAY', openTime: '09:00', closeDay: 'SATURDAY', closeTime: '13:00' }]).draft[5]).toEqual({ day: 'SATURDAY', open: true, from: '09:00', to: '13:00' });
  });

  it.each([
    ['closed for lunch', [{ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 12 } }, { openDay: 'MONDAY', openTime: { hours: 13 }, closeDay: 'MONDAY', closeTime: { hours: 17 } }]],
    ['open past midnight', [{ openDay: 'FRIDAY', openTime: { hours: 18 }, closeDay: 'SATURDAY', closeTime: { hours: 2 } }]],
    ['open 24 hours', [{ openDay: 'MONDAY', openTime: { hours: 0 }, closeDay: 'MONDAY', closeTime: { hours: 24 } }]],
  ])('marks %s as too detailed to edit, so it is never overwritten', (_n, periods) => {
    expect(fromGooglePeriods(periods).complex).toBe(true);
  });
});

describe('what the shop types', () => {
  it('accepts a normal week and writes TimeOfDay objects, closed days absent', () => {
    const v = validateHoursDraft(week({ MONDAY: ['09:00', '17:30'], SATURDAY: ['10:00', '16:00'] }));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(toGooglePeriods(v.value)).toEqual([
      { openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 17, minutes: 30 } },
      { openDay: 'SATURDAY', openTime: { hours: 10 }, closeDay: 'SATURDAY', closeTime: { hours: 16 } },
    ]);
  });

  it.each([
    ['an open day with no times', week({ MONDAY: ['', ''] })],
    ['closing before opening', week({ MONDAY: ['17:00', '09:00'] })],
    ['nonsense times', week({ MONDAY: ['9am', '5pm'] })],
    ['six days', week({ MONDAY: ['09:00', '17:00'] }).slice(0, 6)],
    ['days in the wrong order', [...week({ MONDAY: ['09:00', '17:00'] })].reverse()],
    ['not a list', 'monday 9 to 5'],
  ])('refuses %s, with a sentence saying why', (_n, input) => {
    const v = validateHoursDraft(input);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.length).toBeGreaterThan(10);
  });

  it('ignores stray times on a day marked closed', () => {
    const d = week({ MONDAY: ['09:00', '17:00'] });
    d[1] = { day: 'TUESDAY', open: false, from: '08:00', to: '18:00' };
    const v = validateHoursDraft(d);
    expect(v.ok && v.value[1]).toEqual({ day: 'TUESDAY', open: false, from: '', to: '' });
  });

  it('round-trips: what is written reads back as the same week', () => {
    const v = validateHoursDraft(week({ MONDAY: ['09:00', '17:30'], TUESDAY: ['09:00', '17:30'], SUNDAY: ['10:00', '14:00'] }));
    if (!v.ok) throw new Error('should be valid');
    const periods = toGooglePeriods(v.value);
    expect(fromGooglePeriods(periods).draft).toEqual(v.value);
    expect(samePeriods(periods, JSON.parse(JSON.stringify(periods)))).toBe(true);
  });

  it('samePeriods notices a difference, and treats string and object times alike', () => {
    const a = [{ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 17 } }];
    expect(samePeriods(a, [{ openDay: 'MONDAY', openTime: '09:00', closeDay: 'MONDAY', closeTime: '17:00' }])).toBe(true);
    expect(samePeriods(a, [{ openDay: 'MONDAY', openTime: { hours: 8 }, closeDay: 'MONDAY', closeTime: { hours: 17 } }])).toBe(false);
    expect(samePeriods(a, [])).toBe(false);
  });

  it('describes the week in plain words', () => {
    const lines = describeHours(week({ MONDAY: ['09:00', '17:30'] }));
    expect(lines[0]).toBe('Monday 9:00 to 17:30');
    expect(lines[6]).toBe('Sunday closed');
  });
});

describe('holiday hours', () => {
  const today = '2026-12-01';
  it('accepts closed days and different hours, sorted by date', () => {
    const v = validateSpecialDays([{ date: '2026-12-26', open: false }, { date: '2026-12-24', open: true, from: '09:00', to: '13:00' }], today);
    expect(v.ok && v.value.map((d) => d.date)).toEqual(['2026-12-24', '2026-12-26']);
    if (v.ok) expect(toGoogleSpecialPeriods(v.value)).toEqual([
      { startDate: { year: 2026, month: 12, day: 24 }, endDate: { year: 2026, month: 12, day: 24 }, openTime: { hours: 9 }, closeTime: { hours: 13 } },
      { startDate: { year: 2026, month: 12, day: 26 }, endDate: { year: 2026, month: 12, day: 26 }, closed: true },
    ]);
  });
  it.each([
    ['a date in the past', [{ date: '2026-11-30', open: false }]],
    ['a date that does not exist', [{ date: '2026-02-30', open: false }]],
    ['the same date twice', [{ date: '2026-12-25', open: false }, { date: '2026-12-25', open: false }]],
    ['open with no times', [{ date: '2026-12-24', open: true }]],
  ])('refuses %s', (_n, input) => { expect(validateSpecialDays(input, today).ok).toBe(false); });
  it('reads Google\'s periods back, dropping past dates and flagging ranges it cannot show', () => {
    const r = fromGoogleSpecialPeriods([
      { startDate: { year: 2026, month: 11, day: 1 }, endDate: { year: 2026, month: 11, day: 1 }, closed: true },
      { startDate: { year: 2026, month: 12, day: 25 }, endDate: { year: 2026, month: 12, day: 25 }, closed: true },
      { startDate: { year: 2026, month: 12, day: 27 }, endDate: { year: 2026, month: 12, day: 30 }, closed: true },
    ], today);
    expect(r.days).toEqual([{ date: '2026-12-25', open: false, from: '', to: '' }]);
    expect(r.complex).toBe(true);
  });
});
