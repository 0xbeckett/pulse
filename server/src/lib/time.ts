/** UTC day key (YYYY-MM-DD) used to bucket the daily leaderboard. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
