import { runCron, type ScheduledConfig } from '../shared/run-cron.mjs';

// Monday early, ahead of the posting window, so the week's stats SMS does not
// arrive interleaved with publish notifications.
//
// NOTE: this route is the heaviest of the six by request count — it costs one
// token refresh plus FIVE Performance API calls per profile, so 180 retailers is
// ~1,080 Google requests in one sequential run. That does not fit a function
// timeout and is the next thing to batch. See FOLLOWUPS.md.
export default async () => runCron('monday-stats');

export const config: ScheduledConfig = { schedule: '0 8 * * 1' };
