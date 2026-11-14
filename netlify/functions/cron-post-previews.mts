import { runCron, type ScheduledConfig } from '../shared/run-cron.mjs';

// Hourly at 40 past. Emails the 24-hour approval preview for a shop's first
// three posts, but ONLY when EARLY_POST_PREVIEW_EMAILS=on. While that is off
// (the default) the route counts what is due and sends nothing.
export default async () => runCron('post-previews');

export const config: ScheduledConfig = { schedule: '40 * * * *' };
