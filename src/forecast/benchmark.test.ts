import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkFor, errorReductionPct, BENCHMARK_COHORTS, UNRESOLVED_52_WEEK_ROW } from './benchmark';

test('below 26 weeks no Chronos-2 benchmark is shown', () => {
  for (const w of [0, 12, 25]) {
    const b = benchmarkFor(w);
    assert.equal(b.cohort, null);
    assert.equal(b.applicability, 'not-used');
  }
});

test('26-51 weeks use the 26-week row, flagged as nearest-lower unless exactly 26', () => {
  assert.equal(benchmarkFor(26).applicability, 'exact');
  assert.equal(benchmarkFor(26).cohort!.chronosMase, 0.841);
  assert.equal(benchmarkFor(30).applicability, 'nearest-lower');
  assert.equal(benchmarkFor(51).cohort!.id, 'h26');
});

test('the 0.742 figure is only shown for 52+ weeks, never for every user', () => {
  assert.notEqual(benchmarkFor(30).cohort!.chronosMase, 0.742);
  assert.equal(benchmarkFor(52).cohort!.chronosMase, 0.742);
  assert.equal(benchmarkFor(60).applicability, 'in-range');
  assert.equal(benchmarkFor(126).applicability, 'in-range');
  assert.equal(benchmarkFor(200).applicability, 'beyond-range');
});

test('reductions are computed from the figures, not typed in', () => {
  assert.equal(errorReductionPct(BENCHMARK_COHORTS.h52_126), 14);
  assert.equal(errorReductionPct(BENCHMARK_COHORTS.h26), 5);
});

test('the 52-week baseline conflict is recorded, not resolved by guessing', () => {
  assert.notEqual(UNRESOLVED_52_WEEK_ROW.readme.baselineMase, UNRESOLVED_52_WEEK_ROW.mainPy.baselineMase);
  assert.ok(!Object.values(BENCHMARK_COHORTS).some(c => c.chronosMase === UNRESOLVED_52_WEEK_ROW.chronosMase));
});
