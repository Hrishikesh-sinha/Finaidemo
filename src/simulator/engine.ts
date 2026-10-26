// What-If Simulator engine. Pure functions, no I/O, so the same code runs in the
// browser (instant slider updates) and on the server (the explain endpoint
// recomputes everything itself rather than trusting numbers sent by a client).
//
// Three parts:
//   1. buildFinancialState: monthly baseline per category from the user's own
//      transactions (three 30-day windows), optionally rescaled to a forecast.
//   2. simulateScenario: apply per-category changes and an income change.
//   3. optimizeForGoal: the smallest-effort set of cuts that reaches a savings
//      target, compared against cutting every category by the same percentage.

export const CATEGORIES = ['Bills', 'Food', 'Transport', 'Shopping', 'Entertainment'] as const;

export interface CategoryPolicy {
  // Largest cut the simulator allows, as a percentage of the baseline.
  maxCutPct: number;
  // Largest increase the simulator allows, as a percentage of the baseline.
  maxRaisePct: number;
  // How hard a cut in this category is to live with, relative to the others.
  // Higher means harder. MODELLING ASSUMPTION, not measured from users.
  effort: number;
}

// Modelling assumptions, stated openly in the UI: rent and utilities are
// mostly fixed commitments, discretionary categories are easiest to trim.
export const CATEGORY_POLICY: Record<string, CategoryPolicy> = {
  Bills: { maxCutPct: 10, maxRaisePct: 100, effort: 5 },
  Food: { maxCutPct: 30, maxRaisePct: 100, effort: 2 },
  Transport: { maxCutPct: 25, maxRaisePct: 100, effort: 2.5 },
  Shopping: { maxCutPct: 60, maxRaisePct: 100, effort: 1 },
  Entertainment: { maxCutPct: 70, maxRaisePct: 100, effort: 0.8 }
};

const DEFAULT_POLICY: CategoryPolicy = { maxCutPct: 30, maxRaisePct: 100, effort: 2 };

export function policyFor(category: string): CategoryPolicy {
  return CATEGORY_POLICY[category] ?? DEFAULT_POLICY;
}

export interface TransactionLike {
  amount: number;
  category: string;
  date: string;
}

export interface ProfileLike {
  monthly_income: number;
  target_savings_percent: number;
}

export interface CategoryState {
  category: string;
  // Monthly spend the simulator starts from, in rupees.
  baseline: number;
  // Spend in each 30-day window, oldest first. Empty when history < 30 days.
  windows: number[];
  // Average month-over-month change across the windows, % of baseline.
  trendPct: number;
}

export interface FinancialState {
  // End of the most recent 30-day window: the latest transaction, or today if
  // the log is up to date. Measuring from today when the log is behind would
  // count unlogged days as zero spending.
  anchorDate: string;
  // Days between the latest transaction and today.
  staleDays: number;
  // Days of transaction history behind the baseline.
  historyDays: number;
  monthlyIncome: number;
  targetSavingsPct: number;
  categories: CategoryState[];
  baselineSpend: number;
  // 'history': mean of the 30-day windows. 'forecast': rescaled so the total
  // equals a 30-day forecast (category shares still come from history).
  baselineSource: 'history' | 'forecast';
  forecastModel: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

const round2 = (x: number) => Math.round(x * 100) / 100;

export function buildFinancialState(
  transactions: TransactionLike[],
  profile: ProfileLike,
  now: Date = new Date()
): FinancialState {
  const nowMs = now.getTime();
  const stamped = transactions
    .map(t => ({ ts: new Date(t.date).getTime(), amount: Number(t.amount), category: t.category || 'Other' }))
    .filter(t => Number.isFinite(t.ts) && Number.isFinite(t.amount) && t.amount > 0 && t.ts <= nowMs);

  const categoryNames: string[] = [...CATEGORIES];
  for (const t of stamped) {
    if (!categoryNames.includes(t.category)) categoryNames.push(t.category);
  }

  const base: Omit<FinancialState, 'categories' | 'baselineSpend'> = {
    anchorDate: now.toISOString(),
    staleDays: 0,
    historyDays: 0,
    monthlyIncome: Math.max(0, Number(profile.monthly_income) || 0),
    targetSavingsPct: Math.max(0, Number(profile.target_savings_percent) || 0),
    baselineSource: 'history',
    forecastModel: null
  };

  if (stamped.length === 0) {
    return {
      ...base,
      categories: categoryNames.map(category => ({ category, baseline: 0, windows: [], trendPct: 0 })),
      baselineSpend: 0
    };
  }

  const latest = Math.max(...stamped.map(t => t.ts));
  const earliest = Math.min(...stamped.map(t => t.ts));
  const anchor = Math.min(nowMs, latest);
  const historyDays = Math.max(1, Math.floor((anchor - earliest) / DAY_MS) + 1);
  const nWindows = Math.min(3, Math.floor(historyDays / WINDOW_DAYS));

  const categories: CategoryState[] = categoryNames.map(category => {
    const own = stamped.filter(t => t.category === category);

    if (nWindows === 0) {
      // Under 30 days of history: scale what there is up to a month.
      const total = own.reduce((s, t) => s + t.amount, 0);
      return { category, baseline: round2((total * WINDOW_DAYS) / historyDays), windows: [], trendPct: 0 };
    }

    const windows: number[] = [];
    for (let k = nWindows - 1; k >= 0; k--) {
      const end = anchor - k * WINDOW_DAYS * DAY_MS;
      const start = end - WINDOW_DAYS * DAY_MS;
      windows.push(own.filter(t => t.ts > start && t.ts <= end).reduce((s, t) => s + t.amount, 0));
    }

    const mean = windows.reduce((s, w) => s + w, 0) / windows.length;
    const trendPct =
      windows.length >= 2 && mean > 0
        ? ((windows[windows.length - 1] - windows[0]) / (windows.length - 1) / mean) * 100
        : 0;

    return {
      category,
      baseline: round2(mean),
      windows: windows.map(round2),
      trendPct: Math.round(trendPct * 10) / 10
    };
  });

  return {
    ...base,
    anchorDate: new Date(anchor).toISOString(),
    staleDays: Math.max(0, Math.floor((nowMs - anchor) / DAY_MS)),
    historyDays,
    categories,
    baselineSpend: round2(categories.reduce((s, c) => s + c.baseline, 0))
  };
}

// Rescale category baselines so they sum to a 30-day forecast, keeping each
// category's share of spending from history. This is how the forecaster
// (Chronos-2 when enough history exists) feeds the simulator.
export function withForecastBaseline(
  state: FinancialState,
  forecastTotal30Days: number,
  model: string
): FinancialState {
  if (!Number.isFinite(forecastTotal30Days) || forecastTotal30Days <= 0 || state.baselineSpend <= 0) {
    return state;
  }
  const factor = forecastTotal30Days / state.baselineSpend;
  const categories = state.categories.map(c => ({ ...c, baseline: round2(c.baseline * factor) }));
  return {
    ...state,
    categories,
    baselineSpend: round2(categories.reduce((s, c) => s + c.baseline, 0)),
    baselineSource: 'forecast',
    forecastModel: model
  };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export interface ScenarioInput {
  // Percentage change per category; negative is a cut. Clamped to policy.
  changes: Record<string, number>;
  // Percentage change in monthly income, clamped to +/-50.
  incomeChangePct?: number;
  // Savings goal as % of income. Defaults to the profile's target.
  targetSavingsPct?: number;
}

export interface CategoryOutcome {
  category: string;
  baseline: number;
  adjusted: number;
  // Change actually applied after clamping.
  changePct: number;
  // True when the requested change was outside the allowed range.
  clamped: boolean;
}

export interface ScenarioResult {
  categories: CategoryOutcome[];
  baselineSpend: number;
  scenarioSpend: number;
  baselineIncome: number;
  scenarioIncome: number;
  baselineSavings: number;
  scenarioSavings: number;
  // Savings as % of income (can be negative).
  baselineSavingsRate: number;
  scenarioSavingsRate: number;
  monthlySavingsChange: number;
  yearlySavingsChange: number;
  targetSavingsPct: number;
  targetSavings: number;
  meetsTarget: boolean;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const rupees = (x: number) => Math.round(x);
const pct1 = (x: number) => Math.round(x * 10) / 10;

function savingsRate(savings: number, income: number): number {
  return income > 0 ? (savings / income) * 100 : 0;
}

export function simulateScenario(state: FinancialState, input: ScenarioInput): ScenarioResult {
  const applied = state.categories.map(c => {
    const policy = policyFor(c.category);
    const requested = Number(input.changes?.[c.category] ?? 0) || 0;
    return { requested, pct: clamp(requested, -policy.maxCutPct, policy.maxRaisePct) };
  });

  const categories: CategoryOutcome[] = state.categories.map((c, i) => ({
    category: c.category,
    baseline: rupees(c.baseline),
    adjusted: rupees(c.baseline * (1 + applied[i].pct / 100)),
    changePct: pct1(applied[i].pct),
    clamped: Math.abs(applied[i].pct - applied[i].requested) > 1e-9
  }));

  const incomeChange = clamp(Number(input.incomeChangePct ?? 0) || 0, -50, 50);
  const baselineIncome = state.monthlyIncome;
  const scenarioIncome = baselineIncome * (1 + incomeChange / 100);

  const baselineSpend = state.categories.reduce((s, c) => s + c.baseline, 0);
  const scenarioSpend = state.categories.reduce((s, c, i) => s + c.baseline * (1 + applied[i].pct / 100), 0);

  const baselineSavings = baselineIncome - baselineSpend;
  const scenarioSavings = scenarioIncome - scenarioSpend;
  const targetPct = clamp(Number(input.targetSavingsPct ?? state.targetSavingsPct) || 0, 0, 90);
  const targetSavings = (scenarioIncome * targetPct) / 100;

  return {
    categories,
    baselineSpend: rupees(baselineSpend),
    scenarioSpend: rupees(scenarioSpend),
    baselineIncome: rupees(baselineIncome),
    scenarioIncome: rupees(scenarioIncome),
    baselineSavings: rupees(baselineSavings),
    scenarioSavings: rupees(scenarioSavings),
    baselineSavingsRate: pct1(savingsRate(baselineSavings, baselineIncome)),
    scenarioSavingsRate: pct1(savingsRate(scenarioSavings, scenarioIncome)),
    monthlySavingsChange: rupees(scenarioSavings - baselineSavings),
    yearlySavingsChange: rupees((scenarioSavings - baselineSavings) * 12),
    targetSavingsPct: pct1(targetPct),
    targetSavings: rupees(targetSavings),
    meetsTarget: scenarioSavings >= targetSavings - 0.5
  };
}

// ---------------------------------------------------------------------------
// Goal-constrained optimizer
// ---------------------------------------------------------------------------
//
// Find cuts x_i (rupees per month) that reach the savings target with the
// least total effort:
//
//     minimize   sum_i  e_i * x_i^2 / b_i
//     subject to sum_i x_i = R,   0 <= x_i <= cap_i
//
// b_i is the category baseline, e_i its effort weight, cap_i = maxCut_i * b_i,
// and R the reduction needed. Dividing by b_i makes the cost depend on the
// cut as a share of that category, so a ₹500 cut hurts less in a ₹10,000
// category than in a ₹1,000 one. The problem is convex; its KKT conditions
// give x_i(λ) = min(cap_i, λ b_i / (2 e_i)), and sum_i x_i(λ) increases with
// λ, so λ is found by bisection.
//
// The comparison is a uniform cut: the same percentage from every category,
// the advice a simple budgeting app gives.

export interface PlannedCut {
  category: string;
  baseline: number;
  cut: number;
  // Rounded for display.
  cutPct: number;
  // Unrounded, so applying the plan reaches the goal exactly.
  exactCutPct: number;
  capPct: number;
}

export interface UniformComparison {
  cutPct: number;
  // False when the uniform percentage exceeds some category's allowed cut,
  // e.g. it would need more than 10% off Bills.
  withinLimits: boolean;
  effortCost: number;
}

export interface GoalPlan {
  targetSavingsPct: number;
  targetSavings: number;
  baselineSavings: number;
  requiredReduction: number;
  achievedReduction: number;
  // True when the target is reachable within every category's cut limit.
  feasible: boolean;
  alreadyMet: boolean;
  cuts: PlannedCut[];
  effortCost: number;
  uniform: UniformComparison;
  // How much less effort the optimized plan needs than the uniform cut, as a
  // percentage of the uniform cut's effort. Null when there is nothing to compare.
  effortSavedPct: number | null;
}

export interface CutItem {
  category: string;
  b: number;
  e: number;
  cap: number;
  capPct: number;
}

function effortCost(items: CutItem[], cuts: number[]): number {
  return items.reduce((s, it, i) => s + (it.b > 0 ? (it.e * cuts[i] * cuts[i]) / it.b : 0), 0);
}

export function solveCuts(items: CutItem[], required: number): number[] {
  const capTotal = items.reduce((s, it) => s + it.cap, 0);
  if (required <= 0) return items.map(() => 0);
  if (required >= capTotal) return items.map(it => it.cap);

  const at = (lambda: number) => items.map(it => Math.min(it.cap, (lambda * it.b) / (2 * it.e)));
  const total = (lambda: number) => at(lambda).reduce((s, x) => s + x, 0);

  let lo = 0;
  let hi = Math.max(...items.filter(it => it.b > 0).map(it => (2 * it.e * it.cap) / it.b));
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    if (total(mid) < required) lo = mid;
    else hi = mid;
  }
  return at(hi);
}

export function optimizeForGoal(state: FinancialState, targetSavingsPct: number = state.targetSavingsPct): GoalPlan {
  const income = state.monthlyIncome;
  const targetSavings = (income * Math.max(0, targetSavingsPct)) / 100;
  const baselineSavings = income - state.baselineSpend;
  const required = Math.max(0, targetSavings - baselineSavings);

  const items: CutItem[] = state.categories
    .filter(c => c.baseline > 0)
    .map(c => {
      const p = policyFor(c.category);
      return { category: c.category, b: c.baseline, e: p.effort, cap: (c.baseline * p.maxCutPct) / 100, capPct: p.maxCutPct };
    });

  const cuts = solveCuts(items, required);
  const achieved = cuts.reduce((s, x) => s + x, 0);
  const feasible = achieved >= required - 0.5;
  const cost = effortCost(items, cuts);

  const totalBase = items.reduce((s, it) => s + it.b, 0);
  const uniformFrac = totalBase > 0 ? required / totalBase : 0;
  const uniformCuts = items.map(it => uniformFrac * it.b);
  const uniformCost = effortCost(items, uniformCuts);
  const uniform: UniformComparison = {
    cutPct: pct1(uniformFrac * 100),
    withinLimits: items.every(it => uniformFrac * 100 <= it.capPct + 1e-9),
    effortCost: Math.round(uniformCost)
  };

  return {
    targetSavingsPct: pct1(targetSavingsPct),
    targetSavings: rupees(targetSavings),
    baselineSavings: rupees(baselineSavings),
    requiredReduction: rupees(required),
    achievedReduction: rupees(achieved),
    feasible,
    alreadyMet: required <= 0,
    cuts: items.map((it, i) => ({
      category: it.category,
      baseline: rupees(it.b),
      cut: rupees(cuts[i]),
      cutPct: pct1(it.b > 0 ? (cuts[i] / it.b) * 100 : 0),
      exactCutPct: it.b > 0 ? (cuts[i] / it.b) * 100 : 0,
      capPct: it.capPct
    })),
    effortCost: Math.round(cost),
    uniform,
    effortSavedPct: required > 0 && feasible && uniformCost > 0 ? pct1((1 - cost / uniformCost) * 100) : null
  };
}

// Percentage changes that reproduce a plan, ready to feed simulateScenario.
export function planToChanges(plan: GoalPlan): Record<string, number> {
  const changes: Record<string, number> = {};
  for (const c of plan.cuts) changes[c.category] = -c.exactCutPct;
  return changes;
}
