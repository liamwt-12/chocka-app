import { runCron, type ScheduledConfig } from '../shared/run-cron.mjs';

// Daily. New reviews should be surfaced the day they land, not weekly.
export default async () => runCron('review-alerts');

export const config: ScheduledConfig = { schedule: '0 9 * * *' };
