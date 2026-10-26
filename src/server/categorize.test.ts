import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorize, predictCategory, ruleCategory } from './categorize';

test('keyword rules still win for the brands they know', () => {
  for (const [t, c] of [['Uber Ride', 'Transport'], ['Netflix Subscription', 'Entertainment'], ['Swiggy dinner', 'Food'], ['Electric Utility', 'Bills'], ['Amazon Marketplace', 'Shopping']] as const) {
    assert.deepEqual(categorize(t), { category: c, method: 'rule' }, t);
  }
});

test('descriptions the rules do not know go to the learned model', () => {
  for (const [t, c] of [['Milk half litre', 'Food'], ['6 kachori snacks', 'Food'], ['Lunch catering service', 'Food']] as const) {
    assert.equal(ruleCategory(t), null, `rules know nothing about "${t}"`);
    const g = categorize(t);
    assert.equal(g.method, 'model');
    assert.equal(g.category, c, t);
  }
});

test('text with no known word falls back to Shopping, as before', () => {
  assert.deepEqual(categorize('zzz qqq'), { category: 'Shopping', method: 'default' });
  assert.equal(predictCategory(''), 'Shopping');
});
