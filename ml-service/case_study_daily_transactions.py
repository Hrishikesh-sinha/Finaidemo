"""Forecasting case study on an outside dataset.

Data: "Daily Transactions Dataset" (Prasad Patil, Kaggle,
kaggle.com/datasets/prasad22/daily-transactions-dataset). One individual's
daily transactions in INR, 2015-01-01 to 2018-09-20. The dataset's own page
describes it as dummy data; it is NOT FinAI's synthetic generator, which is
the point: an independent check of the 40-user backtest.

Question: on this person's weekly spending, does Chronos-2 forecast the next
4 weeks better than simple baselines?

Protocol (same as the project's main backtest):
  * Weekly spending totals, weeks starting Monday. Partial first and last
    weeks are dropped. Weeks with no spending stay as zero.
  * Spending = rows marked "Expense", minus savings products (Investment,
    Public Provident Fund, Recurring Deposit). "Transfer-Out" rows (FDs, funds,
    shares, insurance) are savings and never counted.
  * Rolling origins: each origin uses only the weeks before it (no
    lookahead), forecasts the next 4, and origins are 4 weeks apart so the
    test windows never overlap. First origin after 26 weeks of history.
  * MASE: mean absolute error divided by the in-sample mean absolute error of
    a one-week naive forecast on that origin's training weeks.
  * Paired bootstrap over origins (2,000 resamples, fixed seed) for the
    Chronos-2 minus best-baseline difference.
  * Two series: all spending, and regular spending (excluding "Money
    transfer", which here is mostly large lump sums sent home).

Chronos-2 comes from the local FinAI forecasting service
(http://127.0.0.1:8000 by default). An answer counts as Chronos-2 only when
the service reports model == "chronos-2"; while the model is still loading
the service answers with a moving average, and those answers are discarded.
If the service is not running, the baselines are still evaluated and the
report says Chronos-2 was not run.

Usage (from ml-service, with the venv active):
  python case_study_daily_transactions.py ..\\data\\kaggle\\Daily_Household_Transactions.csv
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

HORIZON = 4
STRIDE = 4
MIN_CONTEXT = 26
SEASON = 52
MA_WINDOW = 8
BOOTSTRAP = 2000
SEED = 7

SAVINGS_CATEGORIES = {"Investment", "Public Provident Fund", "Recurring Deposit"}

# FinAI's five categories, for the report's category breakdown.
CATEGORY_MAP = {
    "Food": "Food",
    "Transportation": "Transport",
    **{c: "Bills" for c in ["Household", "subscription", "Rent", "maid", "Cook", "Health", "Education",
                             "water (jar /tanker)", "garbage disposal", "Documents", "Family", "Money transfer"]},
    **{c: "Shopping" for c in ["Apparel", "Gift", "Beauty", "Grooming", "Self-development", "Other"]},
    **{c: "Entertainment" for c in ["Tourism", "Festivals", "Culture", "Social Life"]},
}


# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------

def load_spending(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    required = {"Date", "Category", "Amount", "Income/Expense", "Currency"}
    missing = required - set(df.columns)
    if missing:
        raise SystemExit(f"CSV is missing columns: {sorted(missing)}")
    if set(df["Currency"].unique()) != {"INR"}:
        raise SystemExit(f"Expected INR only, found {sorted(df['Currency'].unique())}")
    df["ts"] = pd.to_datetime(df["Date"], dayfirst=True, format="mixed")
    spend = df[(df["Income/Expense"] == "Expense") & (~df["Category"].isin(SAVINGS_CATEGORIES))].copy()
    unmapped = sorted(set(spend["Category"]) - set(CATEGORY_MAP))
    if unmapped:
        raise SystemExit(f"Categories with no FinAI mapping: {unmapped}")
    spend["finai_category"] = spend["Category"].map(CATEGORY_MAP)
    return spend


def weekly_series(spend: pd.DataFrame) -> pd.Series:
    # Monday-start weeks; reindex so empty weeks appear as zero.
    week_start = (spend["ts"].dt.normalize() - pd.to_timedelta(spend["ts"].dt.weekday, unit="D"))
    totals = spend.groupby(week_start)["Amount"].sum()
    full = pd.date_range(totals.index.min(), totals.index.max(), freq="W-MON")
    s = totals.reindex(full, fill_value=0.0)
    first, last = spend["ts"].min(), spend["ts"].max()
    # Drop a partial first week (data starts after Monday) and a partial last
    # week (data ends before Sunday).
    if first.normalize() > s.index[0]:
        s = s.iloc[1:]
    if last.normalize() < s.index[-1] + pd.Timedelta(days=6):
        s = s.iloc[:-1]
    return s


# --------------------------------------------------------------------------
# Forecasters (each sees only the training weeks)
# --------------------------------------------------------------------------

def f_naive(train: np.ndarray, h: int) -> np.ndarray:
    return np.repeat(train[-1], h)


def f_ma8(train: np.ndarray, h: int) -> np.ndarray:
    return np.repeat(train[-MA_WINDOW:].mean(), h)


def f_seasonal(train: np.ndarray, h: int) -> np.ndarray | None:
    if len(train) < SEASON:
        return None
    return np.array([train[len(train) - SEASON + i] for i in range(h)])


def f_ses(train: np.ndarray, h: int) -> np.ndarray:
    # Alpha chosen on the training weeks only, by one-step-ahead squared error.
    best_alpha, best_sse = 0.5, math.inf
    for alpha in np.linspace(0.05, 0.95, 19):
        level, sse = train[0], 0.0
        for y in train[1:]:
            sse += (y - level) ** 2
            level = alpha * y + (1 - alpha) * level
        if sse < best_sse:
            best_alpha, best_sse = alpha, sse
    level = train[0]
    for y in train[1:]:
        level = best_alpha * y + (1 - best_alpha) * level
    return np.repeat(level, h)


class ChronosClient:
    def __init__(self, url: str):
        self.url = url.rstrip("/")
        self.available = False
        self.reason = ""

    def check(self, wait_s: int) -> None:
        deadline = time.time() + wait_s
        while True:
            try:
                with urllib.request.urlopen(f"{self.url}/health", timeout=5) as r:
                    state = json.loads(r.read()).get("chronos_state")
            except (urllib.error.URLError, OSError) as e:
                self.reason = f"forecasting service not reachable at {self.url} ({e.__class__.__name__})"
                return
            if state == "ready":
                self.available = True
                return
            if state == "failed" or time.time() > deadline:
                self.reason = f"Chronos-2 not ready (state: {state})"
                return
            print(f"  waiting for Chronos-2 to load (state: {state}) ...", file=sys.stderr)
            time.sleep(5)

    def forecast(self, train: np.ndarray, h: int) -> np.ndarray | None:
        body = json.dumps({"history": [float(x) for x in train], "horizon": h}).encode()
        req = urllib.request.Request(f"{self.url}/forecast", data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            out = json.loads(r.read())
        if out.get("model") != "chronos-2":
            return None  # a fallback answer is not a Chronos-2 forecast
        return np.array(out["forecast"], dtype=float)


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------

def mase(actual: np.ndarray, pred: np.ndarray, train: np.ndarray) -> float:
    scale = np.mean(np.abs(np.diff(train)))
    return float(np.mean(np.abs(actual - pred)) / scale) if scale > 0 else math.nan


def evaluate(series: np.ndarray, chronos: ChronosClient) -> pd.DataFrame:
    rows = []
    origins = range(MIN_CONTEXT, len(series) - HORIZON + 1, STRIDE)
    for o in origins:
        train, actual = series[:o], series[o:o + HORIZON]
        preds = {"naive_last": f_naive(train, HORIZON), "moving_avg_8": f_ma8(train, HORIZON), "ses": f_ses(train, HORIZON)}
        sn = f_seasonal(train, HORIZON)
        if sn is not None:
            preds["seasonal_naive_52"] = sn
        if chronos.available:
            c = chronos.forecast(train, HORIZON)
            if c is not None:
                preds["chronos_2"] = c
        for model, p in preds.items():
            rows.append({"origin_week": o, "history_weeks": o, "model": model, "mase": mase(actual, p, train)})
    return pd.DataFrame(rows)


def paired_bootstrap(res: pd.DataFrame, a: str, b: str) -> tuple[float, float, float, int]:
    wide = res.pivot(index="origin_week", columns="model", values="mase")[[a, b]].dropna()
    d = (wide[a] - wide[b]).to_numpy()
    rng = np.random.default_rng(SEED)
    boots = [rng.choice(d, size=len(d), replace=True).mean() for _ in range(BOOTSTRAP)]
    lo, hi = np.percentile(boots, [2.5, 97.5])
    return float(d.mean()), float(lo), float(hi), len(d)


def report(name: str, s: pd.Series, res: pd.DataFrame, chronos: ChronosClient) -> list[str]:
    out = [f"### {name}", "",
           f"Weeks: {len(s)} ({s.index[0].date()} to {(s.index[-1] + pd.Timedelta(days=6)).date()}); "
           f"weeks with no spending: {int((s == 0).sum())}; mean ₹{s.mean():,.0f} a week, median ₹{s.median():,.0f}.", ""]
    summary = res.groupby("model")["mase"].agg(["mean", "count"]).sort_values("mean")
    out += ["| Model | Mean MASE | Origins |", "|---|---|---|"]
    out += [f"| {m} | {r['mean']:.3f} | {int(r['count'])} |" for m, r in summary.iterrows()]
    out.append("")
    baselines = [m for m in summary.index if m != "chronos_2"]
    if "chronos_2" in summary.index:
        # Compare each baseline with Chronos-2 only on the origins both have
        # (seasonal naive has none before 52 weeks of history), and take the
        # baseline that does best on that shared set.
        wide = res.pivot(index="origin_week", columns="model", values="mase")
        def shared_mean(m: str) -> float:
            both = wide[["chronos_2", m]].dropna()
            return both[m].mean() if len(both) else math.inf
        best = min(baselines, key=shared_mean)
        diff, lo, hi, n = paired_bootstrap(res, "chronos_2", best)
        verdict = ("Chronos-2 is better (interval below zero)" if hi < 0 else
                   "Chronos-2 is worse (interval above zero)" if lo > 0 else
                   "no significant difference (interval includes zero)")
        out.append(f"Chronos-2 minus best baseline ({best}) on the same {n} origins: "
                   f"{diff:+.3f} MASE, 95% CI [{lo:+.3f}, {hi:+.3f}]. **{verdict}.**")
    else:
        out.append(f"Chronos-2 not run: {chronos.reason or 'unavailable'}. Baselines only.")
    out.append("")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", type=Path)
    ap.add_argument("--service", default="http://127.0.0.1:8000")
    ap.add_argument("--wait", type=int, default=180, help="seconds to wait for Chronos-2 to finish loading")
    ap.add_argument("--out", type=Path, default=Path("case_study_results"))
    args = ap.parse_args()

    spend = load_spending(args.csv)
    chronos = ChronosClient(args.service)
    chronos.check(args.wait)
    print("Chronos-2:", "available" if chronos.available else f"NOT run ({chronos.reason})", file=sys.stderr)

    args.out.mkdir(parents=True, exist_ok=True)
    md = ["# Forecasting case study: Daily Transactions (Kaggle, prasad22)", "",
          "One individual's spending in INR, 2015-2018. The dataset page calls it dummy data. "
          "One person is a case study, not a general result.", "",
          f"Protocol: weekly totals, {HORIZON}-week horizon, origins every {STRIDE} weeks from {MIN_CONTEXT} weeks of "
          f"history, MASE (one-week naive scale), paired bootstrap over origins ({BOOTSTRAP} resamples, seed {SEED}). "
          "Savings products are excluded from spending.", ""]
    variants = {
        "All spending": spend,
        "Regular spending (excluding Money transfer)": spend[spend["Category"] != "Money transfer"],
    }
    for name, data in variants.items():
        s = weekly_series(data)
        res = evaluate(s.to_numpy(dtype=float), chronos)
        res.insert(0, "series", name)
        res.to_csv(args.out / f"{'all' if name.startswith('All') else 'regular'}_per_origin.csv", index=False)
        md += report(name, s, res, chronos)
    by_cat = spend.groupby("finai_category")["Amount"].sum().sort_values(ascending=False)
    md += ["### Spending by FinAI category (whole period)", "", "| Category | Total |", "|---|---|"]
    md += [f"| {c} | ₹{v:,.0f} |" for c, v in by_cat.items()]
    (args.out / "REPORT.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))


if __name__ == "__main__":
    main()
