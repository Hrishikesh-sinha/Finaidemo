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
GEMINI_API_KEY="your-new-key-here"
ML_SERVICE_URL="http://localhost:8000"
AUTH_SECRET="paste-the-generated-value-here"
```

Generate `AUTH_SECRET` once (it signs login sessions; 32+ characters):

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Without it the server still runs, using a random key per run, so everyone is
signed out whenever it restarts. With a value shorter than 32 characters the
server refuses to start.

`GEMINI_API_KEY` is optional — without it the AI assistant, insights and
monthly report fall back to calculated summaries. `ML_SERVICE_URL` already
defaults to `http://localhost:8000`, so you only need it if you move the
service to another port. `.env.local` is git-ignored; never commit it.

### 4. First start after the security update (one time)

The first `npm run dev` after this update replaces the plaintext password in
`finai_store.json` with a scrypt hash. The account and every transaction are
kept, and you sign in with the **same password as before**. The console
prints one line naming a backup file, `finai_store.pre-auth-migration-….json`,
which holds the migrated records (no plaintext). Delete it once you have
confirmed you can sign in.

`finai_store.json.bak` (an old AI Studio leftover, not used by the app) still
contains the old plaintext password. Delete it.

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

Open <http://localhost:3000> and sign in as `demo_user` with its password.
The login form is no longer pre-filled: credentials are not shipped in the
frontend any more.

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

## The database (since 25 Oct)

All data now lives in **`finai_data.sqlite`**: a SQLite database in the
project folder, using Node's built-in SQLite. No database server and no extra
package are needed. Node 22.5 or newer is required (you have 22.14).

**First start after this update.** `npm run dev` finds `finai_store.json`,
imports it into the database, hashes any plaintext password, and prints one
line like:

```
[FinAI] Imported 1 user(s), 400 transactions … into finai_data.sqlite …
The JSON file is kept as finai_store.json.imported-….
```

You sign in with the same password as before. The backup holds the migrated
records (no plaintext password). The old `finai_store.json` is removed so it
is never imported twice.

**Never delete `finai_data.sqlite` by accident:** it is your data. The
`-wal` and `-shm` files next to it are part of it while the server runs.

## Importing the Kaggle sample dataset as a second account

With the CSV at `data\kaggle\Daily_Household_Transactions.csv`, run this.
The server can stay running.

```powershell
npm run import:kaggle -- data\kaggle\Daily_Household_Transactions.csv
```

- **Password:** it asks for one for the new account `kaggle_demo`, at a hidden prompt.
- **What it imports:**
  - 2,043 spending transactions;
  - savings rows (investments, PPF, RD, transfers to FDs, funds and shares) are excluded, because they are savings, not spending;
  - monthly income is set to the latest salary, ₹70,255.
- **Dates:** shifted forward by whole weeks so the data ends this week. Add `--no-shift` to keep the original 2015–2018 dates. The dashboard states the dataset, its original dates and the shift.
- **Re-importing:** add `--replace`.

: the data must be current

The synthetic demo data ends on the day it was created (14 Oct). The
"last 30 days" figures run to **today**, so every day since then counts as
"nothing spent". The dashboard now says so in an amber notice and labels the
forecast as "the 30 days after 14 Oct", but the 30-day spend and savings rate
are still understated. Two honest ways to fix it for the demo:

1. **Log the missing days** (real transactions, if this is your own data), or
2. **Regenerate the synthetic demo data** on the morning of the review, so it
   ends that day. This replaces the demo transactions; only do it if nothing
   in the store needs keeping.

## Resetting the demo data

The 60-week synthetic seed is generated only when the database is empty. To
start completely fresh (this **deletes every account and transaction**), stop
the server, then:

```powershell
cd C:\Users\anand\Downloads\remix-remix-untitled
Rename-Item finai_data.sqlite finai_data.sqlite.old
Remove-Item finai_data.sqlite-wal, finai_data.sqlite-shm -ErrorAction SilentlyContinue
$env:DEMO_PASSWORD = "choose-a-password"   # 8+ characters, hashed on creation
npm run dev
Remove-Item Env:DEMO_PASSWORD
```

Then run the Kaggle import again if you want that account too.

## Accounts and admin access

Both commands work on the database directly and are **safe to run while the
server is up**: the server reads the database on every request.

| Task | Command |
|---|---|
| Set or reset a password (hidden prompt) | `npm run user:set-password -- <username>` |
| Give an account the admin view | `npm run admin:grant -- <username>` |
| Take it away | `npm run admin:grant -- <username> --revoke` |

There is no admin password in the code. To use the admin view: register an
account in the app, run `admin:grant` for it, then use "Admin" on the login screen with that account. Lost
passwords are reset with `user:set-password`, which needs access to the
machine that holds the store, the same trust level as editing the file.

## Notes

- First-run download budget: about 250 MB for CPU torch plus 500 MB for the
  model weights. Both are cached afterwards.
- The `Dockerfile` in `ml-service/` targets port 7860 for a container deploy.
  It is unused for the local setup above and can stay as it is.
- The service never reports `"model": "chronos-2"` for a forecast the model did
  not produce. Whatever the dashboard label says is what actually ran.
