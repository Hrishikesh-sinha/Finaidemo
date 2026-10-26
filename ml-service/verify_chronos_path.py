"""Exercise the Chronos-2 branch with a stub pipeline.

The real model weights (~500MB from huggingface.co) are not reachable in every
environment. This script substitutes a stub whose predict_df returns a frame
shaped exactly like the real one, so the branch wiring, column handling and
response mapping can be checked without the download.

This verifies THIS SERVICE'S CODE, not Chronos-2. A stub-backed run says
nothing about forecast quality.

    python verify_chronos_path.py
"""

from __future__ import annotations

import sys

import pandas as pd

from app import main as svc


class StubPipeline:
    """Mimics Chronos2Pipeline.predict_df's output contract.

    Column layout and naming follow chronos-forecasting 2.3.2:
    predict_df builds its result from the future frame, then adds
    'target_name', 'predictions' (the mean), and one column per quantile
    level named str(level).
    """

    def __init__(self):
        self.calls = []

    def predict_df(
        self,
        df,
        prediction_length=None,
        quantile_levels=None,
        id_column="item_id",
        timestamp_column="timestamp",
        target="target",
        **kwargs,
    ):
        self.calls.append(
            {
                "rows": len(df),
                "prediction_length": prediction_length,
                "quantile_levels": list(quantile_levels or []),
                "columns": list(df.columns),
            }
        )

        last = pd.Timestamp(df[timestamp_column].iloc[-1])
        future = pd.date_range(start=last, periods=prediction_length + 1, freq="W-MON")[1:]
        base = float(df[target].iloc[-8:].mean())

        out = pd.DataFrame(
            {
                id_column: df[id_column].iloc[0],
                timestamp_column: future,
                "target_name": target,
            }
        )

        # Values are paired with their own timestamp: step 0 is the earliest
        # forecast week, so a correctly sorted response rises by 25 per step.
        for level in quantile_levels:
            offset = (level - 0.5) * 2200.0
            out[str(level)] = [base + offset + step * 25.0 for step in range(len(future))]

        # The real pipeline's 'predictions' column is the mean, not the median.
        # Offsetting it here proves the service reads the 0.5 quantile instead.
        out["predictions"] = out[str(0.5)] + 7.0

        # Hand the rows back newest-first, to prove the service sorts them.
        return out.iloc[::-1].reset_index(drop=True)

    def expected(self, history, horizon, level=0.5):
        base = float(pd.Series(history).iloc[-8:].mean())
        offset = (level - 0.5) * 2200.0
        return [round(base + offset + step * 25.0, 2) for step in range(horizon)]


def check(name, condition, detail=""):
    mark = "PASS" if condition else "FAIL"
    print(f"  [{mark}] {name}" + (f" -- {detail}" if detail else ""))
    return bool(condition)


def main() -> int:
    ok = True
    history = [8000.0 + i * 20.0 for i in range(52)]

    stub = StubPipeline()
    svc._pipeline = stub
    svc._load_state = svc.READY  # don't try the real download

    print("52 weeks of history, stub pipeline injected:")
    resp = svc.forecast(svc.ForecastRequest(history=history, horizon=4))

    ok &= check("model is chronos-2", resp.model == "chronos-2", resp.model)
    ok &= check("reason is null", resp.reason is None, repr(resp.reason))
    ok &= check("weeks_of_history is 52", resp.weeks_of_history == 52)
    ok &= check("forecast has 4 points", len(resp.forecast) == 4)
    ok &= check("lower has 4 points", len(resp.lower) == 4)
    ok &= check("upper has 4 points", len(resp.upper) == 4)
    ok &= check(
        "lower < forecast < upper at every step",
        all(l < f < u for l, f, u in zip(resp.lower, resp.forecast, resp.upper)),
        f"{resp.lower} / {resp.forecast} / {resp.upper}",
    )
    want_median = stub.expected(history, 4, 0.5)
    ok &= check(
        "forecast is the 0.5 quantile, not 'predictions' (mean)",
        resp.forecast == want_median,
        f"got {resp.forecast}, want {want_median} (mean would be +7.0)",
    )
    ok &= check(
        "lower is the 0.1 quantile",
        resp.lower == stub.expected(history, 4, 0.1),
        f"got {resp.lower}, want {stub.expected(history, 4, 0.1)}",
    )
    ok &= check(
        "upper is the 0.9 quantile",
        resp.upper == stub.expected(history, 4, 0.9),
        f"got {resp.upper}, want {stub.expected(history, 4, 0.9)}",
    )

    call = stub.calls[0]
    ok &= check("pipeline received 52 context rows", call["rows"] == 52, str(call["rows"]))
    ok &= check("prediction_length forwarded as 4", call["prediction_length"] == 4)
    ok &= check(
        "quantile_levels forwarded as [0.1, 0.5, 0.9]",
        call["quantile_levels"] == [0.1, 0.5, 0.9],
        str(call["quantile_levels"]),
    )
    ok &= check(
        "context frame is long format with item_id/timestamp/target",
        call["columns"] == ["item_id", "timestamp", "target"],
        str(call["columns"]),
    )
    # The stub returns rows newest-first, so this only passes if the service
    # re-sorts by timestamp before mapping the response.
    ok &= check(
        "newest-first rows are re-sorted chronologically",
        resp.forecast == sorted(resp.forecast),
        str(resp.forecast),
    )

    print("\nStub raising an exception falls back instead of 500ing:")

    class Boom:
        def predict_df(self, *a, **k):
            raise RuntimeError("simulated inference failure")

    svc._pipeline = Boom()
    svc._load_state = svc.READY
    resp = svc.forecast(svc.ForecastRequest(history=history, horizon=4))
    ok &= check("model is moving_average", resp.model == "moving_average", resp.model)
    ok &= check(
        "reason names the failure",
        resp.reason is not None and "failed during inference" in resp.reason,
        repr(resp.reason),
    )

    print("\nStub that omits a quantile column falls back too:")

    class BadColumns:
        def predict_df(self, df, prediction_length=None, **k):
            return pd.DataFrame({"timestamp": [1] * prediction_length, "predictions": [1.0] * prediction_length})

    svc._pipeline = BadColumns()
    svc._load_state = svc.READY
    resp = svc.forecast(svc.ForecastRequest(history=history, horizon=4))
    ok &= check("model is moving_average", resp.model == "moving_average", resp.model)
    ok &= check(
        "reason names the failure",
        resp.reason is not None and "failed during inference" in resp.reason,
        repr(resp.reason),
    )

    print("\n" + ("All stub checks passed." if ok else "SOME CHECKS FAILED."))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
