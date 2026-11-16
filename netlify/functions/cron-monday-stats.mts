import { runCron, type ScheduledConfig } from '../shared/run-cron.mjs';

// Monday early, ahead of the posting window, so the week's stats SMS does not
// arrive interleaved with publish notifications.
//
// NOTE: this route is the heaviest of the six by request count — it costs one
// token refresh plus FIVE Performance API calls per profile, so 180 retailers is
// ~1,080 Google requests in one sequential run. That does not fit a function
// timeout and is the next thing to batch. See FOLLOWUPS.md.
export default async () => runCron('monday-stats');

//
// Every five minutes from 08:00 to 10:55 UTC, not once: one run reaches about 14
// shops before its time is up. Each run texts the shops not yet done this week
// and the next carries on. 36 runs is room for roughly 500 shops.
export const config: ScheduledConfig = { schedule: '*/5 8-10 * * 1' };
