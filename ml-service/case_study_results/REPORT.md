# Forecasting case study: Daily Transactions (Kaggle, prasad22)

One individual's spending in INR, 2015-2018. The dataset page calls it dummy data. One person is a case study, not a general result.

Protocol: weekly totals, 4-week horizon, origins every 4 weeks from 26 weeks of history, MASE (one-week naive scale), paired bootstrap over origins (2000 resamples, seed 7). Savings products are excluded from spending.

### All spending

Weeks: 193 (2015-01-05 to 2018-09-16); weeks with no spending: 7; mean ₹8,038 a week, median ₹3,282.

| Model | Mean MASE | Origins |
|---|---|---|
| chronos_2 | 0.746 | 41 |
| ses | 0.911 | 41 |
| moving_avg_8 | 0.937 | 41 |
| seasonal_naive_52 | 0.996 | 34 |
| naive_last | 1.152 | 41 |

Chronos-2 minus best baseline (ses) on the same 41 origins: -0.165 MASE, 95% CI [-0.245, -0.083]. **Chronos-2 is better (interval below zero).**

### Regular spending (excluding Money transfer)

Weeks: 193 (2015-01-05 to 2018-09-16); weeks with no spending: 7; mean ₹4,895 a week, median ₹2,466.

| Model | Mean MASE | Origins |
|---|---|---|
| chronos_2 | 1.052 | 41 |
| ses | 1.191 | 41 |
| moving_avg_8 | 1.220 | 41 |
| naive_last | 1.455 | 41 |
| seasonal_naive_52 | 1.749 | 34 |

Chronos-2 minus best baseline (ses) on the same 41 origins: -0.139 MASE, 95% CI [-0.285, -0.018]. **Chronos-2 is better (interval below zero).**

### Spending by FinAI category (whole period)

| Category | Total |
|---|---|
| Bills | ₹1,073,440 |
| Transport | ₹169,054 |
| Shopping | ₹159,513 |
| Food | ₹96,403 |
| Entertainment | ₹75,122 |
