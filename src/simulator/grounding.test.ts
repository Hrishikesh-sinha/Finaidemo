import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFinancialState, simulateScenario, optimizeForGoal, withForecastBaseline, type TransactionLike } from './engine';
import { buildFacts, checkGrounding, extractNumbers, templateExplanation, buildPrompt } from './grounding';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-18T12:00:00Z');

function makeTxs(): TransactionLike[] {
  const amounts: Record<string, number> = { Bills: 3000, Food: 2000, Transport: 1000, Shopping: 1500, Entertainment: 500 };
  const txs: TransactionLike[] = [];
  for (let d = 0; d < 120; d += 10) {
    const date = new Date(NOW.getTime() - d * DAY).toISOString();
    for (const [category, amount] of Object.entries(amounts)) txs.push({ amount, category, date });
  }
  return txs;
}

const state = buildFinancialState(makeTxs(), { monthly_income: 28000, target_savings_percent: 20 }, NOW);

test('extracts rupee amounts with Indian grouping, decimals and percentages', () => {
  assert.deepEqual(extractNumbers('Save ₹1,20,000 a year, 21.3% of income, cut Food by 7%.'), [120000, 21.3, 7]);
  assert.deepEqual(extractNumbers('no numbers here'), []);
});

test('facts carry the engine numbers', () => {
  const r = simulateScenario(state, { changes: { Shopping: -20 } });
  const facts = buildFacts(state, r, optimizeForGoal(state));
  for (const n of [r.scenarioSavings, r.baselineSpend, r.scenarioSpend, r.targetSavings, 20]) {
    assert.ok(facts.allowed.includes(n), `missing ${n}`);
  }
  const prompt = buildPrompt(facts);
  assert.ok(prompt.user.includes('Shopping'));
  assert.ok(prompt.system.includes('Never calculate new numbers'));
});

test('a reply that uses only engine numbers passes, including a rounded percentage', () => {
  const r = simulateScenario(state, { changes: { Shopping: -20 } });
  const facts = buildFacts(state, r, null);
  const reply = `Cutting Shopping by 20% raises your savings to ₹${r.scenarioSavings.toLocaleString('en-IN')} a month, ` +
    `about ${Math.round(r.scenarioSavingsRate)}% of income, over 12 months that adds ₹${Math.abs(r.yearlySavingsChange).toLocaleString('en-IN')}.`;
  const check = checkGrounding(reply, facts.allowed);
  assert.equal(check.ok, true, check.reason ?? '');
});

test('an invented or rounded-off rupee figure is rejected', () => {
  const r = simulateScenario(state, { changes: { Shopping: -20 } });
  const facts = buildFacts(state, r, null);
  const check = checkGrounding('You could save about ₹5,000 a month and ₹60,000 a year.', facts.allowed);
  assert.equal(check.ok, false);
  assert.ok(check.unsupported.includes(5000));
});

test('a wrong percentage is rejected even when close', () => {
  const r = simulateScenario(state, { changes: {} });
  const facts = buildFacts(state, r, null);
  const wrong = Math.round(r.scenarioSavingsRate) + 1;
  assert.equal(checkGrounding(`You save ${wrong}% of income.`, facts.allowed).ok, false);
});

test('the explanation never claims the goal is met while recommending cuts for it', () => {
  const r = simulateScenario(state, { changes: { Shopping: -20 }, targetSavingsPct: 30 });
  const plan = optimizeForGoal(state, 30);
  const text = templateExplanation(state, r, plan);
  assert.equal(r.meetsTarget, false);
  assert.ok(text.includes('short of your 30% savings goal'));
  const met = simulateScenario(state, { changes: {}, targetSavingsPct: 5 });
  const metText = templateExplanation(state, met, optimizeForGoal(state, 5));
  assert.ok(metText.includes('meets your 5% savings goal') && !metText.includes('lowest-effort'));
});

test('empty and oversized replies are rejected', () => {
  assert.equal(checkGrounding('', [1]).ok, false);
  assert.equal(checkGrounding('x'.repeat(2000), [1]).ok, false);
});

test('the template explanation always passes its own grounding check', () => {
  const cases = [
    { changes: {} },
    { changes: { Shopping: -20, Entertainment: -50 } },
    { changes: { Food: 30 }, incomeChangePct: -10 },
    { changes: { Bills: -80 } }, // clamped
  ];
  const forecastState = withForecastBaseline(state, 26000, 'chronos-2');
  for (const s of [state, forecastState]) {
    for (const target of [20, 60, 5]) {
      for (const input of cases) {
        const r = simulateScenario(s, { ...input, targetSavingsPct: target });
        const plan = optimizeForGoal(s, target);
        assert.equal(r.targetSavingsPct, plan.targetSavingsPct);
        const facts = buildFacts(s, r, plan);
        const text = templateExplanation(s, r, plan);
        const check = checkGrounding(text, facts.allowed);
        assert.equal(check.ok, true, `${check.reason} in: ${text}`);
      }
    }
  }
});
