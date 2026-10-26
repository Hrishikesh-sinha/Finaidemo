// Backtest figures for the forecast card, and the rule for which one applies
// to a given user. Shared by the server and the UI so neither hardcodes them.
//
// Source: the rolling-origin backtest reported in ml-service/app/main.py and
// ml-service/README.md (40 synthetic users, 130 weeks, 19 origins, 4-week
// horizon, MASE, 95% CIs bootstrapped over users), which cite
// finai_exp2_forecasting.ipynb. That notebook was not available when this
// file was written, so these figures are reproduced from the project's own
// documentation and have NOT been re-verified against the notebook.
//
// These are benchmark results on synthetic data. They describe how the method
// performed in the backtest, not how accurate a particular user's forecast is.

export interface BenchmarkCohort {
  id: 'h26' | 'h52_126';
  // History lengths the backtest evaluated for this row.
  evaluated: string;
  chronosMase: number;
  baselineName: string;
  baselineMase: number;
  diff: number;
  ci95: [number, number];
}

export const BENCHMARK_COHORTS: Record<BenchmarkCohort['id'], BenchmarkCohort> = {
  h26: {
    id: 'h26',
    evaluated: 'exactly 26 weeks of history',
    chronosMase: 0.841,
    baselineName: '8-week moving average',
    baselineMase: 0.882,
    diff: -0.041,
    ci95: [-0.063, -0.019]
  },
  h52_126: {
    id: 'h52_126',
    evaluated: '52 to 126 weeks of history (all origins pooled)',
    chronosMase: 0.742,
    baselineName: 'simple exponential smoothing',
    baselineMase: 0.863,
    diff: -0.121,
    ci95: [-0.151, -0.092]
  }
};

// Documented but UNRESOLVED: the 52-week row. Chronos-2 is 0.783 in both
// sources, but the baseline differs: README says 8-week MA 0.882 (diff
// -0.099 [-0.134, -0.064]); main.py says SES 0.871 (diff -0.088
// [-0.117, -0.060]). Only the notebook can settle it, so it is not shown.
export const UNRESOLVED_52_WEEK_ROW = {
  chronosMase: 0.783,
  readme: { baselineName: '8-week moving average', baselineMase: 0.882 },
  mainPy: { baselineName: 'simple exponential smoothing', baselineMase: 0.871 }
} as const;

export const MIN_WEEKS_FOR_CHRONOS = 26;
export const MAX_WEEKS_EVALUATED = 126;

export type Applicability = 'not-used' | 'exact' | 'in-range' | 'nearest-lower' | 'beyond-range';

export interface BenchmarkSelection {
  cohort: BenchmarkCohort | null;
  applicability: Applicability;
  note: string;
}

export function benchmarkFor(weeksOfHistory: number): BenchmarkSelection {
  const w = Math.floor(Number(weeksOfHistory) || 0);
  if (w < MIN_WEEKS_FOR_CHRONOS) {
    return {
      cohort: null,
      applicability: 'not-used',
      note: `Chronos-2 is not used below ${MIN_WEEKS_FOR_CHRONOS} weeks of history, so no Chronos-2 benchmark applies.`
    };
  }
  if (w < 52) {
    return w === 26
      ? { cohort: BENCHMARK_COHORTS.h26, applicability: 'exact', note: 'Backtest measured at exactly 26 weeks of history, the same as yours.' }
      : {
          cohort: BENCHMARK_COHORTS.h26,
          applicability: 'nearest-lower',
          note: `You have ${w} weeks of history. The backtest measured 26 and 52 weeks, not ${w}; the 26-week figure is the nearest one that does not overstate.`
        };
  }
  if (w <= MAX_WEEKS_EVALUATED) {
    return {
      cohort: BENCHMARK_COHORTS.h52_126,
      applicability: 'in-range',
      note: `Your ${w} weeks fall inside the 52–126-week range this backtest row pooled.`
    };
  }
  return {
    cohort: BENCHMARK_COHORTS.h52_126,
    applicability: 'beyond-range',
    note: `You have ${w} weeks of history, more than the longest backtest origin (${MAX_WEEKS_EVALUATED} weeks); this is the closest row.`
  };
}

// Relative error reduction, e.g. 0.742 vs 0.863 -> 14.
export function errorReductionPct(c: BenchmarkCohort): number {
  return Math.round((1 - c.chronosMase / c.baselineMase) * 100);
}
