// Measured results shown in Settings, "Data & models". Each figure is copied
// from the experiment report named next to it; nothing here is computed in
// the browser. Live facts (service status, the model's own training details)
// come from GET /api/models instead.

export const KAGGLE_DATASET = {
  name: 'Daily Transactions Dataset',
  author: 'Prasad Patil',
  url: 'https://www.kaggle.com/datasets/prasad22/daily-transactions-dataset',
  rows: 2461,
  period: 'Jan 2015 – Sep 2018',
  currency: 'INR',
  description: "one individual's daily transactions, described by its author as dummy data",
  // Set once confirmed from the Kaggle page; until then the UI points there.
  licence: null as string | null
};

// docs/CATEGORIZER_EXPERIMENT.md
export const CATEGORIZER_RESULT = {
  testPeriod: 'Jan – Sep 2018',
  testRows: 564,
  hybridAccuracy: 91.0,
  rulesAccuracy: 27.8,
  diffCi: [59.0, 67.2] as [number, number],
  merchantsKept: '20 of 20',
  caveat: "One person's vocabulary; not evidence for Indian spending descriptions in general."
};

// src/forecast/benchmark.ts (40 synthetic users) and
// docs/CASE_STUDY_DAILY_TRANSACTIONS.md (Kaggle, one individual)
export const FORECAST_RESULTS = {
  synthetic: { label: '40 synthetic users, 52–126 weeks of history', chronos: 0.742, baseline: 0.863, baselineName: 'exponential smoothing' },
  kaggle: { label: 'Kaggle dataset, one individual, 193 weeks', chronos: 0.746, baseline: 0.911, baselineName: 'exponential smoothing', ci: [-0.245, -0.083] as [number, number] }
};
