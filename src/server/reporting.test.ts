import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoSeed } from './seed';
import { summarize, STALE_AFTER_DAYS } from './reporting';
import { toWeeklySeries, WEEK_MS } from './weekly';
import { buildFinancialState } from '../simulator/engine';
import type { StoredUser } from './types';

// The demo store on disk was generated at this instant; the seed is
// deterministic, so this reproduces it exactly (checked against the file).
const SEEDED_AT = new Date('2026-10-14T10:22:15.941Z');
const user: StoredUser = { id: 'user_demo_1', username: 'demo_user', monthly_income: 50000, target_savings_percent: 20 };
const txs = generateDemoSeed(user.id, SEEDED_AT);
const at = (iso: string) => new Date(iso).getTime();

test('reproduces the Phase-1 discrepancy: same data, three dates, three different 30-day totals', () => {
  const d14 = summarize(user, txs, at('2026-10-14T12:00:00Z'));
  const d23 = summarize(user, txs, at('2026-10-23T12:00:00Z'));
  const d28 = summarize(user, txs, at('2026-10-28T10:00:00Z'));
  assert.equal(Math.round(d14.total_spent), 40875);
  assert.equal(Math.round(d23.total_spent), 18065);
  assert.equal(Math.round(d28.total_spent), 15517);
  assert.equal(Math.round(d28.savings_rate), 69);
});

test('the reporting window now says when the totals are understated', () => {
  const d14 = summarize(user, txs, at('2026-10-14T12:00:00Z')).reporting;
  const d23 = summarize(user, txs, at('2026-10-23T12:00:00Z')).reporting;
  const d28 = summarize(user, txs, at('2026-10-28T10:00:00Z')).reporting;

  assert.equal(d14.complete, true);
  assert.equal(d14.days_since_last_entry, 0);

  assert.equal(d23.complete, false);
  assert.equal(d23.days_since_last_entry, 9);
  assert.equal(d23.unlogged_days_in_window, 9);

  assert.equal(d28.complete, false);
  assert.equal(d28.days_since_last_entry, 13);
  assert.equal(d28.data_through, '2026-10-14T10:22:15.941Z');
  assert.equal(d28.window_days, 30);
  assert.equal(d28.window_end, '2026-10-28T10:00:00.000Z');
  assert.equal(d28.window_start, '2026-09-28T10:00:00.000Z');
});

test('a gap of exactly the stale threshold is still complete; one more day is not', () => {
  const last = at('2026-10-14T10:22:15.941Z');
  const DAY = 86400000;
  assert.equal(summarize(user, txs, last + STALE_AFTER_DAYS * DAY + 1000).reporting.complete, true);
  assert.equal(summarize(user, txs, last + (STALE_AFTER_DAYS + 1) * DAY + 1000).reporting.complete, false);
});

test('savings rate is (income - spent in window) / income, and figures agree with each other', () => {
  const s = summarize(user, txs, at('2026-10-14T12:00:00Z'));
  assert.equal(s.savings, Math.round((50000 - s.total_spent) * 100) / 100);
  assert.equal(s.savings_rate, Math.round(((50000 - s.total_spent) / 50000) * 10000) / 100);
  const catSum = Object.values(s.category_breakdown).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(catSum - s.total_spent) < 0.05);
  assert.ok(s.health_score >= 0 && s.health_score <= 100);
});

test('future-dated and invalid transactions are left out of the window', () => {
  const now = at('2026-10-14T12:00:00Z');
  const extra = [
    { id: 'f', user_id: user.id, amount: 99999, merchant: 'Future', category: 'Shopping', date: '2026-12-01T00:00:00Z' },
    { id: 'b', user_id: user.id, amount: 99999, merchant: 'Bad', category: 'Shopping', date: 'garbage' }
  ];
  assert.equal(summarize(user, [...txs, ...extra], now).total_spent, summarize(user, txs, now).total_spent);
});

test('no transactions: zero spend, incomplete, no crash', () => {
  const s = summarize(user, [], at('2026-10-23T12:00:00Z'));
  assert.equal(s.total_spent, 0);
  assert.equal(s.reporting.complete, false);
  assert.equal(s.reporting.data_through, null);
});

test('the simulator is unaffected: it still measures from the last transaction', () => {
  const a = buildFinancialState(txs, user, new Date('2026-10-14T12:00:00Z'));
  const b = buildFinancialState(txs, user, new Date('2026-10-28T10:00:00Z'));
  assert.equal(a.baselineSpend, b.baselineSpend);
  assert.equal(b.staleDays, 13);
});

test('weekly series: 60 full weeks for the seed, newest bucket ends at the latest transaction', () => {
  const w = toWeeklySeries(txs, at('2026-10-28T10:00:00Z'));
  assert.equal(w.totals.length, 60);
  assert.equal(w.through, '2026-10-14T10:22:15.941Z');
  assert.equal(new Date(w.weekStarts[59]).getTime(), at(w.through!) - WEEK_MS);
});

test('weekly series: a log ending mid-week no longer produces a partial newest week', () => {
  const DAY = 86400000;
  const start = at('2026-01-05T12:00:00Z');
  // 10 days of ₹100/day. Counting forward from the first entry (the old
  // method) gave [700, 300]: a newest "week" of 3 days that looks like a 57%
  // drop. Counting back from the latest entry gives a full newest week.
  const daily = Array.from({ length: 10 }, (_, i) => ({ amount: 100, date: new Date(start + i * DAY).toISOString() }));
  const w = toWeeklySeries(daily, start + 30 * DAY);
  assert.deepEqual(w.totals, [300, 700]);
});
