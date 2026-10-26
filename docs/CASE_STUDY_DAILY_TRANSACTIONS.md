# Forecasting case study: Daily Transactions (Kaggle)

**Dataset:** "Daily Transactions Dataset" by Prasad Patil, at kaggle.com/datasets/prasad22/daily-transactions-dataset.

- 2,461 rows, one individual, INR only, 1 Jan 2015 – 20 Sep 2018.
- The dataset page describes it as dummy data.
- **Licence:** *to be filled in from the Kaggle page before use in the report.*

**Why:** an independent check of the 40-user backtest on data FinAI did not generate.

**Script:** `ml-service/case_study_daily_transactions.py`. The protocol is described at the top of the file:

- weekly totals, a 4-week horizon, and origins every 4 weeks from 26 weeks of history;
- MASE on a one-week naive scale, with a paired bootstrap over origins;
- savings products (Investment, PPF, RD, all Transfer-Out rows) excluded from spending.

**Verified here (25 Oct):**
- the MASE arithmetic matches an independent hand calculation;
- forecasts use only past weeks;
- a forecast is counted as Chronos-2 only when the service reports `model == "chronos-2"` (tested with a stub service in both modes).

## Results (run on the laptop with Chronos-2, 25 Oct 2026)

Weeks: 193 (2015-01-05 to 2018-09-16). Origins: 41 (34 for seasonal naive, which needs 52 weeks).

| Series | Chronos-2 | SES | MA-8 | Seasonal naive 52 | Naive last |
|---|---|---|---|---|---|
| All spending (mean ₹8,038/week) | **0.746** | 0.911 | 0.937 | 0.996 | 1.152 |
| Regular spending, excl. money transfers (mean ₹4,895/week) | **1.052** | 1.191 | 1.220 | 1.749 | 1.455 |

**Chronos-2 minus the best baseline (SES), paired over the same 41 origins:**
- All spending: **−0.165** MASE, 95% CI [−0.245, −0.083]. Chronos-2 is better.
- Regular spending: **−0.139** MASE, 95% CI [−0.285, −0.018]. Chronos-2 is better.

## How to read it

- **Consistent with the main 40-user backtest,** where Chronos-2 scored 0.742 vs SES 0.863 over 52–126 weeks of history. The near-identical MASE is partly coincidence; the claim is agreement in direction, not equality.
- **One individual:** a case study, not a general result. The 41 origins come from one person's history and are not independent, so the bootstrap intervals are likely optimistic.
- **Regular spending stays above 1.0 MASE** for every method: day-to-day spending is hard to predict. Chronos-2 was the best available, not accurate in absolute terms.
- **Dummy data:** the dataset's uploader describes it as dummy data.
- **Bug fixed during the run:** a crash in selecting the best baseline was fixed and the whole script re-tested end to end before the run above. The forecasts themselves were unaffected.
