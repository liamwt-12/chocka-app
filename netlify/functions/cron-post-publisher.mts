import { runCron, type ScheduledConfig } from '../shared/run-cron.mjs';

// Every 15 minutes, which is what turns the jittered 3-hour posting window into
// twelve small runs instead of one large one. A run with nothing due is a single
// indexed query and costs nothing, so the frequency is cheap.
export default async () => runCron('post-publisher');

export const config: ScheduledConfig = { schedule: '*/15 * * * *' };
