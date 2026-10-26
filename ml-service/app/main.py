"""FinAI forecasting microservice.

Serves weekly-spend forecasts to the Node API (`server.ts`) over HTTP.

Method selection is deliberate and is reported back in every response. A
rolling-origin backtest (40 synthetic users, 130 weeks, 19 origins, 4-week
horizon) compared Chronos-2 against naive-last, an 8-week moving average,
seasonal-naive, linear trend, simple exponential smoothing (SES) and AutoETS,
scored by MASE with 95% CIs bootstrapped over users
(experiments: finai_exp2_forecasting.ipynb):

    history     chronos-2   best baseline        difference
    12 weeks      0.855     8-week MA  0.882     -0.026 [-0.055, +0.002]  tie
    26 weeks      0.841     8-week MA  0.882     -0.041 [-0.063, -0.019]  chronos-2
    52 weeks      0.783     SES        0.871     -0.088 [-0.117, -0.060]  chronos-2
    all (52-126)  0.742     SES        0.863     -0.121 [-0.151, -0.092]  chronos-2

At 12 weeks the CI crosses zero, so Chronos-2 is not distinguishable from a
moving average. This service therefore refuses to use Chronos-2 below
MIN_WEEKS_FOR_CHRONOS weeks of history and says so in `reason`. It never
reports `model: "chronos-2"` unless the model actually produced the numbers.
"""

from __future__ import annotations

import logging
import math
import statistics
import threading
from typing import List, Optional, Union

import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, field_validator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("finai.ml")

MODEL_ID = "amazon/chronos-2"

# Below this much history, the backtest shows no significant gain over the
# moving-average baseline, so we do not use the foundation model.
MIN_WEEKS_FOR_CHRONOS = 26

# Baseline window: the 8-week moving average was the strongest baseline.
MA_WINDOW = 8

# Normal quantile for an ~80% central interval, to match the 0.1/0.9 band
# Chronos-2 returns. These are dispersion estimates, not model quantiles.
Z_80 = 1.2816

QUANTILE_LEVELS = [0.1, 0.5, 0.9]
LOWER_Q, MEDIAN_Q, UPPER_Q = "0.1", "0.5", "0.9"

BAND_NOTE = (
    "bands are the mean +/-1.28 standard deviations of the supplied history "
    "(~80% interval), not model quantiles"
)

# Weekly spend cannot be negative, so the lower band is floored at zero.
FLOOR = 0.0

app = FastAPI(
    title="FinAI forecasting service",
    description="Weekly spend forecasting. Reports which method produced each forecast.",
    version="1.0.0",
)

# Model loading states.
NOT_STARTED, LOADING, READY, FAILED = "not_started", "loading", "ready", "failed"

# The model is loaded on the first request that needs it, never at import, so
# the service starts even if the weights cannot be fetched. The load runs on a
# background thread rather than inside the request: the first load downloads
# ~500MB, which is far longer than any sane client timeout, and a caller that
# times out would mislabel a service that is up and working. Until the load
# finishes, requests are answered on the moving-average path and say so.
_pipeline = None
_load_state = NOT_STARTED
_load_lock = threading.Lock()


def _load_pipeline() -> None:
    """Load the model off the request path. Runs once, on a worker thread."""
    global _pipeline, _load_state

    try:
        from chronos import Chronos2Pipeline

        logger.info("Loading %s on cpu (~500MB on first run)", MODEL_ID)
        pipeline = Chronos2Pipeline.from_pretrained(MODEL_ID, device_map="cpu")
    except Exception:
        logger.exception("Could not load %s; falling back to moving average", MODEL_ID)
        with _load_lock:
            _load_state = FAILED
        return

    with _load_lock:
        _pipeline = pipeline
        _load_state = READY
    logger.info("Loaded %s", MODEL_ID)


def ensure_pipeline():
    """Return (pipeline_or_None, state). Starts the load once; never blocks."""
    global _load_state

    with _load_lock:
        if _load_state == NOT_STARTED:
            _load_state = LOADING
            threading.Thread(target=_load_pipeline, name="chronos-load", daemon=True).start()
        return _pipeline, _load_state


class ForecastRequest(BaseModel):
    """Weekly total spend, oldest first."""

    model_config = ConfigDict(protected_namespaces=())

    # Strict types: a JSON string or boolean is rejected rather than coerced.
    history: List[Union[StrictFloat, StrictInt]] = Field(..., min_length=1)
    horizon: StrictInt = Field(4, ge=1, le=12)

    @field_validator("history")
    @classmethod
    def _finite(cls, v):
        if not v:
            raise ValueError("history must not be empty")
        for x in v:
            if not math.isfinite(float(x)):
                raise ValueError("history must contain only finite numbers")
        return v


class ForecastResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    forecast: List[float]
    lower: List[float]
    upper: List[float]
    model: str
    weeks_of_history: int
    reason: Optional[str] = None


def _round(x: float) -> float:
    return round(float(x), 2)


def _moving_average(history: List[float], horizon: int, reason: str) -> ForecastResponse:
    """8-week moving-average baseline with a dispersion-derived band."""
    window = history[-MA_WINDOW:]
    point = sum(window) / len(window)

    sd = statistics.pstdev(history) if len(history) > 1 else 0.0
    delta = Z_80 * sd

    return ForecastResponse(
        forecast=[_round(point)] * horizon,
        lower=[_round(max(FLOOR, point - delta))] * horizon,
        upper=[_round(point + delta)] * horizon,
        model="moving_average",
        weeks_of_history=len(history),
        reason=reason,
    )


def _chronos(pipeline, history: List[float], horizon: int) -> ForecastResponse:
    """Chronos-2 forecast via predict_df.

    predict_df needs timestamps, but this API takes a bare list, so a weekly
    index is synthesised here. The dates are an implementation detail and are
    not returned.
    """
    timestamps = pd.date_range(start="2020-01-06", periods=len(history), freq="W-MON")
    context_df = pd.DataFrame(
        {
            "item_id": "user",
            "timestamp": timestamps,
            "target": [float(x) for x in history],
        }
    )

    pred_df = pipeline.predict_df(
        context_df,
        prediction_length=horizon,
        quantile_levels=QUANTILE_LEVELS,
        id_column="item_id",
        timestamp_column="timestamp",
        target="target",
    )

    missing = [c for c in (LOWER_Q, MEDIAN_Q, UPPER_Q) if c not in pred_df.columns]
    if missing:
        raise RuntimeError(f"predict_df returned no {missing} column(s)")

    pred_df = pred_df.sort_values("timestamp").head(horizon)
    if len(pred_df) != horizon:
        raise RuntimeError(f"predict_df returned {len(pred_df)} rows, expected {horizon}")

    # The median quantile is used as the point forecast so that it is
    # consistent with the 0.1/0.9 band. The 'predictions' column is the mean,
    # which is not the same series.
    return ForecastResponse(
        forecast=[_round(v) for v in pred_df[MEDIAN_Q]],
        lower=[_round(max(FLOOR, float(v))) for v in pred_df[LOWER_Q]],
        upper=[_round(v) for v in pred_df[UPPER_Q]],
        model="chronos-2",
        weeks_of_history=len(history),
        reason=None,
    )


@app.get("/health")
def health():
    """Liveness probe. Does not trigger a model load, so it stays fast."""
    with _load_lock:
        state = _load_state
    return {"status": "ok", "chronos_loaded": state == READY, "chronos_state": state}


@app.post("/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest) -> ForecastResponse:
    history = [float(x) for x in req.history]
    horizon = int(req.horizon)
    weeks = len(history)

    if weeks < MIN_WEEKS_FOR_CHRONOS:
        return _moving_average(
            history,
            horizon,
            f"only {weeks} weeks of history; foundation model requires "
            f"{MIN_WEEKS_FOR_CHRONOS}+; {BAND_NOTE}",
        )

    pipeline, state = ensure_pipeline()
    if pipeline is None:
        detail = (
            "forecasting model is still loading"
            if state == LOADING
            else "forecasting model unavailable"
        )
        return _moving_average(history, horizon, f"{detail}; {BAND_NOTE}")

    try:
        return _chronos(pipeline, history, horizon)
    except Exception as exc:
        logger.exception("Chronos-2 inference failed")
        return _moving_average(
            history,
            horizon,
            f"forecasting model failed during inference "
            f"({type(exc).__name__}); {BAND_NOTE}",
        )
