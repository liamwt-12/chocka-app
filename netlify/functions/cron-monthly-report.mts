import { runCron, type ScheduledConfig } from '../shared/run-cron.mjs';

// First of the month, reporting the month just ended.
export default async () => runCron('monthly-report');

//
// Every five minutes from 08:00 to 11:55 UTC on the 1st and the 2nd, not once.
// One run sends about 12 reports before its time is up (each needs seven
// Google requests for the presence score). Each run sends to the shops not yet
// marked for the month and the next carries on; a run with nobody left costs
// two database reads. 48 runs on the 1st is room for about 570 shops, and the
// 2nd is there so that a bad morning on the 1st is not a missed month.
// Needs the migration 20261116120000_profile_monthly_report_marker.
// See docs/scale-check.md.
export const config: ScheduledConfig = { schedule: '*/5 8-11 1,2 * *' };
