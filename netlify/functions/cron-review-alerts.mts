import { runCron, type ScheduledConfig } from '../shared/run-cron.mjs';

// Daily. New reviews should be surfaced the day they land, not weekly.
export default async () => runCron('review-alerts');

//
// Every half hour from 08:00 to 18:30 UTC, not once at 09:00. One run reaches
// 12 to 24 shops, and each run starts 12 further down the list, so the 22 runs
// in a day cover about 260 shops. It also means a new review is answered
// within the hour instead of the next morning. See docs/scale-check.md.
export const config: ScheduledConfig = { schedule: '*/30 8-18 * * *' };
