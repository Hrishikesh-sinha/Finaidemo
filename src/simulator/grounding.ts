// Grounding for the simulator's plain-language explanation.
//
// Gemini only explains; the engine computes. Every number the engine
// produced is written into a facts block, Gemini is asked to explain using
// only those numbers, and its reply is rejected if it contains any number that
// is not in the facts. On rejection (or when Gemini is unavailable) a
// deterministic template explanation built from the same facts is used, so the
// user always gets an explanation and never gets an invented figure.

import type { FinancialState, GoalPlan, ScenarioResult } from './engine';

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
const signedInr = (n: number) => `${n >= 0 ? '+' : '−'}${inr(Math.abs(n))}`;

// Numbers that may appear without being in the facts: months in a year.
const ALWAYS_ALLOWED = [12];

export interface ExplainFacts {
  // One fact per line, already formatted for reading.
  lines: string[];
  // Every number a grounded explanation may contain.
  allowed: number[];
}

export function baselineDescription(state: FinancialState): string {
  if (state.baselineSource === 'forecast' && state.forecastModel === 'chronos-2') {
    return 'Chronos-2 forecast of the next 30 days, split by your category shares';
  }
  if (state.baselineSource === 'forecast') {
    return 'forecast of the next 30 days (8-week average), split by your category shares';
  }
  return 'your average monthly spending over the last 90 days';
}

export function buildFacts(state: FinancialState, scenario: ScenarioResult, plan: GoalPlan | null): ExplainFacts {
  const lines: string[] = [];
  lines.push(`Baseline spending comes from the ${baselineDescription(state)}.`);
  lines.push(`Monthly income in this scenario: ${inr(scenario.scenarioIncome)}.`);
  lines.push(`Monthly spending: ${inr(scenario.baselineSpend)} now, ${inr(scenario.scenarioSpend)} in this scenario.`);
  lines.push(
    `Monthly savings: ${inr(scenario.baselineSavings)} (${pct(scenario.baselineSavingsRate)} of income) now, ` +
      `${inr(scenario.scenarioSavings)} (${pct(scenario.scenarioSavingsRate)} of income) in this scenario.`
  );
  lines.push(
    `Change in savings: ${signedInr(scenario.monthlySavingsChange)} per month, ${signedInr(scenario.yearlySavingsChange)} over 12 months.`
  );
  lines.push(
    `Savings target: ${pct(scenario.targetSavingsPct)} of income, which is ${inr(scenario.targetSavings)} per month; ` +
      `this scenario ${scenario.meetsTarget ? 'meets' : 'does not meet'} it.`
  );

  for (const c of scenario.categories) {
    if (c.changePct === 0) continue;
    lines.push(
      `${c.category}: ${c.changePct > 0 ? '+' : '−'}${pct(Math.abs(c.changePct))} ` +
        `(${inr(c.baseline)} to ${inr(c.adjusted)} per month)${c.clamped ? ', limited by the allowed range' : ''}.`
    );
  }

  if (plan && !plan.alreadyMet) {
    const planned = plan.cuts.filter(c => c.cut > 0);
    lines.push(
      `To reach the target from the baseline, spending must fall by ${inr(plan.requiredReduction)} per month` +
        (plan.feasible ? '.' : `, but the allowed limits only permit ${inr(plan.achievedReduction)}.`)
    );
    if (planned.length) {
      lines.push(
        `Lowest-effort plan: ` + planned.map(c => `${c.category} −${pct(c.cutPct)} (${inr(c.cut)})`).join(', ') + '.'
      );
    }
    lines.push(
      `Cutting every category equally would need ${pct(plan.uniform.cutPct)} from each` +
        (plan.uniform.withinLimits ? '.' : ', which is more than some categories allow.')
    );
    if (plan.effortSavedPct !== null) {
      lines.push(`The lowest-effort plan needs ${pct(plan.effortSavedPct)} less effort than the equal cut.`);
    }
  } else if (plan && plan.alreadyMet) {
    lines.push('The baseline already meets the savings target, so no cuts are needed.');
  }

  const allowed = [...new Set([...extractNumbers(lines.join(' ')), ...ALWAYS_ALLOWED])];
  return { lines, allowed };
}

// Every number written in a piece of text: "₹1,20,000" -> 120000, "21.3%" -> 21.3.
// Signs are ignored on purpose; facts state direction in words.
export function extractNumbers(text: string): number[] {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches
    .map(m => Number(m.replace(/,/g, '')))
    .filter(n => Number.isFinite(n));
}

export interface GroundingCheck {
  ok: boolean;
  // Numbers in the text that the engine did not produce.
  unsupported: number[];
  reason: string | null;
}

// A number is supported if it equals an allowed number, or that number rounded
// to a whole number or one decimal place ("21%" for 21.3% is fine; "22%" is not).
function isSupported(n: number, allowed: number[]): boolean {
  return allowed.some(a => n === a || n === Math.round(a) || n === Math.round(a * 10) / 10);
}

export function checkGrounding(text: string, allowed: number[]): GroundingCheck {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { ok: false, unsupported: [], reason: 'empty reply' };
  if (trimmed.length > 1500) return { ok: false, unsupported: [], reason: 'reply too long' };

  const unsupported = [...new Set(extractNumbers(trimmed).filter(n => !isSupported(n, allowed)))];
  return unsupported.length
    ? { ok: false, unsupported, reason: `contains numbers the engine did not produce: ${unsupported.join(', ')}` }
    : { ok: true, unsupported: [], reason: null };
}

export function buildPrompt(facts: ExplainFacts): { system: string; user: string } {
  return {
    system:
      'You explain a personal-finance what-if scenario to the user in 3 to 4 short, plain sentences. ' +
      'Use only the numbers that appear in the facts, written exactly as they appear there. ' +
      'Never calculate new numbers: no sums, differences, averages or percentages of your own. ' +
      'Say what changes and whether the savings target is met, and if a lowest-effort plan is listed, mention it. ' +
      'No headings, lists, greetings or advice beyond the facts.',
    user: `Facts:\n${facts.lines.map(l => `- ${l}`).join('\n')}`
  };
}

// Deterministic explanation from the same facts, used whenever Gemini is
// unavailable or its reply fails the grounding check.
export function templateExplanation(state: FinancialState, scenario: ScenarioResult, plan: GoalPlan | null): string {
  const parts: string[] = [];
  const changed = scenario.categories.filter(c => c.changePct !== 0);

  if (changed.length === 0 && scenario.scenarioIncome === scenario.baselineIncome) {
    parts.push(
      `With no changes, you save ${inr(scenario.baselineSavings)} a month (${pct(scenario.baselineSavingsRate)} of income), ` +
        `based on the ${baselineDescription(state)}.`
    );
  } else {
    parts.push(
      `In this scenario you would save ${inr(scenario.scenarioSavings)} a month (${pct(scenario.scenarioSavingsRate)} of income), ` +
        `${signedInr(scenario.monthlySavingsChange)} compared with now, or ${signedInr(scenario.yearlySavingsChange)} over 12 months.`
    );
  }

  parts.push(
    scenario.meetsTarget
      ? `That meets your ${pct(scenario.targetSavingsPct)} savings goal of ${inr(scenario.targetSavings)} a month.`
      : `That is short of your ${pct(scenario.targetSavingsPct)} savings goal of ${inr(scenario.targetSavings)} a month.`
  );

  // The plan only matters when this scenario does not already reach the goal.
  if (plan && !plan.alreadyMet && !scenario.meetsTarget) {
    const planned = plan.cuts.filter(c => c.cut > 0).map(c => `${c.category} by ${pct(c.cutPct)}`);
    if (plan.feasible && planned.length) {
      parts.push(
        `The lowest-effort way to reach it from today's baseline is to cut ${planned.join(', ')}` +
          (plan.effortSavedPct !== null ? `, which takes ${pct(plan.effortSavedPct)} less effort than cutting everything equally.` : '.')
      );
    } else if (!plan.feasible) {
      parts.push(
        `Within the allowed limits, spending can fall by at most ${inr(plan.achievedReduction)} a month, ` +
          `less than the ${inr(plan.requiredReduction)} needed, so the target also needs more income.`
      );
    }
  }

  return parts.join(' ');
}
