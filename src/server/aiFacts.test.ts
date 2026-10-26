import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryFacts, templateChat, templateInsights, templateReport } from './aiFacts';
import { summarize } from './reporting';
import { generateDemoSeed } from './seed';
import { checkGrounding } from '../simulator/grounding';
import type { StoredUser } from './types';

const SEEDED_AT = new Date('2026-10-14T10:22:15.941Z');
const at = (iso: string) => new Date(iso).getTime();

const cases: [string, StoredUser, number][] = [
  ['complete log, saving', { id: 'u', username: 'u', monthly_income: 50000, target_savings_percent: 20 }, at('2026-10-14T12:00:00Z')],
  ['stale log (review day)', { id: 'u', username: 'u', monthly_income: 50000, target_savings_percent: 20 }, at('2026-10-28T10:00:00Z')],
  ['spending exceeds income', { id: 'u', username: 'u', monthly_income: 20000, target_savings_percent: 25 }, at('2026-10-14T12:00:00Z')],
  ['target already met', { id: 'u', username: 'u', monthly_income: 200000, target_savings_percent: 10 }, at('2026-10-14T12:00:00Z')]
];

for (const [name, user, now] of cases) {
  test(`templates pass their own grounding check: ${name}`, () => {
    const s = summarize(user, generateDemoSeed('u', SEEDED_AT), now);
    const facts = buildSummaryFacts(s);
    for (const line of templateInsights(s)) assert.ok(checkGrounding(line, facts.allowed).ok, line);
    assert.ok(checkGrounding(templateReport(s), facts.allowed).ok, templateReport(s));
    for (const q of ['how much am I saving?', 'where do I spend most', 'any anomalies?', 'hello']) {
      const reply = templateChat(s, q);
      assert.ok(checkGrounding(reply, facts.allowed).ok, reply);
    }
  });
}

test('a stale log is stated in the facts and the report', () => {
  const s = summarize({ id: 'u', username: 'u', monthly_income: 50000, target_savings_percent: 20 }, generateDemoSeed('u', SEEDED_AT), at('2026-10-28T10:00:00Z'));
  assert.ok(buildSummaryFacts(s).lines.some(l => l.includes('14 Oct 2026') && l.includes('13 days')));
  assert.ok(templateReport(s).includes('may be understated'));
});

test('an invented figure fails against the summary facts', () => {
  const s = summarize({ id: 'u', username: 'u', monthly_income: 50000, target_savings_percent: 20 }, generateDemoSeed('u', SEEDED_AT), at('2026-10-14T12:00:00Z'));
  const facts = buildSummaryFacts(s);
  assert.equal(checkGrounding('You could save ₹12,345 more by cutting Food.', facts.allowed).ok, false);
});
