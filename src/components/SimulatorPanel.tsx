import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  SlidersHorizontal, Target, Sparkles, RotateCcw, WandSparkles,
  Loader2, ShieldCheck, Info, CheckCircle2, AlertTriangle, Check
} from 'lucide-react';
import { CATEGORY_POLICY,
  simulateScenario, optimizeForGoal, planToChanges, policyFor,
  type FinancialState, type GoalPlan, type ScenarioResult
} from '../simulator/engine';
import { baselineDescription } from '../simulator/grounding';
import { CategoryBadge } from './CategoryBadge';
import { C, categoryColor, inr, signedInr, signedPct } from '../ui/theme';

interface Props {
  token: string;
}

interface Explanation {
  explanation: string;
  source: 'gemini' | 'template';
  model?: string;
  note?: string;
}

// Largest increase offered on a slider. The engine allows more; the slider
// stays narrow so small cuts remain easy to set precisely.
const SLIDER_MAX_RAISE = 50;

// Position of a value on a slider track, corrected for the 16px thumb: the
// usable track is inset by half a thumb at each end.
const trackLeft = (frac: number) => `calc(8px + ${Math.min(1, Math.max(0, frac))} * (100% - 16px))`;

function StepHeader({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="w-5 h-5 shrink-0 rounded-full bg-accent-dim text-accent text-micro font-semibold inline-flex items-center justify-center translate-y-0.5">
        {n}
      </span>
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="text-micro text-ink-3 mt-0.5">{hint}</p>
      </div>
    </div>
  );
}

/**
 * Income split into spending and savings, for the baseline and the scenario on
 * one shared rupee scale, with the goal drawn as the spending ceiling that
 * still reaches it. Reading it is one comparison: the scenario's spending
 * segment either ends before the goal line or it does not.
 *
 * Every segment carries its own figure, so nothing here is encoded by colour
 * alone.
 */
function OutcomeBars({ scenario }: { scenario: ScenarioResult }) {
  const scale = Math.max(
    scenario.baselineIncome, scenario.scenarioIncome,
    scenario.baselineSpend, scenario.scenarioSpend, 1
  );
  const pct = (v: number) => `${Math.max(0, (v / scale) * 100)}%`;
  const goalFrac = Math.max(0, Math.min(1, (scenario.scenarioIncome - scenario.targetSavings) / scale));

  const rows = [
    {
      key: 'now',
      label: 'Now',
      spend: scenario.baselineSpend,
      saved: scenario.baselineSavings,
      rate: scenario.baselineSavingsRate,
      spendFill: C.line,
      savedFill: C.ink3,
      muted: true
    },
    {
      key: 'scenario',
      label: 'This scenario',
      spend: scenario.scenarioSpend,
      saved: scenario.scenarioSavings,
      rate: scenario.scenarioSavingsRate,
      spendFill: C.lineStrong,
      savedFill: scenario.meetsTarget ? C.pos : C.caution,
      muted: false
    }
  ];

  return (
    <div className="space-y-3">
      {/* Caption strip for the goal line, kept clear of the row figures. */}
      <div className="relative h-4">
        <span
          className="absolute top-0 text-micro text-ink whitespace-nowrap -translate-x-1/2"
          style={{ left: `${goalFrac * 100}%` }}
        >
          goal
        </span>
      </div>

      <div className="space-y-3">
        {rows.map(r => (
          <div key={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-micro mb-1.5">
              <span className={r.muted ? 'text-ink-3' : 'text-ink font-medium'}>{r.label}</span>
              <span className={`tabular ${r.muted ? 'text-ink-3' : 'text-ink-2'}`}>
                {inr(r.spend)} spent · {inr(r.saved)} saved ({r.rate}%)
              </span>
            </div>
            <div className="relative h-7 rounded-md bg-sunken overflow-hidden">
              <div
                className="absolute inset-y-0 left-0"
                style={{ width: pct(r.spend), backgroundColor: r.spendFill }}
              />
              {r.saved >= 0 ? (
                <div
                  className="absolute inset-y-0"
                  style={{
                    left: `calc(${pct(r.spend)} + 2px)`,
                    width: `max(0px, calc(${pct(r.saved)} - 2px))`,
                    backgroundColor: r.savedFill
                  }}
                />
              ) : (
                <div
                  className="absolute inset-y-0"
                  style={{
                    left: `calc(${pct(r.spend + r.saved)} + 2px)`,
                    width: `max(0px, calc(${pct(-r.saved)} - 2px))`,
                    backgroundColor: C.neg
                  }}
                />
              )}
              {/* The goal, drawn inside the track so it never crosses a label. */}
              <div
                className="absolute inset-y-0 w-0.5 bg-ink"
                style={{ left: `${goalFrac * 100}%` }}
                aria-hidden="true"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-micro text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2.5 rounded-xs" style={{ backgroundColor: C.lineStrong }} />Spending
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2.5 rounded-xs" style={{ backgroundColor: scenario.meetsTarget ? C.pos : C.caution }} />Saved
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-0.5 h-3 bg-ink" />Spending past this line misses the goal
        </span>
      </div>
    </div>
  );
}

/**
 * A range input with the track painted from the baseline rather than from the
 * left end, so the fill shows the direction and size of the change, and with
 * the zero position ticked. The slider's own bounds are the category's cut
 * limit, so a value can never be silently clamped; the limit is named under
 * the track instead.
 */
function RangeRow({
  id, min, max, value, onChange, fill, ariaValueText, leftCap, rightCap
}: {
  id: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  fill: string;
  ariaValueText: string;
  leftCap: string;
  rightCap: string;
}) {
  const span = max - min;
  const zeroFrac = (0 - min) / span;
  const valFrac = (value - min) / span;
  const a = Math.min(zeroFrac, valFrac) * 100;
  const b = Math.max(zeroFrac, valFrac) * 100;
  const track = `linear-gradient(90deg, ${C.raised} 0 ${a}%, ${fill} ${a}% ${b}%, ${C.raised} ${b}% 100%)`;

  return (
    <div>
      <div className="relative">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="fin-range relative z-10"
          style={{ '--track': track } as CSSProperties}
          aria-valuetext={ariaValueText}
        />
        {/* Baseline tick. Sits under the thumb but above the track. */}
        <span
          className="absolute top-[7px] h-2.5 w-px bg-ink-2/70 pointer-events-none"
          style={{ left: trackLeft(zeroFrac) }}
          aria-hidden="true"
        />
      </div>
      <div className="flex justify-between text-micro text-ink-3 -mt-0.5">
        <span>{leftCap}</span>
        <span>{rightCap}</span>
      </div>
    </div>
  );
}

/**
 * The optimizer's own case: what it cuts per category against what an
 * equal-percentage cut would take, with each category's limit ticked. The
 * figures are whatever optimizeForGoal returned; nothing here recomputes them.
 */
function PlanComparison({ plan }: { plan: GoalPlan }) {
  // Scaled to the cuts actually on screen, not to the largest cut limit: a
  // 70% limit on Entertainment would otherwise squash every real bar into a
  // sliver. A limit that falls outside the scale is named in words instead of
  // being drawn off the end.
  const scale = Math.max(
    plan.uniform.cutPct,
    ...plan.cuts.map(c => c.cutPct),
    1
  ) * 1.25;
  const w = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;

  return (
    <ul className="space-y-3.5">
      {plan.cuts.map(c => {
        const uniformOverCap = plan.uniform.cutPct > c.capPct;
        const capOnScale = c.capPct <= scale;
        return (
          <li key={c.category}>
            <div className="flex items-center justify-between gap-2 text-micro mb-1.5">
              <span className="flex items-center gap-2 text-ink">
                <CategoryBadge name={c.category} size="sm" />
                {c.category}
              </span>
              <span className="tabular text-ink-2">
                {c.cut > 0 ? `−${c.cutPct}% · ${inr(c.cut)}` : 'untouched'}
                {!capOnScale && <span className="text-ink-3"> · limit {c.capPct}%</span>}
              </span>
            </div>

            <div className="relative space-y-1 pl-7">
              {capOnScale && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-ink-2 z-10"
                  style={{ left: `calc(1.75rem + ${w(c.capPct)})` }}
                  title={`${c.category} cannot be cut by more than ${c.capPct}%`}
                  aria-hidden="true"
                />
              )}
              <div className="h-2.5 rounded-xs bg-sunken overflow-hidden">
                <div
                  className="h-full rounded-xs"
                  style={{ width: w(c.cutPct), backgroundColor: categoryColor(c.category) }}
                />
              </div>
              <div className="h-2.5 rounded-xs bg-sunken overflow-hidden">
                <div
                  className="h-full rounded-xs"
                  style={{ width: w(plan.uniform.cutPct), backgroundColor: uniformOverCap ? C.neg : C.lineStrong }}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function SimulatorPanel({ token }: Props) {
  const [state, setState] = useState<FinancialState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, number>>({});
  const [incomeChange, setIncomeChange] = useState(0);
  const [goalPct, setGoalPct] = useState<number | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const load = async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/simulator/state', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`server returned HTTP ${res.status}`);
      const data = (await res.json()) as FinancialState;
      setState(data);
      setGoalPct(prev => prev ?? data.targetSavingsPct);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const goal = goalPct ?? state?.targetSavingsPct ?? 20;
  const activeCategories = useMemo(() => (state ? state.categories.filter(c => c.baseline > 0) : []), [state]);

  const scenario = useMemo(
    () => (state ? simulateScenario(state, { changes, incomeChangePct: incomeChange, targetSavingsPct: goal }) : null),
    [state, changes, incomeChange, goal]
  );
  const plan = useMemo(() => (state ? optimizeForGoal(state, goal) : null), [state, goal]);

  // Any change to the inputs makes an earlier explanation out of date.
  useEffect(() => {
    setExplanation(null);
    setExplainError(null);
  }, [changes, incomeChange, goal]);

  const explain = async () => {
    setExplaining(true);
    setExplainError(null);
    try {
      const res = await fetch('/api/simulator/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ changes, incomeChangePct: incomeChange, targetSavingsPct: goal })
      });
      if (!res.ok) throw new Error(`server returned HTTP ${res.status}`);
      setExplanation((await res.json()) as Explanation);
    } catch (err) {
      setExplainError(err instanceof Error ? err.message : String(err));
    } finally {
      setExplaining(false);
    }
  };

  const reset = () => {
    setChanges({});
    setIncomeChange(0);
    setActivePreset(null);
  };

  const card = 'bg-surface rounded-lg border border-line';

  if (loadError) {
    return (
      <section className={`${card} p-6`} aria-label="What-If Simulator">
        <p className="text-sm text-ink font-medium">The simulator could not load your spending data.</p>
        <p className="text-xs text-ink-2 mt-1">Reason: {loadError}. Check that the server is running, then try again.</p>
        <button onClick={load} className="mt-4 text-xs px-3 py-1.5 rounded-md bg-raised border border-line text-ink hover:border-line-strong transition-colors">
          Try again
        </button>
      </section>
    );
  }

  if (!state || !scenario || !plan) {
    return (
      <section className={`${card} p-6 flex items-center gap-2 text-sm text-ink-2`} aria-label="What-If Simulator">
        <Loader2 className="w-4 h-4 animate-spin text-accent" /> Loading the simulator…
      </section>
    );
  }

  if (activeCategories.length === 0) {
    return (
      <section className={`${card} p-6`} aria-label="What-If Simulator">
        <p className="text-sm text-ink font-medium">Add a few transactions to use the simulator.</p>
        <p className="text-xs text-ink-2 mt-1">It needs your spending history to know where your money goes each month.</p>
      </section>
    );
  }

  const hasChanges = incomeChange !== 0 || Object.values(changes).some(v => v !== 0);
  const shortfall = Math.max(0, scenario.targetSavings - scenario.scenarioSavings);
  const plannedCuts = plan.cuts.filter(c => c.cut > 0);
  const deltaColor = scenario.monthlySavingsChange >= 0 ? 'text-pos' : 'text-neg';
  const has = (name: string) => activeCategories.some(c => c.category === name);

  // Presets only move the sliders. Every figure on screen is still recomputed
  // by the engine from the slider values, exactly as if they had been dragged.
  const presets: { id: string; label: string; apply: () => void }[] = [];
  if (has('Shopping') || has('Entertainment')) {
    presets.push({
      id: 'discretionary',
      label: 'Trim discretionary 10%',
      apply: () => setChanges({ ...(has('Shopping') ? { Shopping: -10 } : {}), ...(has('Entertainment') ? { Entertainment: -10 } : {}) })
    });
  }
  if (has('Food')) {
    presets.push({ id: 'food', label: 'Eat in more (Food −15%)', apply: () => setChanges({ Food: -15 }) });
  }
  presets.push({ id: 'raise', label: 'A 10% raise', apply: () => { setChanges({}); setIncomeChange(10); } });
  if (!plan.alreadyMet && plannedCuts.length > 0) {
    presets.push({
      id: 'optimizer',
      label: `Optimizer plan for ${goal}%`,
      apply: () => { setIncomeChange(0); setChanges(planToChanges(plan)); }
    });
  }

  const runPreset = (p: { id: string; apply: () => void }) => {
    p.apply();
    setActivePreset(p.id);
  };

  return (
    <section id="what-if-simulator" className={`${card} overflow-hidden`} aria-label="What-If Simulator">
      {/* Header */}
      <div className="px-5 sm:px-6 py-4 border-b border-line bg-sunken flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent-dim border border-accent/30 flex items-center justify-center shrink-0">
            <SlidersHorizontal className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">What-If Simulator</h2>
            <p className="text-xs text-ink-2 mt-0.5">
              Set a goal, try a change before you make it, and let FinAI find the easiest way there.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-micro px-2.5 py-1 rounded-full bg-pos/10 text-pos border border-pos/30 inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            Every figure computed by the engine
          </span>
          <span
            className="text-micro px-2.5 py-1 rounded-full bg-raised text-ink-2 border border-line"
            title={state.staleDays > 0 ? `Your latest transaction is ${state.staleDays} days old, so months are measured up to that date.` : undefined}
          >
            Starting point: {baselineDescription(state)}
          </span>
        </div>
      </div>

      {/* 1. The goal and the outcome */}
      <div className="px-5 sm:px-6 py-5 border-b border-line space-y-5">
        <StepHeader n={1} title="Set a goal" hint="How much of your income you want to keep each month." />

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 xl:gap-8">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="sim-goal" className="flex items-center gap-1.5 text-xs text-ink-2">
                <Target className="w-3.5 h-3.5 text-accent" /> Savings goal
              </label>
              <span className="text-xs text-ink-3">{inr(scenario.targetSavings)} a month</span>
            </div>
            <p className="text-3xl font-semibold tracking-tight text-ink mt-1 mb-1">{goal}%</p>
            <RangeRow
              id="sim-goal"
              min={0}
              max={60}
              value={goal}
              onChange={setGoalPct}
              fill={C.accent}
              ariaValueText={`${goal}% of income, ${inr(scenario.targetSavings)} a month`}
              leftCap="0%"
              rightCap="60%"
            />
          </div>

          <div className="sm:border-l sm:border-line sm:pl-5 xl:pl-8">
            <p className="text-xs text-ink-2">Saved in this scenario</p>
            <p className="text-3xl font-semibold tracking-tight text-ink mt-1" aria-live="polite">
              {inr(scenario.scenarioSavings)}
              <span className="text-base font-medium text-ink-3 ml-2">{scenario.scenarioSavingsRate}%</span>
            </p>
            <p className="text-xs mt-1.5">
              {hasChanges ? (
                <>
                  <span className={`${deltaColor} font-medium tabular`}>{signedInr(scenario.monthlySavingsChange)} a month</span>
                  <span className="text-ink-3"> · {signedInr(scenario.yearlySavingsChange)} a year</span>
                </>
              ) : (
                <span className="text-ink-3">Move a slider below to compare with now.</span>
              )}
            </p>
          </div>

          <div className="sm:col-span-2 xl:col-span-1 xl:border-l xl:border-line xl:pl-8">
            <p className="text-xs text-ink-2">Against the goal</p>
            <p className={`text-base font-medium mt-1 flex items-start gap-2 ${scenario.meetsTarget ? 'text-pos' : 'text-caution'}`}>
              {scenario.meetsTarget
                ? <CheckCircle2 className="w-5 h-5 shrink-0 mt-px" />
                : <AlertTriangle className="w-5 h-5 shrink-0 mt-px" />}
              <span>
                {scenario.meetsTarget
                  ? 'This scenario meets your goal.'
                  : <>Short by {inr(shortfall)} a month.</>}
              </span>
            </p>
            <p className="text-micro text-ink-3 mt-1.5">
              {scenario.meetsTarget
                ? `${inr(scenario.scenarioSavings)} saved against a ${inr(scenario.targetSavings)} target.`
                : `Step 3 shows the easiest way to close the gap.`}
            </p>
          </div>
        </div>

        <OutcomeBars scenario={scenario} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2">
        {/* 2. Controls */}
        <div className="px-5 sm:px-6 py-5 space-y-5 lg:border-r border-line">
          <div className="flex items-start justify-between gap-3">
            <StepHeader n={2} title="Try a change" hint="Each slider stops at the most that category can realistically give." />
            <button
              onClick={reset}
              disabled={!hasChanges}
              className="shrink-0 text-micro flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-line text-ink-2 hover:text-ink hover:border-line-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>

          {presets.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {presets.map(p => (
                <button
                  key={p.id}
                  onClick={() => runPreset(p)}
                  className={`text-micro px-2.5 py-1 rounded-full border transition-colors ${
                    activePreset === p.id
                      ? 'bg-accent text-canvas border-accent font-medium'
                      : 'bg-raised text-ink-2 border-line hover:text-ink hover:border-line-strong'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-4">
            {activeCategories.map(c => {
              const policy = policyFor(c.category);
              const outcome = scenario.categories.find(o => o.category === c.category)!;
              const value = changes[c.category] ?? 0;
              const id = `sim-${c.category}`;
              return (
                <div key={c.category}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <label htmlFor={id} className="flex items-center gap-2 text-ink font-medium">
                      <CategoryBadge name={c.category} size="sm" />
                      {c.category}
                    </label>
                    <span className="text-right tabular">
                      <span className="text-ink-3">{inr(outcome.baseline)}</span>
                      {value !== 0 && <span className="text-ink"> → {inr(outcome.adjusted)}</span>}
                      <span className={`ml-2 inline-block w-12 text-right font-medium ${
                        value < 0 ? 'text-pos' : value > 0 ? 'text-caution' : 'text-ink-3'
                      }`}>
                        {signedPct(value)}
                      </span>
                    </span>
                  </div>
                  <RangeRow
                    id={id}
                    min={-policy.maxCutPct}
                    max={SLIDER_MAX_RAISE}
                    value={value}
                    onChange={v => { setChanges(prev => ({ ...prev, [c.category]: v })); setActivePreset(null); }}
                    fill={categoryColor(c.category)}
                    ariaValueText={`${signedPct(value)}, ${inr(outcome.adjusted)} per month`}
                    leftCap={`−${policy.maxCutPct}%`}
                    rightCap={`+${SLIDER_MAX_RAISE}%`}
                  />
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-line">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <label htmlFor="sim-income" className="text-ink font-medium">Monthly income</label>
              <span className="text-right tabular">
                <span className="text-ink-3">{inr(scenario.baselineIncome)}</span>
                {incomeChange !== 0 && <span className="text-ink"> → {inr(scenario.scenarioIncome)}</span>}
                <span className={`ml-2 inline-block w-12 text-right font-medium ${
                  incomeChange > 0 ? 'text-pos' : incomeChange < 0 ? 'text-neg' : 'text-ink-3'
                }`}>
                  {signedPct(incomeChange)}
                </span>
              </span>
            </div>
            <RangeRow
              id="sim-income"
              min={-30}
              max={30}
              value={incomeChange}
              onChange={v => { setIncomeChange(v); setActivePreset(null); }}
              fill={incomeChange < 0 ? C.neg : C.pos}
              ariaValueText={`${signedPct(incomeChange)}, ${inr(scenario.scenarioIncome)} per month`}
              leftCap="−30%"
              rightCap="+30%"
            />
          </div>
        </div>

        {/* 3. The plan */}
        <div className="px-5 sm:px-6 py-5 space-y-5 border-t lg:border-t-0 border-line">
          <StepHeader
            n={3}
            title="The lowest-effort plan"
            hint="Where FinAI would take the money from to reach the goal."
          />

          {plan.alreadyMet ? (
            <div className="p-4 rounded-md bg-sunken border border-line flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-pos shrink-0 mt-px" />
              <p className="text-xs text-ink-2">
                Your current spending already meets a {goal}% goal, so no cuts are needed. Raise the goal to see a plan.
              </p>
            </div>
          ) : (
            <>
              {plan.effortSavedPct !== null ? (
                <div className="p-4 rounded-md bg-sunken border border-line">
                  <p className="text-4xl font-semibold tracking-tight text-accent">{plan.effortSavedPct}%</p>
                  <p className="text-xs text-ink-2 mt-1.5 leading-relaxed">
                    less effort than cutting every category by the same {plan.uniform.cutPct}%, for the same{' '}
                    <span className="text-ink">{inr(plan.requiredReduction)}</span> a month of savings.
                  </p>
                  <details className="mt-3 text-xs text-ink-2">
                    <summary className="cursor-pointer text-ink hover:text-accent">How effort is measured</summary>
                    <div className="mt-2 space-y-2 leading-relaxed">
                      <p>
                        Each cut is scored by its size relative to that category's spending, times a weight for how hard the
                        category is to change:{' '}
                        {Object.entries(CATEGORY_POLICY).map(([cat, p], i, all) => (
                          <span key={cat}>{cat} {p.effort}{i < all.length - 1 ? ', ' : '.'}</span>
                        ))}
                      </p>
                      <p>
                        These weights and the per-category limits are FinAI's assumptions, not measured from your behaviour.
                        Both plans are scored the same way. Within those assumptions the plan above is the lowest-effort way to
                        reach the goal; the project's tests check this against a brute-force search.
                      </p>
                    </div>
                  </details>
                </div>
              ) : (
                <div className="p-4 rounded-md bg-caution/10 border border-caution/30 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-caution shrink-0 mt-px" />
                  <p className="text-xs text-ink-2">
                    Spending needs to fall by {inr(plan.requiredReduction)} a month, but within the cut limits it can
                    fall by at most {inr(plan.achievedReduction)}. This goal also needs more income.
                  </p>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro text-ink-3">
                  <span><span className="text-ink-2">Upper bar</span> this plan</span>
                  <span><span className="text-ink-2">Lower bar</span> an equal {plan.uniform.cutPct}% cut everywhere</span>
                  <span className="flex items-center gap-1.5"><span className="w-px h-3 bg-ink-2" />Limit</span>
                </div>

                <PlanComparison plan={plan} />

                {!plan.uniform.withinLimits && (
                  <p className="text-micro text-neg flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                    An equal cut would take more from some categories than they allow — shown in red.
                  </p>
                )}
              </div>

              {plannedCuts.length > 0 && (
                <button
                  onClick={() => runPreset({ id: 'optimizer', apply: () => { setIncomeChange(0); setChanges(planToChanges(plan)); } })}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-accent text-canvas text-sm font-medium hover:bg-accent-hi transition-colors"
                >
                  <WandSparkles className="w-4 h-4" />
                  Apply this plan to the sliders
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Explanation */}
      <div className="px-5 sm:px-6 py-5 border-t border-line bg-sunken space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-ink">In plain words</h3>
            <p className="text-micro text-ink-3 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0" />
              Cut limits and effort weights are modelling assumptions, not measured from users.
            </p>
          </div>
          <button
            onClick={explain}
            disabled={explaining}
            className="shrink-0 text-xs flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-raised border border-line text-ink hover:border-accent/50 disabled:opacity-60 transition-colors self-start sm:self-auto"
          >
            {explaining ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : <Sparkles className="w-3.5 h-3.5 text-accent" />}
            {explaining ? 'Explaining…' : 'Explain this scenario'}
          </button>
        </div>

        {explainError && (
          <p className="text-xs text-neg">The explanation could not be loaded ({explainError}). Try again.</p>
        )}

        {explanation && (
          <div className="p-4 rounded-md bg-surface border border-line space-y-2.5" aria-live="polite">
            <p className="text-sm text-ink leading-relaxed">{explanation.explanation}</p>
            <p className="text-micro text-ink-2 flex items-start gap-1.5 pt-2 border-t border-line">
              {explanation.source === 'gemini'
                ? <Check className="w-3.5 h-3.5 text-pos shrink-0 mt-px" />
                : <ShieldCheck className="w-3.5 h-3.5 text-accent shrink-0 mt-px" />}
              <span>
                {explanation.source === 'gemini'
                  ? 'Written by Gemini. Every number in it was checked against the simulator before it was shown.'
                  : explanation.note ?? 'Built-in explanation from the simulator.'}
              </span>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
