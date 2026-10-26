import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFinancialState, withForecastBaseline, simulateScenario, optimizeForGoal,
  planToChanges, solveCuts, policyFor, type CutItem, type TransactionLike
} from './engine';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-18T12:00:00Z');
const profile = { monthly_income: 50000, target_savings_percent: 20 };

// One transaction per category every 10 days for 120 days, ending `endDaysAgo` before NOW.
function makeTxs(endDaysAgo = 0): TransactionLike[] {
  const amounts: Record<string, number> = { Bills: 3000, Food: 2000, Transport: 1000, Shopping: 1500, Entertainment: 500 };
  const txs: TransactionLike[] = [];
  for (let d = 0; d < 120; d += 10) {
    const date = new Date(NOW.getTime() - (endDaysAgo + d) * DAY).toISOString();
    for (const [category, amount] of Object.entries(amounts)) txs.push({ amount, category, date });
  }
  return txs;
}

const baselineOf = (s: ReturnType<typeof buildFinancialState>, cat: string) =>
  s.categories.find(c => c.category === cat)!.baseline;

test('baseline is the mean of three 30-day windows', () => {
  const s = buildFinancialState(makeTxs(), profile, NOW);
  // Each 30-day window (start, end] holds 3 transactions per category.
  assert.equal(baselineOf(s, 'Bills'), 9000);
  assert.equal(baselineOf(s, 'Food'), 6000);
  assert.equal(s.baselineSpend, 9000 + 6000 + 3000 + 4500 + 1500);
  assert.equal(s.categories[0].windows.length, 3);
  assert.equal(s.staleDays, 0);
});

test('a log that stops early is measured from the last transaction, not today', () => {
  const fresh = buildFinancialState(makeTxs(0), profile, NOW);
  const stale = buildFinancialState(makeTxs(10), profile, NOW);
  assert.equal(stale.staleDays, 10);
  assert.equal(stale.baselineSpend, fresh.baselineSpend);
});

test('under 30 days of history is scaled up to a month', () => {
  const txs = [0, 5, 10, 14].map(d => ({ amount: 1000, category: 'Food', date: new Date(NOW.getTime() - d * DAY).toISOString() }));
  const s = buildFinancialState(txs, profile, NOW);
  assert.equal(s.historyDays, 15);
  assert.equal(baselineOf(s, 'Food'), 8000); // 4000 over 15 days -> 30 days
});

test('no transactions gives a zero baseline without crashing', () => {
  const s = buildFinancialState([], profile, NOW);
  assert.equal(s.baselineSpend, 0);
  const r = simulateScenario(s, { changes: {} });
  assert.equal(r.scenarioSavings, 50000);
  const plan = optimizeForGoal(s);
  assert.equal(plan.alreadyMet, true);
});

test('future-dated and invalid transactions are ignored', () => {
  const txs = [...makeTxs(), { amount: 99999, category: 'Food', date: new Date(NOW.getTime() + 5 * DAY).toISOString() },
    { amount: Number.NaN, category: 'Food', date: NOW.toISOString() }, { amount: 500, category: 'Food', date: 'not a date' }];
  assert.equal(buildFinancialState(txs, profile, NOW).baselineSpend, buildFinancialState(makeTxs(), profile, NOW).baselineSpend);
});

test('forecast baseline matches the forecast total and keeps category shares', () => {
  const s = buildFinancialState(makeTxs(), profile, NOW);
  const f = withForecastBaseline(s, 36000, 'chronos-2');
  assert.ok(Math.abs(f.baselineSpend - 36000) < 0.05);
  assert.ok(Math.abs(baselineOf(f, 'Bills') / f.baselineSpend - baselineOf(s, 'Bills') / s.baselineSpend) < 1e-6);
  assert.equal(f.baselineSource, 'forecast');
  assert.equal(f.forecastModel, 'chronos-2');
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(withForecastBaseline(s, bad, 'chronos-2'), s);
  }
});

test('a scenario with no changes equals the baseline', () => {
  const s = buildFinancialState(makeTxs(), profile, NOW);
  const r = simulateScenario(s, { changes: {} });
  assert.equal(r.scenarioSpend, r.baselineSpend);
  assert.equal(r.monthlySavingsChange, 0);
  assert.equal(r.baselineSavings, 50000 - 24000);
  assert.equal(r.baselineSavingsRate, 52);
});

test('category changes apply exactly and savings = income - spending', () => {
  const s = buildFinancialState(makeTxs(), profile, NOW);
  const r = simulateScenario(s, { changes: { Shopping: -20, Food: 10 }, incomeChangePct: 10 });
  assert.equal(r.categories.find(c => c.category === 'Shopping')!.adjusted, 3600);
  assert.equal(r.categories.find(c => c.category === 'Food')!.adjusted, 6600);
  assert.equal(r.scenarioIncome, 55000);
  assert.equal(r.scenarioSpend, 24000 - 900 + 600);
  assert.equal(r.scenarioSavings, r.scenarioIncome - r.scenarioSpend);
  assert.equal(r.yearlySavingsChange, r.monthlySavingsChange * 12);
});

test('changes outside the allowed range are clamped and flagged', () => {
  const s = buildFinancialState(makeTxs(), profile, NOW);
  const r = simulateScenario(s, { changes: { Bills: -50, Shopping: 500 }, incomeChangePct: 90 });
  const bills = r.categories.find(c => c.category === 'Bills')!;
  assert.equal(bills.changePct, -policyFor('Bills').maxCutPct);
  assert.equal(bills.clamped, true);
  assert.equal(r.categories.find(c => c.category === 'Shopping')!.changePct, 100);
  assert.equal(r.scenarioIncome, 75000); // income change capped at +50%
});

// A tighter profile so the 20% target actually needs cuts.
const tight = { monthly_income: 28000, target_savings_percent: 20 };

test('the optimizer reaches the target exactly, within every cut limit', () => {
  const s = buildFinancialState(makeTxs(), tight, NOW);
  const plan = optimizeForGoal(s);
  assert.equal(plan.feasible, true);
  assert.equal(plan.requiredReduction, 24000 - (28000 - 5600));
  assert.ok(Math.abs(plan.cuts.reduce((a, c) => a + c.cut, 0) - plan.requiredReduction) <= 2);
  for (const c of plan.cuts) assert.ok(c.cutPct <= c.capPct + 1e-9, `${c.category} over its limit`);
  // Applying the plan as a scenario meets the target.
  const r = simulateScenario(s, { changes: planToChanges(plan) });
  assert.equal(r.meetsTarget, true);
  assert.ok(Math.abs(r.scenarioSavings - plan.targetSavings) <= 1);
});

test('an already-met target needs no cuts', () => {
  const plan = optimizeForGoal(buildFinancialState(makeTxs(), profile, NOW));
  assert.equal(plan.alreadyMet, true);
  assert.ok(plan.cuts.every(c => c.cut === 0));
  assert.equal(plan.effortSavedPct, null);
});

test('an unreachable target is reported as infeasible with every category at its limit', () => {
  const plan = optimizeForGoal(buildFinancialState(makeTxs(), tight, NOW), 60);
  assert.equal(plan.feasible, false);
  for (const c of plan.cuts) assert.equal(c.cutPct, c.capPct);
  assert.ok(plan.achievedReduction < plan.requiredReduction);
});

const cost = (items: CutItem[], x: number[]) => items.reduce((s, it, i) => s + (it.e * x[i] * x[i]) / it.b, 0);
const item = (category: string, b: number) => {
  const p = policyFor(category);
  return { category, b, e: p.effort, cap: (b * p.maxCutPct) / 100, capPct: p.maxCutPct };
};

test('brute force: no allocation on a fine grid beats the optimizer', () => {
  const items = [item('Food', 6000), item('Shopping', 4500), item('Entertainment', 1500)];
  const R = 2500;
  const x = solveCuts(items, R);
  const best = cost(items, x);

  let gridBest = Infinity;
  const step = 10;
  for (let a = 0; a <= items[0].cap; a += step) {
    for (let b = 0; b <= items[1].cap; b += step) {
      const c = R - a - b; // third cut makes the total exactly R
      if (c < 0 || c > items[2].cap) continue;
      gridBest = Math.min(gridBest, cost(items, [a, b, c]));
    }
  }
  assert.ok(Number.isFinite(gridBest));
  assert.ok(best <= gridBest + 1e-6, `optimizer ${best} worse than grid ${gridBest}`);
  assert.ok(gridBest - best < 0.01 * best, 'grid optimum should be close to the exact optimum');
});

test('KKT: uncapped cuts have equal marginal effort; capped ones have lower', () => {
  const items = [item('Bills', 9000), item('Food', 6000), item('Transport', 3000), item('Shopping', 4500), item('Entertainment', 1500)];
  const x = solveCuts(items, 3000);
  const marginal = items.map((it, i) => (2 * it.e * x[i]) / it.b);
  const free = items.map((it, i) => i).filter(i => x[i] > 1e-6 && x[i] < items[i].cap - 1e-6);
  const capped = items.map((it, i) => i).filter(i => x[i] >= items[i].cap - 1e-6);
  assert.ok(free.length >= 2);
  for (const i of free) assert.ok(Math.abs(marginal[i] - marginal[free[0]]) < 1e-6);
  for (const i of capped) assert.ok(marginal[i] <= marginal[free[0]] + 1e-6);
});

test('the optimizer never needs more effort than an equal cut that respects the limits (200 random cases)', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let compared = 0;
  for (let k = 0; k < 200; k++) {
    const items = ['Bills', 'Food', 'Transport', 'Shopping', 'Entertainment'].map(c => item(c, 500 + rand() * 9500));
    const total = items.reduce((s, it) => s + it.b, 0);
    const R = rand() * 0.1 * total; // up to 10%, so an equal cut stays within Bills' limit
    const x = solveCuts(items, R);
    assert.ok(Math.abs(x.reduce((s, v) => s + v, 0) - R) < 1e-6);
    const uniform = items.map(it => (R / total) * it.b);
    assert.ok(cost(items, x) <= cost(items, uniform) + 1e-6);
    compared++;
  }
  assert.equal(compared, 200);
});

test('plan reports less effort than the equal cut when the target needs cuts', () => {
  const plan = optimizeForGoal(buildFinancialState(makeTxs(), tight, NOW));
  assert.ok(plan.effortSavedPct !== null && plan.effortSavedPct > 0);
  assert.ok(plan.effortCost < plan.uniform.effortCost);
});
