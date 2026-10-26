// One definition of the dashboard's reporting figures, used by /api/dashboard,
// the AI insights and monthly report, and the chat assistant, so every place
// that shows "spent in the last 30 days" shows the same number.
//
// Window:      the 30 days ending now (rolling), [now - 30 d, now].
// Spent:       sum of transactions dated inside the window.
// Savings rate: (monthly income - spent) / monthly income. The 30-day window is
//              treated as one month of income.
// Coverage:    the date of the latest transaction. When nothing has been logged
//              for a while, the window contains days with no entries and the
//              figures above are understated; `reporting.complete` says so and
//              the UI labels it rather than presenting the numbers as complete.

import { detectAnomalies } from './anomaly';
import type { StoredTransaction, StoredUser } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
export const REPORTING_WINDOW_DAYS = 30;
// A gap longer than this between the latest entry and today is reported.
export const STALE_AFTER_DAYS = 7;

export interface ReportingWindow {
  window_days: number;
  window_start: string;
  window_end: string;
  // Latest transaction on record (any date up to now), or null.
  data_through: string | null;
  // Whole days between the latest transaction and now.
  days_since_last_entry: number | null;
  // Days of the window after the latest entry, i.e. with nothing logged.
  unlogged_days_in_window: number;
  complete: boolean;
}

export interface ReportingSummary {
  reporting: ReportingWindow;
  monthly_income: number;
  target_savings_percent: number;
  total_spent: number;
  savings: number;
  savings_rate: number;
  health_score: number;
  health_components: { savings: number; expense_ratio: number; budget: number; stability: number };
  category_breakdown: Record<string, number>;
  smart_budget: Record<string, number>;
  anomalies: StoredTransaction[];
  recent_anomaly_count: number;
  transaction_count_in_window: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarize(user: StoredUser, userTxs: StoredTransaction[], now: number = Date.now()): ReportingSummary {
  const windowStart = now - REPORTING_WINDOW_DAYS * DAY_MS;
  const valid = userTxs.filter(t => Number.isFinite(new Date(t.date).getTime()));
  const past = valid.filter(t => new Date(t.date).getTime() <= now);
  const inWindow = past.filter(t => new Date(t.date).getTime() >= windowStart);

  const latest = past.length ? Math.max(...past.map(t => new Date(t.date).getTime())) : null;
  const daysSince = latest === null ? null : Math.floor((now - latest) / DAY_MS);
  const unlogged = latest === null ? REPORTING_WINDOW_DAYS : Math.min(REPORTING_WINDOW_DAYS, Math.max(0, daysSince!));

  const totalSpent = round2(inWindow.reduce((s, t) => s + t.amount, 0));
  const income = Math.max(user.monthly_income, 1.0);
  const savings = round2(user.monthly_income - totalSpent);
  const savingsRate = ((income - totalSpent) / income) * 100;

  // Health score: the dashboard's existing formula, unchanged.
  const anomalies = detectAnomalies(past);
  const recentAnomalies = anomalies.filter(a => new Date(a.date).getTime() >= windowStart);
  const savingsScore = savingsRate > 0 ? Math.min(30, Math.max(0, (savingsRate / 20.0) * 30)) : 0;
  const expenseRatio = totalSpent / income;
  const expenseScore = expenseRatio <= 0.7 ? 25 : Math.max(0, 25 - ((expenseRatio - 0.7) / 0.3) * 25);
  const budgetScore = totalSpent <= income ? 25 : 0;
  const stabilityScore = Math.max(0, 20 - recentAnomalies.length * 5);
  const healthScore = Math.min(100, Math.max(0, Math.round(savingsScore + expenseScore + budgetScore + stabilityScore)));

  const categoryBreakdown: Record<string, number> = {};
  for (const t of inWindow) categoryBreakdown[t.category] = round2((categoryBreakdown[t.category] || 0) + t.amount);

  // Smart budget: the dashboard's existing formula, unchanged.
  const needsSpent = inWindow.filter(t => ['Bills', 'Food', 'Transport'].includes(t.category)).reduce((s, t) => s + t.amount, 0);
  const wantsSpent = inWindow.filter(t => ['Shopping', 'Entertainment'].includes(t.category)).reduce((s, t) => s + t.amount, 0);
  const recommendedNeeds = Math.max(income * 0.4, Math.min(income * 0.6, (needsSpent / Math.max(1, totalSpent)) * income));
  const recommendedWants = Math.max(income * 0.2, Math.min(income * 0.4, (wantsSpent / Math.max(1, totalSpent)) * income));
  const recommendedSavings = Math.max(0, income - recommendedNeeds - recommendedWants);

  return {
    reporting: {
      window_days: REPORTING_WINDOW_DAYS,
      window_start: new Date(windowStart).toISOString(),
      window_end: new Date(now).toISOString(),
      data_through: latest === null ? null : new Date(latest).toISOString(),
      days_since_last_entry: daysSince,
      unlogged_days_in_window: unlogged,
      complete: latest !== null && daysSince! <= STALE_AFTER_DAYS
    },
    monthly_income: user.monthly_income,
    target_savings_percent: user.target_savings_percent,
    total_spent: totalSpent,
    savings,
    savings_rate: Math.round(savingsRate * 100) / 100,
    health_score: healthScore,
    health_components: {
      savings: round2(savingsScore),
      expense_ratio: round2(expenseScore),
      budget: budgetScore,
      stability: stabilityScore
    },
    category_breakdown: categoryBreakdown,
    smart_budget: {
      'Needs (Bills, Food)': Math.round(recommendedNeeds),
      'Wants (Entertainment, Shopping)': Math.round(recommendedWants),
      'Savings': Math.round(recommendedSavings)
    },
    anomalies,
    recent_anomaly_count: recentAnomalies.length,
    transaction_count_in_window: inWindow.length
  };
}
