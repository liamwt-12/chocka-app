import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BANK_HOLIDAYS, upcomingBankHolidays, holidayPrompt, datesCovered } from './bank-holidays';

describe('the list', () => {
  it('is in date order, with real dates, and none on a weekend', () => {
    const dates = BANK_HOLIDAYS.map((h) => h.date);
    expect([...dates].sort()).toEqual(dates);
    for (const d of dates) {
      const day = new Date(`${d}T12:00:00Z`);
      expect(day.toISOString().slice(0, 10)).toBe(d);
      expect([0, 6]).not.toContain(day.getUTCDay());
    }
  });
  it('has eight days in each full year', () => {
    for (const y of ['2027', '2028']) expect(BANK_HOLIDAYS.filter((h) => h.date.startsWith(y))).toHaveLength(8);
  });
  it('Good Friday and Easter Monday are three days apart, in spring', () => {
    for (const y of ['2027', '2028']) {
      const gf = BANK_HOLIDAYS.find((h) => h.date.startsWith(y) && h.name === 'Good Friday')!, em = BANK_HOLIDAYS.find((h) => h.date.startsWith(y) && h.name === 'Easter Monday')!;
      expect((Date.parse(em.date) - Date.parse(gf.date)) / 86_400_000).toBe(3);
      expect(new Date(`${gf.date}T12:00:00Z`).getUTCDay()).toBe(5);
    }
  });
  it('still reaches at least six months ahead (top the list up when this fails)', () => {
    const last = BANK_HOLIDAYS[BANK_HOLIDAYS.length - 1].date;
    expect(Date.parse(last) - Date.now()).toBeGreaterThan(183 * 86_400_000);
  });
});

describe('the prompt', () => {
  it('asks about Christmas from late November, and names the days', () => {
    expect(holidayPrompt('2026-11-16', new Set())).toBeNull(); // more than five weeks out
    const p = holidayPrompt('2026-11-25', new Set())!;
    expect(p.days.map((d) => d.date)).toEqual(['2026-12-25', '2026-12-28']);
    expect(p.title).toBe('Bank holidays are coming up');
    expect(p.message).toMatch(/Christmas Day \(Fri 25 Dec\) and Boxing Day \(Mon 28 Dec\)/);
    expect(p.message).toMatch(/normal opening hours/);
  });
  it('says nothing once the shop has dealt with every day', () => {
    expect(holidayPrompt('2026-12-01', new Set(['2026-12-25', '2026-12-28', '2027-01-01']))).toBeNull();
    expect(holidayPrompt('2026-12-01', new Set(['2026-12-25']))!.days.map((d) => d.date)).toEqual(['2026-12-28', '2027-01-01']);
  });
  it('a range of days on the listing covers every day in it', () => {
    const covered = datesCovered([{ startDate: { year: 2026, month: 12, day: 24 }, endDate: { year: 2027, month: 1, day: 2 }, closed: true }]);
    expect(covered.has('2026-12-25') && covered.has('2026-12-28') && covered.has('2027-01-01')).toBe(true);
    expect(holidayPrompt('2026-12-01', covered)).toBeNull();
    expect(datesCovered(undefined).size).toBe(0);
  });
  it('is quiet in a stretch with no bank holiday', () => {
    expect(upcomingBankHolidays('2027-06-10')).toEqual([]);
  });
  it('only ever appears on the dashboard: nothing sends it', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    for (const f of ['./email.ts', './twilio.ts', '../app/api/cron/monday-stats/route.ts', '../app/api/cron/monthly-report/route.ts']) expect(src(f)).not.toMatch(/bank-holidays|holidayPrompt/);
  });
});
