import { runCron, type ScheduledConfig } from '../shared/run-cron.mjs';

// Daily. New reviews should be surfaced the day they land, not weekly.
export default async () => runCron('review-alerts');

//
// Every 15 minutes from 08:00 to 18:45 UTC, not once at 09:00. One run reaches
// between 6 and 24 shops depending on how many have a new review to answer,
// and each run starts 6 further down the list, so the 44 runs in a day cover
// about 260 shops. Up to about 20 shops, every run reaches everyone and a new
// review is answered within a quarter of an hour; at 180, each shop is reached
// about every seven and a half hours, so the same working day.
// See docs/scale-check.md.
export const config: ScheduledConfig = { schedule: '*/15 8-18 * * *' };
