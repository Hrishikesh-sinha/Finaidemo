# FinAI forecasting service

A small Python service that forecasts weekly spend for FinAI. It exists
separately because `server.ts` is Node and Chronos-2 is Python/PyTorch; the
Node API calls this over HTTP.

## Why it picks between two methods

A rolling-origin backtest (40 synthetic users, 130 weeks, 19 forecast origins,
4-week horizon) compared Chronos-2 against naive-last, an 8-week moving
average, seasonal-naive and linear trend. Error is MASE, lower is better, with
95% CIs bootstrapped over users:

| History available | Chronos-2 | Best baseline (8wk moving avg) | Difference |
|---|---|---|---|
| 12 weeks | 0.855 | 0.882 | −0.026 [−0.055, **+0.002**] — tie, CI crosses zero |
| 26 weeks | 0.841 | 0.882 | −0.041 [−0.063, −0.019] — Chronos-2 wins |
| 52 weeks | 0.783 | 0.882 | −0.099 [−0.134, −0.064] — Chronos-2 wins clearly |

Below 26 weeks of history Chronos-2 is not distinguishable from a moving
average, so the service uses the moving average there and says why in the
`reason` field. **The response always names the method that actually produced
the numbers.** It never reports `"model": "chronos-2"` for a forecast the model
did not generate.

## Endpoints

### `GET /health`

```json
{ "status": "ok", "chronos_loaded": false, "chronos_state": "not_started" }
```

`chronos_loaded` reports whether the model is usable *right now*.
`chronos_state` is one of `not_started`, `loading`, `ready` or `failed`, which
is what you want when diagnosing a Space that is still warming up.

Loading is lazy and happens **off the request path**. The first `/forecast`
request that needs the model starts a background thread and is itself answered
on the moving-average path with `reason: "forecasting model is still
loading; ..."`; subsequent requests switch to `chronos-2` once the thread
finishes. This matters because the first load downloads ~500MB, which is longer
than any sensible client timeout — the Node API gives up after 5 seconds. If
the load ran inside the request, every caller during the download would time
out and label a healthy service as unavailable.

### `POST /forecast`

Request. `history` is weekly total spend, oldest first; `horizon` defaults to 4
and must be 1–12:

```json
{ "history": [8120.5, 7430.0, 9015.25], "horizon": 4 }
```

Response:

```json
{
  "forecast": [8200.1, 8250.4, 8190.7, 8300.2],
  "lower":    [7100.0, 7050.0, 7020.0, 7000.0],
  "upper":    [9400.0, 9500.0, 9480.0, 9600.0],
  "model": "chronos-2",
  "weeks_of_history": 52,
  "reason": null
}
```

`model` is either `chronos-2` or `moving_average`. When it is
`moving_average`, `reason` is a plain-English explanation, one of:

- `only N weeks of history; foundation model requires 26+; ...`
- `forecasting model is still loading; ...`
- `forecasting model unavailable; ...`
- `forecasting model failed during inference (ExceptionName); ...`

On the moving-average path, `lower` and `upper` are the mean ±1.28 standard
deviations of the supplied history — roughly an 80% interval, matching the
0.1/0.9 band Chronos-2 returns. They are a dispersion estimate, **not** model
quantiles, and the `reason` string says so. On the Chronos-2 path, `forecast`
is the 0.5 quantile and the band is the 0.1 and 0.9 quantiles. The lower bound
is floored at zero on both paths, since weekly spend cannot be negative.

Invalid input returns HTTP 422: empty history, a non-numeric or non-finite
value, or a horizon outside 1–12.

## Run locally

```bash
cd ml-service
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
uvicorn app.main:app --reload --port 8000
```

The first `/forecast` call with 26+ weeks of history starts the download of
`amazon/chronos-2` (~500MB, Apache-2.0, CPU is fine) on a background thread.
Until it finishes, calls are answered on the moving-average path with
`reason: "forecasting model is still loading; ..."`. Poll `/health` and wait
for `chronos_state: "ready"` before expecting `"model": "chronos-2"`.

Smoke test:

```bash
curl -s localhost:8000/health

# 52 weeks -> chronos-2
curl -s -X POST localhost:8000/forecast -H 'Content-Type: application/json' \
  -d "{\"history\": $(python3 -c 'import json;print(json.dumps([8000+i*20 for i in range(52)]))'), \"horizon\": 4}"

# 12 weeks -> moving_average, with a reason
curl -s -X POST localhost:8000/forecast -H 'Content-Type: application/json' \
  -d "{\"history\": $(python3 -c 'import json;print(json.dumps([8000+i*20 for i in range(12)]))'), \"horizon\": 4}"
```

`verify_local.py` checks a running service end to end: it triggers the load,
waits for `chronos_state: "ready"`, then asserts that 52 weeks of history comes
back as `chronos-2` while 12 weeks still falls back to the moving average. It
exits non-zero if Chronos-2 did not produce the forecast, so it is the check to
run before a demo.

`verify_chronos_path.py` is different: it exercises the Chronos-2 branch with a
stub pipeline, for environments that cannot reach the model weights. It proves
the branch wiring and column handling, **not** the model itself.

## Where this runs

This service runs locally, alongside the app. See
[`../RUNNING_LOCALLY.md`](../RUNNING_LOCALLY.md) in the project root for the
full setup and the commands that start both processes for a demo, including
caching the model weights beforehand so nothing downloads mid-demo.

The `Dockerfile` is kept for a container deploy and listens on port 7860, the
port Hugging Face Spaces expects. It is not used by the local setup. Wherever
the service runs, the Node API reaches it through `ML_SERVICE_URL`.
