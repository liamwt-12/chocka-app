import { runCron, type ScheduledConfig } from '../shared/run-cron.mjs';

// Hourly at 20 past. Each run works inside a time budget and only takes listings
// not synced in the last 20 hours, so a day's 24 runs cover every shop with room
// to spare, and a first-time 18-month history pull never blocks the others.
// Reads from Google and writes to our database only; it sends nothing.
export default async () => runCron('metrics-sync');

export const config: ScheduledConfig = { schedule: '20 * * * *' };
