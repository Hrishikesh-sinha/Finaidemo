// Categorizer experiment on the Kaggle Daily Transactions dataset.
//
//   npm run train:categorizer -- data/kaggle/Daily_Household_Transactions.csv
//
// Time-based split, so nothing is learned from the period it is tested on:
//   fit         2015-01-01 .. 2017-06-30   (learn)
//   validation  2017-07-01 .. 2017-12-31   (choose smoothing and the combination rule)
//   test        2018-01-01 .. 2018-09-20   (scored once, at the end)
// Candidates: the existing keyword rules, the Naive Bayes model, and a hybrid.
// The final model is retrained on fit + validation and saved to
// src/server/categorizerModel.json; the report goes to
// docs/CATEGORIZER_EXPERIMENT.md. A model is adopted only if the chosen
// candidate beats the rules on the test period and keeps every one of
// FinAI's own demo merchants correct.

import fs from 'node:fs';
import path from 'node:path';
import { ruleCategory } from '../src/server/categorize';
import { CATEGORY_MAP, SAVINGS_CATEGORIES, parseCsv, parseDayFirst } from '../src/server/kaggleImport';
import { NB_CATEGORIES, predictNb, trainNb, type NbCategory, type NbModel } from '../src/server/nbCategorizer';

type Example = { text: string; label: NbCategory; ts: number };
type Predictor = (text: string) => string;

const FIT_END = Date.UTC(2017, 6, 1);
const VALID_END = Date.UTC(2018, 0, 1);
const SEED = 7;

// FinAI's own demo merchants and the category each must keep.
const FINAI_MERCHANTS: [string, string][] = [
  ['Rent', 'Bills'], ['Electric Utility', 'Bills'], ['Internet Provider', 'Bills'],
  ['Local Restaurant', 'Food'], ['Whole Foods', 'Food'], ['Starbucks', 'Food'], ['Cafe Coffee Day', 'Food'], ['Swiggy Gourmet', 'Food'],
  ['Uber Ride', 'Transport'], ['MTA Subway Pass', 'Transport'], ['Lyft Commute', 'Transport'], ['City Metro Transit', 'Transport'],
  ['Amazon Marketplace', 'Shopping'], ['Target Store', 'Shopping'], ['Myntra', 'Shopping'], ['Decathlon', 'Shopping'],
  ['Netflix Subscription', 'Entertainment'], ['PVR Cinema & IMAX', 'Entertainment'], ['Spotify Premium', 'Entertainment'], ['BookMyShow', 'Entertainment']
];

function load(csvPath: string): Example[] {
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf-8').replace(/^\uFEFF/, ''));
  const h = rows[0].map(x => x.trim());
  const ix = (n: string) => h.indexOf(n);
  const out: Example[] = [];
  for (const r of rows.slice(1)) {
    if (r[ix('Income/Expense')] !== 'Expense' || SAVINGS_CATEGORIES.has(r[ix('Category')])) continue;
    const label = CATEGORY_MAP[r[ix('Category')]] as NbCategory;
    const text = [r[ix('Subcategory')], r[ix('Note')]].map(s => (s || '').trim()).filter(Boolean).join(' ');
    const ts = parseDayFirst(r[ix('Date')]);
    if (!text || !label || !Number.isFinite(ts)) continue;
    out.push({ text, label, ts });
  }
  return out;
}

const accuracy = (data: Example[], p: Predictor) => data.filter(e => p(e.text) === e.label).length / data.length;

function macroF1(data: Example[], p: Predictor): number {
  const f1s = NB_CATEGORIES.map(c => {
    let tp = 0, fp = 0, fn = 0;
    for (const e of data) {
      const y = p(e.text);
      if (y === c && e.label === c) tp++;
      else if (y === c) fp++;
      else if (e.label === c) fn++;
    }
    return tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  });
  return f1s.reduce((a, b) => a + b, 0) / f1s.length;
}

// Paired bootstrap over test rows for accuracy(a) - accuracy(b).
function bootstrapDiff(data: Example[], a: Predictor, b: Predictor, reps = 2000): [number, number, number] {
  const da = data.map(e => (a(e.text) === e.label ? 1 : 0) - (b(e.text) === e.label ? 1 : 0));
  let state = SEED >>> 0;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  const means: number[] = [];
  for (let r = 0; r < reps; r++) {
    let s = 0;
    for (let i = 0; i < da.length; i++) s += da[Math.floor(rand() * da.length)];
    means.push(s / da.length);
  }
  means.sort((x, y) => x - y);
  return [da.reduce((x, y) => x + y, 0) / da.length, means[Math.floor(reps * 0.025)], means[Math.floor(reps * 0.975)]];
}

const rulesOnly: Predictor = t => ruleCategory(t) ?? 'Shopping';
const nbOnly = (m: NbModel): Predictor => t => predictNb(m, t)?.label ?? 'Shopping';
// Rules first (they encode brand names the dataset never saw), model next.
const hybridRulesFirst = (m: NbModel): Predictor => t => ruleCategory(t) ?? predictNb(m, t)?.label ?? 'Shopping';
// Model first when confident, then rules.
const hybridModelFirst = (m: NbModel, tau: number): Predictor => t => {
  const p = predictNb(m, t);
  if (p && p.probability >= tau) return p.label;
  return ruleCategory(t) ?? p?.label ?? 'Shopping';
};

function confusion(data: Example[], p: Predictor): string[] {
  const m: Record<string, Record<string, number>> = Object.fromEntries(NB_CATEGORIES.map(a => [a, Object.fromEntries(NB_CATEGORIES.map(b => [b, 0]))]));
  for (const e of data) m[e.label][p(e.text)]++;
  return [
    `| true \\ predicted | ${NB_CATEGORIES.join(' | ')} |`,
    `|---|${NB_CATEGORIES.map(() => '---').join('|')}|`,
    ...NB_CATEGORIES.map(a => `| ${a} | ${NB_CATEGORIES.map(b => m[a][b]).join(' | ')} |`)
  ];
}

function main() {
  const csv = process.argv[2];
  if (!csv) throw new Error('Usage: npm run train:categorizer -- <csv>');
  const all = load(csv);
  const fit = all.filter(e => e.ts < FIT_END);
  const valid = all.filter(e => e.ts >= FIT_END && e.ts < VALID_END);
  const test = all.filter(e => e.ts >= VALID_END);
  const counts = (d: Example[]) => NB_CATEGORIES.map(c => `${c} ${d.filter(e => e.label === c).length}`).join(', ');

  // ---- choose settings on validation only ----
  const candidates: { name: string; build: (m: NbModel) => Predictor; alpha: number }[] = [];
  for (const alpha of [0.1, 0.3, 0.5, 1]) {
    candidates.push({ name: `Naive Bayes (alpha ${alpha})`, build: m => nbOnly(m), alpha });
    candidates.push({ name: `Hybrid, rules first (alpha ${alpha})`, build: m => hybridRulesFirst(m), alpha });
    for (const tau of [0.6, 0.8, 0.9]) candidates.push({ name: `Hybrid, model first at p>=${tau} (alpha ${alpha})`, build: m => hybridModelFirst(m, tau), alpha });
  }
  // Requirement fixed in advance, not learned from any test data: FinAI's own
  // merchants must stay correct. Selection is the best validation accuracy
  // among candidates that meet it.
  const scored = candidates.map(c => {
    const m = trainNb(fit, c.alpha);
    const p = c.build(m);
    return { ...c, valAcc: accuracy(valid, p), valF1: macroF1(valid, p), merchants: FINAI_MERCHANTS.filter(([t, cat]) => p(t) === cat).length };
  }).sort((a, b) => b.valAcc - a.valAcc || b.valF1 - a.valF1);
  const eligible = scored.filter(c => c.merchants === FINAI_MERCHANTS.length);
  if (eligible.length === 0) throw new Error('No candidate keeps FinAI\'s own merchants correct');
  const chosen = eligible[0];
  const rulesVal = accuracy(valid, rulesOnly);

  // ---- retrain on fit + validation, score the test period once ----
  const final = trainNb([...fit, ...valid], chosen.alpha, 'Kaggle Daily Transactions, 2015-01-01 to 2017-12-31');
  const nbFinal = nbOnly(final);
  const chosenFinal = chosen.build(final);
  const rows = [
    ['Keyword rules (current)', rulesOnly],
    [`Naive Bayes alone (alpha ${chosen.alpha}), for reference: fails FinAI merchants`, nbFinal],
    [`Chosen: ${chosen.name}`, chosenFinal]
  ] as const;
  const [diff, lo, hi] = bootstrapDiff(test, chosenFinal, rulesOnly);
  const merchantsOk = FINAI_MERCHANTS.filter(([m, c]) => chosenFinal(m) === c).length;
  const rulesMerchantsOk = FINAI_MERCHANTS.filter(([m, c]) => rulesOnly(m) === c).length;
  const majority = Math.max(...NB_CATEGORIES.map(c => test.filter(e => e.label === c).length)) / test.length;
  const adopt = lo > 0 && merchantsOk === FINAI_MERCHANTS.length;

  if (adopt) fs.writeFileSync(path.join('src', 'server', 'categorizerModel.json'), JSON.stringify(final));

  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const md = [
    '# Categorizer experiment: Kaggle Daily Transactions', '',
    'Dataset: Daily Transactions Dataset (Prasad Patil, Kaggle), one individual, INR, described by its author as dummy data. ' +
      'Spending rows only (savings products excluded), text = subcategory + note, label = the dataset\'s category mapped onto FinAI\'s five.', '',
    `Split by time: fit ${fit.length} rows (2015-01 to 2017-06), validation ${valid.length} (2017-07 to 2017-12), test ${test.length} (2018-01 to 2018-09).`,
    `Test class counts: ${counts(test)}. Always guessing the most common class scores ${pct(majority)}.`, '',
    `Settings chosen on validation only, among candidates that keep all ${FINAI_MERCHANTS.length} of FinAI's demo merchants correct ` +
      `(a requirement fixed before any test data was seen): **${chosen.name}** (validation accuracy ${pct(chosen.valAcc)}; rules ${pct(rulesVal)}). ` +
      `${scored.length} candidates were compared; ${eligible.length} met the requirement.`, '',
    '## Test period (2018), scored once', '',
    '| Method | Accuracy | Macro F1 |', '|---|---|---|',
    ...rows.map(([n, p]) => `| ${n} | ${pct(accuracy(test, p))} | ${macroF1(test, p).toFixed(3)} |`), '',
    `Chosen minus rules, paired bootstrap over ${test.length} test rows: ${diff >= 0 ? '+' : ''}${(100 * diff).toFixed(1)} points, ` +
      `95% CI [${(100 * lo).toFixed(1)}, ${(100 * hi).toFixed(1)}].`, '',
    `FinAI's own demo merchants kept correct: chosen ${merchantsOk}/${FINAI_MERCHANTS.length}, rules ${rulesMerchantsOk}/${FINAI_MERCHANTS.length}.`, '',
    `**Decision: ${adopt ? 'adopted' : 'NOT adopted'}.** ` +
      (adopt ? 'The model is saved to src/server/categorizerModel.json and used by the server.' :
        'The rules stay; no model file was written.'), '',
    '### Confusion on the test period, chosen method', '', ...confusion(test, chosenFinal), '',
    '### Confusion on the test period, rules', '', ...confusion(test, rulesOnly), '',
    '### Validation ranking (all candidates)', '', '| Candidate | Validation accuracy | Validation macro F1 | FinAI merchants correct |', '|---|---|---|---|',
    ...scored.map(c => `| ${c.name} | ${pct(c.valAcc)} | ${c.valF1.toFixed(3)} | ${c.merchants}/${FINAI_MERCHANTS.length} |`), '',
    'Caveats: one individual\'s descriptions; the category mapping onto FinAI\'s five is a judgement call; ' +
      'short notes repeat often (e.g. "Milk"), so results describe this person\'s vocabulary, not Indian spending in general.'
  ];
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync(path.join('docs', 'CATEGORIZER_EXPERIMENT.md'), md.join('\n') + '\n');
  console.log(md.join('\n'));
}

main();
