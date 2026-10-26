# `backend/` — superseded prototype, not run by the application

**Nothing in this folder runs.** It is an earlier FastAPI/SQLAlchemy prototype
of FinAI, kept for reference only.

**The live API is `server.ts`** at the repository root — Node/Express, started
by `npm run dev` (which runs `tsx server.ts`). The React frontend calls
relative `/api/*` paths, and `server.ts` serves all of them. No script in
`package.json` or `setup.sh` starts this FastAPI app, and nothing imports it.

Be careful when reading this folder: it defines some of the same routes as the
live API — including `POST /api/transactions/ocr` — with different behaviour.
`server.ts` is what the application actually does. Persistence also differs:
`server.ts` uses the JSON store `finai_store.json`, so `finai.db` and
`jobs.sqlite` at the repository root are leftovers from this prototype.

## What is in here, and why none of it is adopted

| Component | In this folder | Status |
|---|---|---|
| Categorization | `ml_engine.py` — TF-IDF + RandomForest, trained on 20 hardcoded rows in `TRAIN_DATA` | **Not adopted.** The live app uses rule-based keyword matching (`predictCategory` in `server.ts`). A TF-IDF baseline *was* the comparison point in the categorization benchmark — ModernBERT 0.401 vs TF-IDF 0.437 accuracy on unseen merchants, difference CI [−14.9, +7.0] pts — which is why no learned categorizer was adopted. This specific pipeline was not itself benchmarked. |
| Anomaly detection | `ml_engine.py` — `IsolationForest(contamination=0.05)` per category at ≥15 transactions, 3σ rule below that | **Not adopted, and never benchmarked.** The live app flags per-category outliers at 2.5σ in `server.ts`. The anomaly benchmark compared that z-score rule against Chronos-2 prediction bands, not against Isolation Forest: at an equal 0.4% false-alarm rate the z-score caught 85% of spikes and Chronos-2 caught 47%, so the z-score was kept. |
| Forecasting | `ml_engine.py` — Prophet over daily totals, 30-day horizon | **Not adopted, and never benchmarked.** The forecasting benchmark compared Chronos-2 against naive-last, an 8-week moving average, seasonal-naive and linear trend. Prophet was not in that comparison. Forecasting now lives in `ml-service/` (Chronos-2 above 26 weeks of history, 8-week moving average below it). |
| Budget recommendation | `ml_engine.py` — `GradientBoostingRegressor` in `recommend_budget` | **Dead code even within this prototype.** It is fitted on `np.random.rand` dummy data and its output is discarded; the function returns a 50/30/20 heuristic. |
| Receipt OCR | `main.py` — OpenCV preprocessing into `pytesseract.image_to_string` | **Not adopted.** This is real OCR, but it is not reachable. The live `/api/transactions/ocr` in `server.ts` estimates the merchant and amount from the uploaded *filename* and does not run OCR at all; it labels its own output accordingly. `tesseract.js` appears in `package.json` but is never imported. |

To be explicit, because the distinction matters when discussing this project:
the only comparisons actually run were Chronos-2 against the four forecasting
baselines, Chronos-2 bands against the 2.5σ z-score, and ModernBERT against
TF-IDF. Of the three, only the Chronos-2 forecasting result led to a change.
The Isolation Forest, Prophet and gradient-boosting code here predates all of
it and carries no measured result.

## Do not deploy this as-is

Beyond being unwired, `main.py` hardcodes `SECRET_KEY =
"super-secret-key-for-viva-only"` for JWT signing. If any of this is ever
revived, that has to come from the environment first.
