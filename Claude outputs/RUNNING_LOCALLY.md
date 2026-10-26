# Running FinAI locally for a demo

Two processes: the Python forecasting service on port **8000**, and the
Node/Vite app on port **3000**. The app calls the service over HTTP; if the
service is not running the dashboard still works and labels its forecast as a
flat heuristic rather than failing.

Paths below assume the project is at
`C:\Users\anand\Downloads\remix-remix-untitled`.

---

## One-time setup

### 1. The forecasting service

```powershell
cd C:\Users\anand\Downloads\remix-remix-untitled\ml-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
```

The `--extra-index-url` matters: without it pip pulls the CUDA build of torch,
which is several GB and useless on a CPU-only run. The CPU build is roughly
250 MB.

If PowerShell blocks `Activate.ps1`, use `cmd` and
`.\.venv\Scripts\activate.bat` instead.

### 2. Cache the Chronos-2 weights

Do this once, on a connection you don't mind using, so the demo never
downloads live:

```powershell
python -c "from chronos import Chronos2Pipeline; Chronos2Pipeline.from_pretrained('amazon/chronos-2', device_map='cpu'); print('cached')"
```

About 500 MB. It goes to `%USERPROFILE%\.cache\huggingface\hub` and is reused
on every later run. This is the same call the service makes, so if it prints
`cached` the service will load from disk.

(`hf download amazon/chronos-2` does the same thing. The CLI is `hf`, not
`huggingface-cli`, in huggingface_hub 2.x.)

### 3. The app

```powershell
cd C:\Users\anand\Downloads\remix-remix-untitled
npm install
```

Then create `.env.local` in the project root:

```
GEMINI_API_KEY="your-key-here"
ML_SERVICE_URL="http://localhost:8000"
```

`GEMINI_API_KEY` is optional — without it the AI assistant, insights and
monthly report fall back to calculated summaries. `ML_SERVICE_URL` already
defaults to `http://localhost:8000`, so you only need it if you move the
service to another port.

---

## Starting the demo

**Terminal 1 — forecasting service:**

```powershell
cd C:\Users\anand\Downloads\remix-remix-untitled\ml-service
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

**Terminal 2 — the app:**

```powershell
cd C:\Users\anand\Downloads\remix-remix-untitled
npm run dev
```

Open <http://localhost:3000> and sign in as `demo_user` / `password123`.

Start the service first. The model loads on the first forecast request, on a
background thread, so an early dashboard load will read
**"Forecast: 8-week average (model loading)"** for a few seconds and then show
**"Forecast: Chronos-2"** on the next refresh. That is the label doing its job,
not a bug.

---

## Verify before you present

```powershell
cd C:\Users\anand\Downloads\remix-remix-untitled\ml-service
.\.venv\Scripts\Activate.ps1
python verify_local.py
```

This triggers the load, waits for it, then checks that 52 weeks of history
comes back as `chronos-2` and that 12 weeks still falls back to the moving
average. It prints the actual JSON and exits 0 only if Chronos-2 genuinely
produced the forecast.

A quick manual check of the same thing:

```powershell
curl.exe http://localhost:8000/health
```

```json
{"status":"ok","chronos_loaded":true,"chronos_state":"ready"}
```

`chronos_state` is `not_started` before the first request, `loading` during the
load, then `ready`, or `failed` if the weights could not be fetched.

---

## Resetting the demo data

The 60-week synthetic seed is generated only when `finai_store.json` does not
exist. To regenerate it:

```powershell
cd C:\Users\anand\Downloads\remix-remix-untitled
Rename-Item finai_store.json finai_store.json.old
npm run dev
```

That gives 60 weeks of simulated spending with an upward trend, yearly
seasonality and five spikes — enough history for Chronos-2, which needs 26
weeks before it will run. The dashboard labels this data as synthetic.

---

## If something is wrong

| Symptom | Cause and fix |
|---|---|
| "Forecast: flat 3% estimate (service unavailable)" | The service isn't running or isn't on port 8000. Check Terminal 1 and `curl.exe http://localhost:8000/health`. |
| "Forecast: 8-week average (model loading)" that never changes | Still downloading, or the download failed. Check `chronos_state`; if it is `failed`, read Terminal 1's log — usually no network or no cached weights. |
| "Forecast: 8-week average (insufficient history)" | Fewer than 26 weeks of data. Reset the demo data as above. |
| `chronos_state: "failed"` | Run the caching command from step 2 and watch for its error. The service keeps working on the moving-average path meanwhile. |
| Dashboard loads but the app can't reach the service | Use `localhost`, not `0.0.0.0`, in `ML_SERVICE_URL`. |
| Port 8000 already taken | Start uvicorn with `--port 8010` and set `ML_SERVICE_URL="http://localhost:8010"`. |

---

## Notes

- First-run download budget: about 250 MB for CPU torch plus 500 MB for the
  model weights. Both are cached afterwards.
- The `Dockerfile` in `ml-service/` targets port 7860 for a container deploy.
  It is unused for the local setup above and can stay as it is.
- The service never reports `"model": "chronos-2"` for a forecast the model did
  not produce. Whatever the dashboard label says is what actually ran.
