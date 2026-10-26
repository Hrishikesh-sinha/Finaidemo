# FinAI 2.0 — Review-3 audit report

Covers Phase 1 (audit) and Phase 2 (critical security fixes and data
consistency). Last updated 23 Oct 2026.

Everything marked **verified** was run, and the result is stated. Anything not
run is listed under "Not verified" and must not be described as working.

---

## Phase 1 — findings (summary)

| # | Finding | How confirmed | Phase-2 status |
|---|---|---|---|
| 1 | Session tokens were unsigned base64 JSON; anyone could make one for any user | Forged a token without a password; `/api/profile` returned 200 | Fixed |
| 2 | Passwords stored in plain text in `finai_store.json` | Read the store | Fixed (migration) |
| 3 | `/api/ai/insights` and `/api/ai/monthly-report` needed no login and trusted client-sent figures | Sent fake figures unauthenticated; got a "-99999800% savings rate" report | Fixed |
| 4 | Only the simulator's Gemini text was grounding-checked | Code review | Fixed (insights, report, chat now checked) |
| 5 | Invalid date → HTTP 500; `1e15` in category "Hacking" saved; voice with no number saved ₹50 | Live requests | Fixed |
| 6 | "Last 30 days" counts to today but the demo data ends 14 Oct: ₹40,875 (14 Oct) → ₹18,065 (23 Oct) → ₹15,517 (28 Oct), savings rate up to 69% | Computed from the store | Labelled and tested (see Task 4) |
| 7 | Forecast card showed MASE 0.742 for every user | Code review | Fixed |
| 8 | No transaction edit or delete | Code review | Added |
| 9 | Admin password hardcoded in the frontend; admin view shows sample users | Code review | Password removed; admin is a server-side role |
| 10 | Insights endpoint computed its own health score and a fixed 50/30/20 budget | Code review | Fixed (one shared summary) |

---

## Phase 2 — changes

### Task 1 — Authentication and passwords

- **Tokens** (`src/server/auth.ts`): `v1.<payload>.<HMAC-SHA256>`, signed with
  `AUTH_SECRET` from the server environment. Each protected request checks:
  format, signature (timing-safe), JSON, `sub`, `iat`, `exp`, not expired,
  not issued in the future (60 s skew), and lifetime ≤ 7 days. The old unsigned
  tokens have no dots and are rejected. The token subject is now the user id,
  not the username.
- **AUTH_SECRET**: if set, it must be ≥ 32 characters or the server refuses
  to start. If unset, a random per-process key is used (sessions end on
  restart). Nothing is hardcoded.
- **Passwords**: scrypt (N = 2¹⁵, r = 8, p = 1, 64-byte key) with a fresh
  16-byte salt per password, compared with `timingSafeEqual`. Hashes claiming
  absurd costs are refused. Logins for unknown usernames still run a dummy
  hash, so timing does not reveal which usernames exist; the error message is
  identical either way.
- **Login rate limit**: 10 attempts per 15 minutes per client address and
  username.
- **Registration**: username 3–32 characters `[A-Za-z0-9_.-]`, password 8–128
  characters, income 0–₹1 crore.
- **Migration** (`src/server/store.ts`): on startup, any user with a plaintext
  `password` gets a `password_hash` and the plaintext field is removed. Order:
  hash in memory → write a backup of the migrated records → atomically replace
  the store (temp file + rename). Neither file contains plaintext. It runs
  once; an already-migrated store is left alone. Every store write is now
  atomic.
- **Admin**: the hardcoded admin password, the "Autofill credentials" button
  and the on-screen credentials box are removed. So are the pre-filled demo
  password, "Continue with demo_user" and "Reset demo credentials". The admin
  view now opens only if the server reports `is_admin` for a signed-in
  account. That role is granted with `npm run admin:grant -- <username>`.
- **Regaining access legitimately**: `npm run user:set-password -- <username>`
  (hidden prompt, server stopped). It requires access to the machine holding
  the store, which is the same trust level as editing the store. There is no
  default password and no bypass.
- **New store**: the demo account is created with no password, unless
  `DEMO_PASSWORD` is set at creation time, in which case it is hashed.

### Task 2 — AI endpoints

- `/api/ai/insights`, `/api/ai/monthly-report`, `/api/chat` and
  `/api/simulator/explain` require a valid token.
- All figures come from `summarize()` over the caller's own transactions. A
  request body that carries a `context` (or any other unexpected field) gets
  400 and is not used.
- Insights, report and chat replies go through the same `checkGrounding` as
  the simulator. Gemini gets a facts block, and any number not in it (or, for
  chat, not in the user's own question) rejects the reply. A deterministic
  template built from the same facts is used instead.
  - The templates are tested to pass their own grounding check in four
    scenarios: complete, stale, overspending, and target met.
- Limits:
  - Request bodies are capped at 32 kB.
  - Chat prompts are capped at 500 characters.
  - Each user gets 20 AI requests per 10 minutes, shared across the four
    endpoints; the excess gets 429 with `Retry-After`.
- Errors return a status and a generic message, never a stack trace. Gemini
  errors are logged by message only; tests confirm a key-like string in an
  error does not reach the response.
- Insights and the report no longer have their own health-score or budget
  formulas; they use the dashboard's.

### Task 3 — Input validation (`src/server/validation.ts`)

New limits (none existed before):

| Field | Rule |
|---|---|
| amount | number or numeric string; ₹0.01 – ₹1,00,00,000; ≤ 2 decimals. A sanity bound against typos, not a business rule. |
| merchant | required; 1–100 characters after trimming; control characters removed |
| date | `YYYY-MM-DD` (real calendar date) or full ISO timestamp; ≥ 2000-01-01; ≤ now + 36 h (date-only input is stored at 00:00 UTC, up to 5.5 h ahead of the same date in IST) |
| category | one of Bills, Food, Transport, Shopping, Entertainment (case-insensitive); omitted means the rule-based categorizer picks one |
| voice text | ≤ 300 characters; **must contain an amount**, otherwise 400 with an example phrase. No ₹50 default. |

All failures are 400 with a readable `detail`. The add-transaction modal now
shows that message instead of a generic error.

Known limitation: voice takes the first number spoken. "2 coffees for 300"
records ₹2.

### Task 4 — Dashboard reporting consistency (`src/server/reporting.ts`)

- **One definition**, shared by the dashboard, insights, report and chat.
  - **Window:** the rolling 30 days ending now.
  - **Spent:** transactions dated inside the window.
  - **Savings rate:** (monthly income − spent) / monthly income, treating the
    30-day window as one month.
  - **Health score and smart budget:** the existing formulas, unchanged.
- **Coverage is reported:** the dashboard response now includes
  `reporting.data_through`, `days_since_last_entry`,
  `unlogged_days_in_window` and `complete` (false after more than 7 days with
  nothing logged).
- **UI when the log is stale:**
  - an amber notice (nothing logged since X; spending likely understated,
    savings rate overstated);
  - the summary header reads "Last 30 days · N of 30 days logged";
  - the AI report opens with the same caveat.
- **Forecast period** is labelled separately. It covers the 4 weeks after the
  latest transaction, so when the log is stale the UI says "the 30 days after
  14 Oct, your latest transaction" instead of "the next 30 days".
- **Fallback forecast:** when the forecast service is down, the flat
  projection is now based on the 30 days up to the latest transaction, the
  period its label describes. It was previously based on the understated
  window.
- **Weekly series:** weeks are now counted back from the latest transaction,
  so the newest week fed to Chronos-2 is always seven full days. Counting
  forward from the first transaction could end on a partial week that looks
  like a sudden drop. The 60-week demo series is identical under both methods
  (tested).
- **Unchanged:** transaction dates were not altered, and the simulator's
  measurement logic was not changed (tested).
- **Reproduction test:** the Phase-1 discrepancy is reproduced exactly:
  ₹40,875 / ₹18,065 / ₹15,517 on 14 / 23 / 28 Oct. The test regenerates the
  deterministic seed, which was checked to match the stored 400 transactions
  exactly.
- **Not fixed by code:** on review day the 30-day figures will still be
  understated unless the data is brought up to date. That is now labelled
  rather than hidden. See "Manual steps".

### Task 5 — Forecast metric (`src/forecast/benchmark.ts`)

The three MASE values are different rows of the same backtest, as documented
in `ml-service/app/main.py`:

| History | Chronos-2 | Baseline | Shown for |
|---|---|---|---|
| < 26 weeks | — | — | nothing (Chronos-2 not used) |
| exactly 26 weeks | 0.841 | 8-week MA 0.882 | 26–51 weeks, labelled "nearest lower" unless exactly 26 |
| 52–126 weeks, pooled | 0.742 | SES 0.863 | 52–126 weeks; beyond 126 labelled "beyond range" |
| exactly 52 weeks | 0.783 | **unresolved** | not shown |

- The "% lower" figure is computed from these numbers (14% and 5%), not typed
  in.
- The card now says "Benchmark error" and "Benchmark, not your accuracy",
  names the history length the figure was measured at, and explains how the
  user's own history relates to it.
- **Unresolved:**
  - For the 52-week row, `ml-service/README.md` says the baseline is the
    8-week MA at 0.882 (diff −0.099), while `ml-service/app/main.py` says SES
    at 0.871 (diff −0.088). `finai_exp2_forecasting.ipynb` was not available,
    so this is recorded in code as unresolved and not displayed.
  - None of the benchmark figures above have been re-verified against the
    notebook. They are reproduced from the project's own documentation.

### Task 6 — Edit and delete

- `PUT /api/transactions/:id` accepts any subset of amount, merchant,
  category and date, validated by the same rules as creation. Unknown fields
  such as `user_id` are refused.
- `DELETE /api/transactions/:id` removes one transaction.
- Both answer 404 for "not yours" and "does not exist" alike, so ids cannot be
  probed.
- UI: an Edit button on each row opens a dialog. Save sends only the changed
  fields. Delete asks for confirmation first. Escape cancels, and errors are
  shown inline.

### Task 7 — Tests

All new tests use generated data or temp-dir stores; none touch
`finai_store.json`.

| File | Tests | Covers |
|---|---|---|
| `src/simulator/engine.test.ts` | 16 | existing, unchanged (brute force, KKT) |
| `src/simulator/grounding.test.ts` | 8 | existing, unchanged |
| `src/server/auth.test.ts` | 7 | hashing, salts, forged/legacy/tampered/wrong-key/expired/future tokens, AUTH_SECRET rules |
| `src/server/store.test.ts` | 3 | migration keeps data, no plaintext in store or backup, runs once |
| `src/server/validation.test.ts` | 8 | amounts, calendar dates, categories, voice without amount, updates, registration |
| `src/server/reporting.test.ts` | 9 | 14/23/28 Oct reproduction, coverage flags, threshold boundary, formulas, simulator unaffected, weekly series |
| `src/server/aiFacts.test.ts` | 6 | templates pass grounding in 4 scenarios; invented figure rejected |
| `src/server/app.test.ts` | 22 | real Express app: login, every token attack on 3 endpoints, rate limits, AI auth and context refusal, cross-user isolation, Gemini grounded/rejected/failing, edit/delete with persistence and authorization, 400s for Phase-1 inputs, 413/400 bodies, dashboard periods, ML down |
| `src/forecast/benchmark.test.ts` | 5 | cohort selection, 0.742 only for 52+, unresolved row not shown |

**Mutation check:** I deliberately removed the ownership check on edit, and
then disabled grounding. Each change made the suite fail (1 failure each).
Both were reverted.

---

## Verification (actually run)

| Check | Result |
|---|---|
| `npm test` | **84 / 84 pass** (24 existing + 60 new) |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds (frontend + `dist/server.cjs`) |
| Frontend bundle scan for `finai@admin123`, the demo password, `AUTH_SECRET`, `AIza` | none found |
| Built server on a **copy** of the real `finai_store.json` | 1 password migrated; no plaintext in store or backup; existing demo login works and returns a `v1.` token; Phase-1 forged token → 401; unauthenticated report → 401; report with client context → 400; invalid date → 400; voice without amount → 400; dashboard on 23 Oct → ₹18,065, `complete: false`, 9 unlogged days; fallback forecast ₹42,101 from the 30 days up to 14 Oct; frontend served; server log contains no tokens or passwords |
| Original `finai_store.json` | unchanged (hash checked before and after) |

## Not verified

- **The UI in a real browser.** Nothing in the new dialog, notices or admin
  flow has been clicked. TypeScript and the build pass, which is not the same
  thing. Run through it on Windows with `npm run dev`.
- **Chronos-2 itself.** The model weights could not be downloaded in this
  environment. ML responses were stubbed in tests, and the live check ran
  with the service down (fallback path only). Run
  `ml-service/verify_local.py`.
- **Live Gemini.** No key was available. Gemini was stubbed in tests. The
  model names `gemini-3.8-flash` / `gemini-3.1-flash-lite` are carried over
  unchanged and are not verified.
- **Hosted deployment** (finai-demo1.ai.studio). Not inspected or changed.
  Even if it serves this build, it cannot reach a forecasting service running
  on the laptop.
- **The Windows `npm test`.** It previously failed on the Linux bridge
  because of the esbuild binary, and passes on Windows according to earlier
  notes. Not re-run on Windows.

## Remaining known issues

1. **The review-day data gap** (see Manual steps). The figures are labelled
   but still understated until the data is current.
2. **The 52-week baseline conflict, and notebook verification of all
   benchmark figures.** This needs `finai_exp2_forecasting.ipynb`.
3. **Anomaly Expected/Dismiss** is still browser-only state, so it resets on
   refresh.
4. **No duplicate-receipt warning** in OCR.
5. **The admin view shows four sample users.** They are labelled as sample
   data in the UI; they are not real accounts.
6. **Rate limits are in-memory**, so they reset on restart. This is
   acceptable for a single-process demo, not for production.
7. **Legacy `backend/`** (Prophet / Isolation Forest, hardcoded JWT secret) is
   unused and unwired. It is documented as legacy in `backend/README.md`; do
   not run it.
8. **Removed emergency fallback server:** the old one answered "FinAI Server
   Online" when startup failed, which hid the failure. Startup errors now exit
   with a message.

## Manual steps (need you)

1. **Revoke the exposed Gemini key** in Google AI Studio and create a new one.
   Put it only in `.env.local` (git-ignored). Also check the GitHub repo's
   history for the old key; rotating it is what matters, since history
   rewrites don't un-leak a key.
2. **Generate `AUTH_SECRET`** and add it to `.env.local` (command in
   `RUNNING_LOCALLY.md`).
3. **Run the migration:** the first `npm run dev` hashes the password
   automatically. Then:
   - sign in with the same password as before;
   - delete the `finai_store.pre-auth-migration-*.json` backup once satisfied;
   - delete `finai_store.json.bak`, an old AI Studio leftover that still holds
     the old plaintext password.
4. **Before the review:** bring the data up to date. Either log the missing
   days, or regenerate the synthetic seed that morning with `DEMO_PASSWORD`
   set, so it ends on the review day. The second option replaces the demo
   transactions; it is your call.
5. **Optional:** register an account and run `npm run admin:grant -- <name>`
   if you want to show the admin view.
6. **Send `finai_exp2_forecasting.ipynb`** (and the categorizer and anomaly
   notebooks) to settle the benchmark figures.

---

## Step 3 — Sign-in, sign-up and the first screen (24 Oct)

### Problems found (reproduced in a real browser)

1. **Username pre-filled with `demo_user`:** "Create account" always failed with "Username already registered" unless it was changed.
2. **Rules not shown:** the 3–32 character username rule (no spaces) and the 8-character password minimum appeared only after a rejected submit.
3. **Income silently fixed at ₹50,000** for every new account.
4. **No confirm-password field.**
5. **After sign-up, no sign-in:** you were sent back to the login form to type everything again.
6. **A new account with no transactions saw invented figures:**
   - a 100/100 "Healthy" score;
   - "Saved ₹50,000 (100%)";
   - a ₹35,000 forecast, which was 70% of income;
   - 500% of its savings budget.

### Changes

- **`src/components/AuthScreen.tsx` (new):** a sign-in / create-account screen.
  - Two-column layout on desktop, stacked on phones.
  - Sign-up asks for username, monthly income, password and confirm password.
  - The server's rules are checked as you type and shown under each field; the server's own message is shown if it disagrees.
  - Show/hide password control.
  - Signs straight in after creating an account.
  - Remembers the last username (never the password).
  - Proper labels, `aria-invalid` / `aria-describedby`, and `autocomplete` hints so password managers work.
  - Focus moves to the form only when switching tabs.
- **`src/App.tsx`:**
  - uses `AuthScreen`;
  - shows "Your session has ended. Sign in again to continue." when a session expires;
  - fixes the Sign out handler, which would otherwise have passed the click event in as that message.
- **`src/server/app.ts`:** an account with no transactions now gets `forecast_model: "none"` and no forecast figure, instead of a projection invented from income.
- **`src/components/Dashboard.tsx`:** an account with no transactions sees a welcome screen.
  - It offers three ways to add the first entry.
  - It lists what appears as data accumulates: summary and simulator from the first entry, alerts once a category has a few entries, Chronos-2 from 26 weeks.
  - No AI insight request is made for an empty account.
- **`src/index.css`:** styles for the sign-in headline and inputs.

### Verified

- `npm test`: **85 / 85** (one new test: a new account gets no invented forecast). Typecheck and build are clean.
- **Real-browser run (Chromium, production build, copy of the store) — 13 checks pass, no page errors:**
  1. empty sign-in shows field errors;
  2. empty sign-up shows field errors;
  3. a name with a space, a short password and mismatched passwords each show the right message;
  4. a taken username shows the server's message;
  5. show/hide password works;
  6. successful sign-up signs in and shows the welcome screen with the entered income and no invented figures;
  7. the add-transaction window opens from the welcome screen;
  8. after the first transaction the full dashboard appears;
  9. sign out remembers the username;
  10. a wrong password gives a clear error;
  11. an expired session returns to sign-in with the notice;
  12. no horizontal scrolling at 390 px wide;
  13. keyboard tab order starts at the first control.

### Not verified

- Your Windows browser: run through sign-up there too.
- Screen-reader output was not tested with an actual screen reader.
- Monthly income can only be set at sign-up; there is no settings page to change it yet.

### Follow-up: admin button (24 Oct)

- **Problem:** the top bar showed "Admin view" to every signed-in account. Clicking it signed the person out and opened the admin sign-in.
- **Fix (`src/App.tsx`):**
  - After sign-in the app reads `/api/profile`. The button appears only when the server reports `is_admin: true`, never on anything decided in the browser.
  - For an admin, the button opens the admin view without signing out, and leaving the admin view returns to their own dashboard.
  - The top bar now shows "Signed in as <username>".
- **Verified in a browser:**
  - `demo_user` and a newly registered account do **not** see the button.
  - An account granted admin with `npm run admin:grant` sees it, opens the admin view while staying signed in, and returns to its own dashboard.
  - No page errors.

---

## Step 4 — Visual identity (24 Oct)

### Why

The previous look (near-black background with a single mint accent) is one of the most common generated-dashboard styles, and dark themes wash out on classroom projectors.

### Direction

- **Colour:** grounded in Indian money, from the Mahatma Gandhi New Series banknotes.
  - Stone-grey paper (₹500) for the page.
  - Green-black ink for text.
  - The ₹2000 magenta as the single accent.
  - A light theme.
- **Type:** **Anek Latin** (Ek Type, an Indian foundry, OFL licence), bundled with the app so it works offline. Large headings and figures use its narrower width (88%, the sign-in headline 82%); body text uses the normal width.
- **Signature:** the "Income − Spent = Saved" equation heads the sign-in page and matches the dashboard's summary line.

Layout, features and every computed figure are unchanged.

### Measured, not eyeballed

- **Text:** ink, ink-2 and ink-3 on every surface are ≥ 4.5:1. Button text on magenta is 6.5:1; status colours as text are ≥ 5.4:1.
- **Form-field outlines:** ≥ 3:1 against the field and every surrounding surface (4.0 / 3.2 / 3.5), via a new `--color-field` token applied to all text inputs (WCAG 1.4.11).
- **Category colours:** the first hand-picked set failed — Food and Entertainment collapsed to ΔE 2.9 under protanopia, and Food sat too close to the caution amber. The final set (navy, chai brown, deep teal, plum, leaf) came from a constrained search over hue and lightness:
  - every slot ≥ 3:1 on every surface;
  - worst pair ΔE2000 **25.2** normal, **15.0** protan, **14.4** deutan (Machado–Oliveira–Fernandes 2009 at severity 1.0; thresholds 15 / 10 / 10);
  - ≥ 14.4 from every status colour and the accent.

### Changes

- `src/index.css`: new tokens, the `--color-field` outline, `color-scheme: light`, narrow-width headings.
- `src/ui/theme.ts`: chart literals now mirror the new tokens.
- `src/main.tsx`: loads Anek Latin.
- `package.json` / `package-lock.json`: `@fontsource-variable/anek-latin` 5.3.0 (published Jul 2026); the old font import was removed.
- **332 hardcoded colours converted to tokens** in `AdminDashboard.tsx`, `ReceiptScanner.tsx`, `TransactionModal.tsx` and `ChatAssistant.tsx`. Those four components now match the rest of the app; none remain anywhere in `src`.

### Verified

- `npm test`: 85 / 85. Typecheck and build are clean.
- All 13 sign-in / sign-up browser checks pass again on the restyled build, with no page errors.
- In the browser, the bundled font loads (`document.fonts.check` true).
- Screenshots reviewed: sign-in, dashboard, insights, forecast chart, simulator, add-transaction window.

### Not verified

- **The admin view and the receipt scanner were converted but not screenshotted.** Check them on your laptop.
- **Not checked on a real projector.**

---

## Step 5b — Direction A, "sidebar workspace" (24 Oct, evening)

Chosen by Hrishikesh from three previews; it replaces the banknote theme. Details, measurements and screenshots are in `docs/FINAI_UI_UX_REDESIGN.md`.

- **Shell:** an indigo sidebar on wide screens; an indigo top bar and bottom tabs on phones.
- **Colour:** white workspace and saffron actions.
- **Overview:** Income / Spent / Saved tiles.
- **Sign-in:** an indigo panel.
- **Unchanged:** no server or engine change in this step.
- **Verified:** 88 / 88 tests; all view, responsive and sign-up browser checks pass.

---

## Step 6 — SQLite database and Kaggle sample account (25 Oct)

**Storage.** Data moved from `finai_store.json` to **`finai_data.sqlite`**, using Node's built-in `node:sqlite` (Node ≥ 22.5): no new package and no database server.

**Schema** (`src/server/db.ts`):
- **`users`:** username unique and case-insensitive; savings target CHECK 0–90; role NULL or `admin`.
- **`transactions`:** amount > 0; category one of five; merchant 1–100 characters; source `user` / `synthetic` / `kaggle`; foreign key to users with ON DELETE CASCADE; index on `(user_id, date)`.
- **`anomaly_reviews`:** primary key `(user, transaction)`; cascades on both.
- **`meta`:** schema version, plus import details.
- WAL journal mode, foreign keys on.

**Repository.** Every route reads and writes through owner-scoped functions (`getTransaction(userId, id)`, …). There is no in-memory copy, so the command-line scripts are safe while the server runs.

**First start** (`src/server/bootstrap.ts`):
- an existing `finai_store.json` is imported in one transaction, with plaintext passwords hashed first;
- a backup is written **from the migrated records**, so it holds no plaintext;
- the original is removed, so the import never runs twice;
- with no JSON, the synthetic demo account is created.

**Bugs found by the new tests.**
- **Plaintext in the backup:** the first version renamed the original JSON as the backup, which kept the plaintext password. The test checking every file in the folder caught it; the backup is now written from the hashed data.
- **Warning in ES modules:** a static `import 'node:sqlite'` printed Node's experimental warning in ES-module scripts; SQLite is now loaded on first use.

**Kaggle account** (`src/server/kaggleImport.ts`, `scripts/import-kaggle.ts`, `npm run import:kaggle`):
- **Dataset:** Daily Transactions Dataset (Prasad Patil). Licence still to be confirmed from the Kaggle page.
- **Mapping:** spending = Expense rows minus savings products, with Transfer-Out excluded, mapped onto the five categories; income = the latest month's salary.
- **Dates:** an optional whole-week date shift, recorded in `meta` and stated on the dashboard and in Settings.

**Verified:**
- **`npm test`: 99 / 99** (88 existing tests moved onto SQLite, checking persistence through a second connection; 7 database tests; 4 import tests).
- **The import matches pandas figures computed independently:** 2,043 spending rows, 133 savings and 160 transfers excluded, 125 income rows, ₹70,255 income, total ₹15,73,532.
- **The date shift** preserves weekdays, order and amounts.
- **End to end on a copy of the real project state:**
  - the first start imported 1 user and 400 transactions and hashed the password, with no plaintext in any file;
  - the Kaggle import worked while the server was running, and a second import is refused without `--replace`;
  - a restart did not re-import.
- **In the browser:** `kaggle_demo` shows the dataset notice, 2,043 transactions totalling ₹15,73,532.53, and Settings source "Kaggle sample dataset"; `demo_user` still signs in after migration; no page errors.
- Production build clean.

---

## Step 7 — Learned categorizer from the Kaggle dataset (25 Oct)

Hrishikesh decided the Kaggle dataset is for ML evaluation and training, not a user account. `npm run import:kaggle` stays in the code but is not used.

**Finding.** On the dataset, the existing keyword rules scored **37.5%** (below the 45.6% of always guessing Food). 66.7% of descriptions matched no rule at all.

**Experiment** (`scripts/train-categorizer.ts`; full report in `docs/CATEGORIZER_EXPERIMENT.md`):
- **Split by time:** fit 2015-01 to 2017-06, validation 2017-07 to 2017-12, and a held-out test 2018-01 to 2018-09 scored once.
- **Candidates:** 20 in total — Naive Bayes over words, bigrams and character 3-grams, with 4 smoothing values, alone or combined with the rules in 4 ways.
- **Selection:** the best on validation among candidates that keep all 20 of FinAI's own demo merchants correct, a requirement fixed in advance.
- **Correction made during the run:** the first run selected by validation alone and applied the merchant requirement afterwards, so nothing was adopted. Selection was corrected to apply the requirement up front. No test data informed the choice.

**Result on 2018 (564 rows):**
- the chosen **hybrid (rules first, then model) scores 91.0%**, vs **27.8%** for the rules: +63.1 points, 95% CI [59.0, 67.2];
- 20/20 demo merchants are still correct;
- the model alone scores 92.4% but breaks 13 of the 20 merchants.

**Caveat:** one individual's vocabulary; this is not evidence for Indian spending descriptions in general.

**Integration:**
- `categorize.ts` uses the hybrid;
- new `POST /api/categorize`;
- the add-transaction window shows a live, explained suggestion with an override;
- the receipt scanner uses the same suggestion;
- no probability is shown, because Naive Bayes is badly calibrated.

**Verified:**
- **`npm test`: 103 / 103** (4 new tests);
- build clean;
- browser: model, rule and fallback paths, plus an override saved correctly.

**Open:** dataset licence, required before deploying the derived model.

---

## Step 8 — "Data and models" section in Settings (25 Oct)

**Purpose:** a reviewer can see which models run, whether they are running now, how each was tested, and which dataset was used, without opening files.

**Live facts** come from a new `GET /api/models` (signed in):
- the forecasting-service state, read from the ML service's `/health`;
- whether Gemini is configured;
- the categorizer's own details, read from the model file (1,425 training descriptions, trained-on period, feature count).

**Measured results** come from `src/models/modelFacts.ts`, which names the report behind each figure:
- forecasting: 0.742 vs 0.863 (synthetic) and 0.746 vs 0.911 (Kaggle, with its interval);
- categorizer: 91.0% vs 27.8% on 564 unseen 2018 rows.

A dataset card links to the Kaggle page. The licence shows "See the dataset page" until it is confirmed.

**Verified:**
- `npm test`: 104 / 104 (new test: the endpoint's training details match the shipped model file).
- In the browser:
  - the status reads "Not running; using the 8-week moving average" with no service, and "Running" when a stand-in service reports Chronos-2 ready, so the status is live;
  - every figure matches its report;
  - no overflow at 390 px, no page errors.
