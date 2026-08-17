import { runCron, type ScheduledConfig } from '../shared/run-cron.mjs';

// Friday, not Monday. The route schedules for the FOLLOWING Monday and emails
// the retailer a preview with a cancel link, so generating on a Friday gives
// them the weekend to read it and opt out before anything reaches Google.
export default async () => runCron('post-generator');

export const config: ScheduledConfig = { schedule: '0 9 * * 5' };
