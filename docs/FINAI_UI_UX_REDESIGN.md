# FinAI 2.0 — UI/UX redesign

*FinAI — your money, in perspective.* Written 24 Oct 2026. Every claim marked **verified** was run in a real browser (Chromium, production build, a copy of the demo store) or by the test suite; anything else is listed under "Not done".

## Design direction (revised 24 Oct, evening)

The banknote theme was replaced at Hrishikesh's request. He chose **direction A, "sidebar workspace"**, from three side-by-side previews (sidebar workspace, bold blocks, dark premium).

- **Position:**
  - Navigation moves into a fixed **deep indigo sidebar** on the left, with the account and sign-out at its foot.
  - On phones there is an indigo top bar plus a bottom tab bar with all five sections.
- **Colour:**
  - A white workspace with warm-grey tiles.
  - Indigo `#26215C` for the shell and the one figure that matters most on the overview (Saved).
  - **Saffron `#B4431A`** as the single action colour.
- **Overview summary:** Income, Spent and Saved are three tiles, with Saved filled indigo, above the goal bar.
- **Sign-in:** an indigo panel with the *Income − Spent = Saved* headline (Saved in saffron), and a light form panel.
- **Type:** Anek Latin, bundled offline, as before.

**Measured:**
- ink / ink-2 / ink-3 ≥ 5.0:1 on every surface;
- white on saffron 5.6:1, and saffron as text ≥ 4.6:1 (a first value failed at 4.07 and was darkened);
- status colours as text ≥ 4.8:1;
- field outlines ≥ 3.4:1 (a first value failed at 2.95);
- sidebar text 9.3:1;
- saffron ≥ 17 ΔE2000 from both red and amber, so actions never look like warnings;
- category colours: found by a constrained search, every slot ≥ 3:1, worst pair ΔE2000 21.7 normal / 18.8 protan / 15.2 deutan, and ≥ 14.4 from indigo, saffron and every status colour.

## Major UX decisions

| Problem in the old app | Decision |
|---|---|
| One very long page; a numbered 1–4 bar was the only navigation | **Real navigation:** Overview · Transactions · Forecast · Savings planner · Settings. Every destination exists. The current view is marked by weight, an underline and `aria-current`, not colour alone. The view is kept in the address (`#transactions`), so refresh, links and the back button work. |
| Transaction list with tall rows, no search, filter, sort or paging | **Transactions view:** merchant search, category filter, date range, sortable date and amount, 25 per page, a live count and total of what is shown, an edit control per row. On phones each transaction is one line with no sideways scrolling. The overview shows the latest six with a link to all. |
| Income could only be set at sign-up | **Settings:** monthly income, savings target (0–90%) and password change (needs the current password). All server-validated; the overview, budget and planner pick up changes immediately. |
| Budget showed savings as "500%" | **Budget in words:** "₹12,711 left of ₹25,000", "₹X over its ₹Y share", "₹21,935 above the ₹10,000 target". No bare percentages above 100%. The title says "last 30 days". |
| Unusual transactions as red alarm panels; "Expected / Dismiss" reset on refresh | **"Worth a second look":** a plain list with merchant, amount, category, date and why it was flagged, plus "Unusual is not the same as wrong". Verdicts are **saved on the server** per user, with Undo. |
| Two identical "Write summary" buttons | One button. |
| "31.2% less effort" with no definition on screen | **"How effort is measured"** under the figure. It is generated from the engine's own weights (Bills 5, Food 2, Transport 2.5, Shopping 1, Entertainment 0.8), states that the weights and limits are assumptions rather than measurements, and that the plan is the lowest-effort one within them, checked against brute force in the tests. |
| New accounts saw a 100/100 score and an invented ₹35,000 forecast | A welcome screen with three ways to add the first entry and what appears as data accumulates. The server no longer invents a forecast for empty accounts. |
| Admin button shown to everyone | Shown only when the server reports the account as admin. |

## Files

**New**
- `src/components/AppSidebar.tsx`: sidebar, phone top bar and bottom tabs
- `src/components/AppNav.tsx`: view ids
- `src/components/TransactionsView.tsx`
- `src/components/SettingsView.tsx`
- `src/components/AuthScreen.tsx` (Step 3)
- `src/components/EditTransactionDialog.tsx` (Phase 2)
- `docs/screenshots/*.jpg`

**Changed**
- `src/components/Dashboard.tsx`: views, budget, alerts, latest list, summary.
- `src/components/SimulatorPanel.tsx`: effort note.
- `src/App.tsx`: profile, admin button, username.
- `src/index.css` and `src/ui/theme.ts`: tokens, font, field outlines.
- `src/main.tsx`: font.
- Four components converted from 332 hardcoded colours to tokens: `AdminDashboard`, `ReceiptScanner`, `TransactionModal`, `ChatAssistant`.
- **Server:**
  - `src/server/app.ts`: `PUT /api/profile`, `POST /api/profile/password`, `PUT /api/anomalies/:id/review`, and anomaly reviews returned with the dashboard.
  - `src/server/validation.ts` and `src/server/types.ts`.
  - `src/server/app.test.ts`: 3 new tests.
- `package.json` / `package-lock.json`: `@fontsource-variable/anek-latin` 5.3.0.

**Unchanged:** `engine.ts`, `grounding.ts`, the forecasting service, all existing tests.

## Verification

- **`npm test`: 88 / 88.** That is 24 original engine and grounding tests plus 64 since. The 3 new ones cover settings validation (including that a user cannot make themselves admin), password change, and per-user anomaly reviews.
- **`tsc --noEmit` clean; production build succeeds.**
- **Browser, navigation and views:**
  - all five tabs work, and the back button returns to the previous view;
  - search "rent" gives 15 of 400; the Entertainment filter shows only Entertainment; sorting by amount is correct; paging shows 1 of 16, then 2 of 16;
  - an income change in Settings appears on the overview, and an invalid income is rejected with a message;
  - a password change works, and the new password signs in;
  - an anomaly verdict survives a reload, and Undo works;
  - the budget shows no percentage above 100%, and there is exactly one Write summary button;
  - the effort note appears when a plan is needed, with the engine's weights;
  - a link to `#settings` opens Settings after sign-in.
- **Browser, sign-in and sign-up:** all 13 earlier checks still pass, with no page errors in any run.
- **Responsive:** every view at 1440, 1280, 1024, 768 and 390 px has no horizontal overflow; the sidebar shows at 1024 px and up, the bottom tabs below that.
- **Direction A, re-verified in the browser:**
  - all the checks above;
  - the admin entry in the sidebar is visible only to an account granted admin, opens the admin view while staying signed in, and returns to its own dashboard;
  - the effort note appears for a reachable goal;
  - for an unreachable one (a 40% target on ₹50,000), the planner correctly reports that the goal cannot be met within the category limits.

## Not done from the brief (honestly)

- **Overview layout:** not rebuilt into the brief's briefing structure.
  - The summary line, category list and spending-pace chart keep their 22 Oct design, recoloured.
  - No period selector; the window is a fixed rolling 30 days, and labelled so.
  - No "financial attention" priority list beyond the budget and alerts block.
  - Categories are not clickable through to filtered transactions.
- **Forecast view:** kept from the 22 Oct redesign plus the Phase-2 honesty fixes. No new chart work was done in this step.
- **Monthly summary content:** unchanged apart from the duplicate button. There is no comparison with the previous period.
- **Insights panel:** still a list of three sentences, not evidence-tagged observations.
- **Planner controls:** still sliders only, with no numeric inputs.
- **Not screenshotted:** the admin view and the receipt scanner were recoloured but not screenshotted.
- **No real projector or screen reader** was used.

## Screenshots (direction A)

Real screenshots of the implemented app, from the browser test runs, in `docs/screenshots/`:

1. `01-sign-in.jpg`
2. `02-overview.jpg`
3. `03-transactions.jpg`
4. `04-planner.jpg`
5. `05-phone-overview.jpg`

## Verification of direction A

- `npm test` 88 / 88; typecheck and build clean.
- **Every view check passes** on the direction-A build: navigation, search, filter, sort, paging, back button, settings flowing into the overview, password change, anomaly review persistence and Undo, budget wording, one summary button.
- **All five widths** (1440, 1280, 1024, 768, 390 px) with no horizontal overflow.
- **All 13 sign-in / sign-up checks pass.**
- **The effort note renders** at the demo's default settings.
- No page errors.

## Settings, interactive (25 Oct)

- **Income and goal:** savings-target slider synced with an exact-number box and 10 / 20 / 30% presets.
  - A **live preview** against the last 30 days shows: would-be-saved, rate, goal in rupees, met or short and by how much, and the 50/30/20 split of the typed income.
  - An unsaved-changes badge, Reset, and Save enabled only when something changed.
- **Password:** a length meter (labelled as measuring length only), a live match check, and show/hide.
- **Account and data panel:** username, access level, session length; transaction count, first and latest entry, total, and source (synthetic or yours).
- **Download my transactions (CSV):** built in the browser from the loaded records, with quotes escaped.

**Verified in the browser:**
- **Preview arithmetic.** ₹60,000 gives saved ₹41,935, 69.9%, goal ₹12,000 and ₹29,935 spare; 30% gives ₹18,000 and ₹23,935 spare; 45% gives ₹27,000 and ₹14,935 spare.
- **After saving:** the overview showed exactly ₹41,935 and "69.9% of income, meets the 30% goal".
- **Controls:** slider, preset and exact box stay in sync; an invalid income clears the preview with a message; Reset restores the saved values.
- **The CSV:** 400 rows totalling ₹5,85,769.82, equal to the Transactions page total.
- **Password feedback:** the strength meter and match check update live.
- **Layout:** no overflow at 1280, 1024, 768 and 390 px; no page errors; 88 / 88 tests.
