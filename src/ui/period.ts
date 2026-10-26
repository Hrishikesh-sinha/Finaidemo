// Plain-language labels for the periods the dashboard reports on, so a
// 30-day total and a forecast are never presented as the same period when
// they are not.

import type { DashboardStats } from '../types';

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// The rolling 30-day window is stale when nothing has been logged recently.
export function isStale(stats: DashboardStats): boolean {
  return Boolean(stats.reporting && !stats.reporting.complete && stats.reporting.data_through);
}

// What the forecast figure covers. It starts after the latest transaction, so
// when the log is up to date that is "the next 30 days"; when it is not, say
// which 30 days it really is.
export function forecastPeriod(stats: DashboardStats): string {
  if (isStale(stats) && stats.forecast_starts_after) {
    return `the 30 days after ${shortDate(stats.forecast_starts_after)}, your latest transaction`;
  }
  return 'the next 30 days';
}
