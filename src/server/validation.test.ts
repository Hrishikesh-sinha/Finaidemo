import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseDate, parseVoiceText, validateNewTransaction, validateTransactionUpdate, validateRegistration, MAX_AMOUNT } from './validation';

const NOW = Date.UTC(2026, 9, 23, 12);
const isErr = (r: object) => 'error' in r;

test('amounts: positive, finite, at most 2 decimals, within the documented cap', () => {
  assert.deepEqual(parseAmount(350), { value: 350 });
  assert.deepEqual(parseAmount('99.50'), { value: 99.5 });
  for (const bad of [0, -5, NaN, Infinity, 1e15, MAX_AMOUNT + 1, 1.005, '12abc', '', null, undefined, true, '1e3']) {
    assert.ok(isErr(parseAmount(bad)), `accepted ${String(bad)}`);
  }
  assert.deepEqual(parseAmount(MAX_AMOUNT), { value: MAX_AMOUNT });
});

test('dates: real calendar dates only, not before 2000, not in the future', () => {
  assert.deepEqual(parseDate('2026-10-20', NOW), { value: '2026-10-20T00:00:00.000Z' });
  assert.deepEqual(parseDate('2026-10-20T08:30:00.000Z', NOW), { value: '2026-10-20T08:30:00.000Z' });
  // Today in IST, stored at 00:00 UTC, is still accepted.
  assert.ok(!isErr(parseDate('2026-10-24', NOW)));
  for (const bad of ['not-a-date', '2026-02-30', '2026-13-01', '2026-10-32', '1999-12-31', '2027-01-01', '20/10/2026', '2026-10-20T25:00:00Z', 12345]) {
    assert.ok(isErr(parseDate(bad, NOW)), `accepted ${bad}`);
  }
});

test('new transaction: the Phase-1 failures are now 400-style errors', () => {
  assert.ok(isErr(validateNewTransaction({ amount: 100, merchant: 'x', date: 'not-a-date' }, NOW)));
  assert.ok(isErr(validateNewTransaction({ amount: 1e15, merchant: 'x' }, NOW)));
  assert.ok(isErr(validateNewTransaction({ amount: 10, merchant: 'x', category: 'Hacking' }, NOW)));
  assert.ok(isErr(validateNewTransaction({ amount: 10 }, NOW)), 'merchant is required');
  assert.ok(isErr(validateNewTransaction({ amount: 10, merchant: 'x'.repeat(101) }, NOW)));
  assert.ok(isErr(validateNewTransaction(null, NOW)));
});

test('new transaction: valid input is normalised, and category is predicted when omitted', () => {
  const r = validateNewTransaction({ amount: '450', merchant: '  Uber   Ride ', category: 'transport', date: '2026-10-21' }, NOW) as any;
  assert.deepEqual(r.value, { amount: 450, merchant: 'Uber Ride', category: 'Transport', date: '2026-10-21T00:00:00.000Z' });
  const p = validateNewTransaction({ amount: 300, merchant: 'Starbucks' }, NOW) as any;
  assert.equal(p.value.category, 'Food');
  assert.equal(p.value.date, new Date(NOW).toISOString());
});

test('update: same rules, partial fields, unknown fields refused', () => {
  assert.deepEqual(validateTransactionUpdate({ amount: 20 }, NOW), { value: { amount: 20 } });
  assert.ok(isErr(validateTransactionUpdate({}, NOW)));
  assert.ok(isErr(validateTransactionUpdate({ user_id: 'someone_else' }, NOW)));
  assert.ok(isErr(validateTransactionUpdate({ amount: -1 }, NOW)));
  assert.ok(isErr(validateTransactionUpdate({ date: '2026-02-30' }, NOW)));
});

test('voice: a missing amount is an error, never a made-up ₹50', () => {
  const r = parseVoiceText('bought lunch') as any;
  assert.ok(r.error && /No amount/.test(r.error));
  assert.ok(!('value' in r));
});

test('voice: amounts with Indian grouping and a merchant after "at"', () => {
  assert.deepEqual((parseVoiceText('Spent 350 rupees on books at Crossword') as any).value, { amount: 350, merchant: 'Crossword', category: 'Shopping' });
  assert.equal((parseVoiceText('paid 1,20,000 rent for October') as any).value.amount, 120000);
  assert.ok(isErr(parseVoiceText('')));
  assert.ok(isErr(parseVoiceText('x'.repeat(301))));
});

test('registration: username, password length and income are checked', () => {
  assert.ok(!isErr(validateRegistration({ username: 'asha_k', password: 'longenough' })));
  assert.ok(isErr(validateRegistration({ username: 'a', password: 'longenough' })));
  assert.ok(isErr(validateRegistration({ username: 'bad name', password: 'longenough' })));
  assert.ok(isErr(validateRegistration({ username: 'asha', password: 'short' })));
  assert.ok(isErr(validateRegistration({ username: 'asha', password: 'longenough', monthly_income: -1 })));
});
