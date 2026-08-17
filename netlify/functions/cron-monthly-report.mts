import { runCron, type ScheduledConfig } from '../shared/run-cron.mjs';

// First of the month, reporting the month just ended.
export default async () => runCron('monthly-report');

export const config: ScheduledConfig = { schedule: '0 8 1 * *' };
