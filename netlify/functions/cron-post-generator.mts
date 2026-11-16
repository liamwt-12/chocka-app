import { runCron, type ScheduledConfig } from '../shared/run-cron.mjs';

// Friday, not Monday. The route schedules for the FOLLOWING Monday and emails
// the retailer a preview with a cancel link, so generating on a Friday gives
// them the weekend to read it and opt out before anything reaches Google.
export default async () => runCron('post-generator');

//
// Every five minutes from 09:00 to 12:55 UTC, not once. One run can write about
// six posts before its time is up (three seconds each, from the model), so a
// single run stopped being enough at around 17 shops. Each run writes what fits
// and the next carries on; a run with nothing left to do costs two database
// reads. 48 runs is room for roughly 280 shops. See docs/scale-check.md.
export const config: ScheduledConfig = { schedule: '*/5 9-12 * * 5' };
