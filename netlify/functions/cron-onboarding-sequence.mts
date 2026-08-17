import { runCron, type ScheduledConfig } from '../shared/run-cron.mjs';

// Daily. The sequence decides for itself which users are due a given step.
export default async () => runCron('onboarding-sequence');

export const config: ScheduledConfig = { schedule: '0 10 * * *' };
