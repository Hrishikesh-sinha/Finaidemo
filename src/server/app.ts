// All /api routes. Built by a factory so the server and the tests run exactly
// the same code; the tests pass an isolated store and stub ML/Gemini.

import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import {
  buildFinancialState, withForecastBaseline, simulateScenario, optimizeForGoal, type FinancialState
} from '../simulator/engine';
import { buildFacts, buildPrompt, checkGrounding, extractNumbers, templateExplanation } from '../simulator/grounding';
import { burnPasswordCheck, hashPassword, signToken, verifyPassword, verifyToken } from './auth';
import {
  buildSummaryFacts, CHAT_SYSTEM, factsBlock, INSIGHTS_SYSTEM, REPORT_SYSTEM,
  templateChat, templateInsights, templateReport
} from './aiFacts';
import { categorize, categorizerInfo } from './categorize';
import { RateLimiter } from './rateLimit';
import { summarize } from './reporting';
import type { Repo } from './repo';
import type { StoredTransaction, StoredUser } from './types';
import {
  parseVoiceText, validateNewTransaction, validatePasswordChange, validateProfileUpdate, validateRegistration, validateTransactionUpdate
} from './validation';
import { toWeeklySeries } from './weekly';

export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];
export const ML_FORECAST_HORIZON_WEEKS = 4;
export const JSON_BODY_LIMIT = '32kb';
const MAX_CHAT_PROMPT_LENGTH = 500;

export interface MlForecast {
  forecast: number[];
  lower?: number[];
  upper?: number[];
  model: string;
  weeks_of_history?: number;
  reason?: string | null;
}

export interface GenerateRequest {
  model: string;
  system: string;
  user: string;
  json?: boolean;
  temperature?: number;
}
// Returns the model's text, or throws. null means "no key configured".
export type GenerateFn = (req: GenerateRequest) => Promise<string>;

export interface AppDeps {
  repo: Repo;
  authSecret: string;
  fetchForecast: (weekly: number[]) => Promise<MlForecast | null>;
  generate: GenerateFn | null;
  // State of the forecasting service: 'ready', 'loading', 'failed' or 'unreachable'.
  mlStatus?: () => Promise<string>;
  now?: () => number;
  aiLimiter?: RateLimiter;
  loginLimiter?: RateLimiter;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
}

type AuthedRequest = Request & { user: StoredUser };
type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;

// Express 4 does not route rejected promises to the error handler by itself.
const ah = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

const bad = (res: Response, detail: string, status = 400) => res.status(status).json({ detail });

export function createApp(deps: AppDeps) {
  const { repo, authSecret, fetchForecast, generate } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console;
  // Per user, across chat, insights, report and simulator explanations.
  const aiLimiter = deps.aiLimiter ?? new RateLimiter(20, 10 * 60 * 1000, now);
  // Per client address + username.
  const loginLimiter = deps.loginLimiter ?? new RateLimiter(10, 15 * 60 * 1000, now);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: JSON_BODY_LIMIT }));

  const userTxs = (user: StoredUser) => repo.listTransactions(user.id);

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return bad(res, 'Missing or invalid authentication token', 401);
    const claims = verifyToken(header.slice(7).trim(), authSecret, now());
    if (!claims) return bad(res, 'Invalid or expired session', 401);
    repo.findUserById(claims.sub).then(user => {
      if (!user) return bad(res, 'Invalid or expired session', 401);
      (req as AuthedRequest).user = user;
      next();
    }, next);
  };

  const aiQuota = (req: Request, res: Response, next: NextFunction) => {
    const wait = aiLimiter.take((req as AuthedRequest).user.id);
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      return bad(res, `Too many AI requests. Try again in ${wait} seconds.`, 429);
    }
    next();
  };

  // AI endpoints compute every figure from the user's own records. A body that
  // tries to supply figures is refused rather than silently ignored.
  const noClientFigures = (allowedKeys: string[]) => (req: Request, res: Response, next: NextFunction) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const extra = Object.keys(body).filter(k => !allowedKeys.includes(k));
    if (extra.length) {
      return bad(res, `Unexpected field(s): ${extra.join(', ')}. Financial figures are computed on the server from your own records.`);
    }
    next();
  };

  // Ask each model in turn; accept the first reply that passes `accept`.
  const grounded = async <T>(
    req: Omit<GenerateRequest, 'model'>,
    accept: (text: string) => { value: T } | { reason: string },
    label: string
  ): Promise<{ value: T; model: string } | { problem: string }> => {
    if (!generate) return { problem: 'GEMINI_API_KEY is not set' };
    let problem = 'Gemini did not respond';
    for (const model of GEMINI_MODELS) {
      try {
        const text = await Promise.race([
          generate({ ...req, model }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out after 12s')), 12000))
        ]);
        const verdict = accept((text ?? '').trim());
        if ('value' in verdict) return { value: verdict.value, model };
        problem = `Gemini's reply ${verdict.reason}`;
        log.warn(`[FinAI] ${label} from ${model} rejected: ${verdict.reason}`);
      } catch (err) {
        problem = 'Gemini request failed';
        log.warn(`[FinAI] ${label} model ${model} failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }
    return { problem };
  };

  // -------------------------------------------------------------------------
  // Accounts
  // -------------------------------------------------------------------------

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', server: 'FinAI Engine', storage: repo.backend }));

  app.post('/api/register', ah(async (req, res) => {
    const v = validateRegistration(req.body);
    if ('error' in v) return bad(res, v.error);
    const { username, email, password, monthly_income } = v.value;
    if (await repo.findUserByUsername(username)) {
      return bad(res, 'Username already registered');
    }
    if (await repo.findUserByEmail(email)) {
      return bad(res, 'An account with this email already exists. Sign in instead.');
    }
    try {
      await repo.createUser({
        id: `user_${randomBytes(9).toString('base64url')}`,
        username,
        email,
        password_hash: await hashPassword(password),
        monthly_income,
        target_savings_percent: 20.0
      });
    } catch (err) {
      // Two registrations for the same name at once: the second loses here.
      if (await repo.findUserByUsername(username)) return bad(res, 'Username already registered');
      if (await repo.findUserByEmail(email)) return bad(res, 'An account with this email already exists. Sign in instead.');
      throw err;
    }
    return res.json({ message: 'User registered successfully' });
  }));

  app.post('/api/token', ah(async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const wait = loginLimiter.take(`${req.ip}|${username.toLowerCase()}`);
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      return bad(res, `Too many sign-in attempts. Try again in ${wait} seconds.`, 429);
    }
    // Sign in with either the username or the email address.
    const user = username.includes('@') ? await repo.findUserByEmail(username) : await repo.findUserByUsername(username);
    const valid = user?.password_hash
      ? await verifyPassword(password, user.password_hash)
      : await burnPasswordCheck(password);
    if (!user || !valid) return bad(res, 'Incorrect username or password');
    return res.json({ access_token: signToken(user.id, authSecret, now()), token_type: 'bearer' });
  }));

  app.get('/api/profile', requireAuth, (req, res) => {
    const user = (req as AuthedRequest).user;
    return res.json({
      username: user.username,
      email: user.email ?? null,
      monthly_income: user.monthly_income,
      target_savings_percent: user.target_savings_percent,
      is_admin: user.role === 'admin'
    });
  });

  app.put('/api/profile', requireAuth, ah(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const v = validateProfileUpdate(req.body);
    if ('error' in v) return bad(res, v.error);
    const updated = (await repo.updateProfile(user.id, v.value))!;
    return res.json({
      username: updated.username,
      email: updated.email ?? null,
      monthly_income: updated.monthly_income,
      target_savings_percent: updated.target_savings_percent,
      is_admin: updated.role === 'admin'
    });
  }));

  // Changing the password needs the current one; same rate limit as sign-in,
  // so a stolen session cannot be used to guess it.
  app.post('/api/profile/password', requireAuth, ah(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const wait = loginLimiter.take(`${req.ip}|${user.username.toLowerCase()}`);
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      return bad(res, `Too many attempts. Try again in ${wait} seconds.`, 429);
    }
    const v = validatePasswordChange(req.body);
    if ('error' in v) return bad(res, v.error);
    const ok = user.password_hash ? await verifyPassword(v.value.current, user.password_hash) : false;
    if (!ok) return bad(res, 'Your current password is not correct.');
    await repo.setPasswordHash(user.id, await hashPassword(v.value.next));
    return res.json({ message: 'Password changed' });
  }));

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------

  app.get('/api/dashboard', requireAuth, ah(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const [txs, reviews, importRaw] = await Promise.all([userTxs(user), repo.getReviews(user.id), repo.getMeta(`import:${user.id}`)]);
    const t = now();
    const s = summarize(user, txs, t);
    // Forecast: Chronos-2 (26+ weeks) or 8-week average from ml-service; a
    // labelled flat projection if the service is unreachable. The forecast
    // covers the 4 weeks after the latest transaction, which is not the same
    // period as the rolling 30-day window above; both are labelled.
    const series = toWeeklySeries(txs, t);
    // Fallback: the 30 days up to the latest transaction plus 3%, so it covers
    // the same period as the label "the 30 days after <latest transaction>".
    // (Measuring to today instead would project from days with nothing logged.)
    const DAY_MS = 24 * 60 * 60 * 1000;
    const lastTs = series.through ? new Date(series.through).getTime() : null;
    const lastMonthSpend = lastTs === null ? 0 : txs
      .filter(tx => { const ts = new Date(tx.date).getTime(); return ts > lastTs - 30 * DAY_MS && ts <= lastTs; })
      .reduce((a, tx) => a + tx.amount, 0);
    let forecastNext30Days = Math.round(lastMonthSpend * 1.03);
    let forecastModel = 'heuristic';
    let forecastReason: string | null = 'forecasting service unreachable; flat 3% projection of the 30 days up to the latest transaction';
    let forecastLower: number | null = null;
    let forecastUpper: number | null = null;
    let forecastWeeksOfHistory = series.totals.length;
    let ml: MlForecast | null = null;

    if (series.totals.length === 0) {
      // Nothing logged yet: no forecast at all, rather than a number invented
      // from income.
      forecastNext30Days = 0;
      forecastModel = 'none';
      forecastReason = 'no transactions yet; nothing to forecast';
    } else {
      ml = await fetchForecast(series.totals);
      if (ml) {
        const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
        const scale = 30 / (ml.forecast.length * 7);
        forecastNext30Days = Math.round(sum(ml.forecast) * scale);
        forecastModel = ml.model;
        forecastReason = ml.reason ?? null;
        forecastWeeksOfHistory = ml.weeks_of_history ?? series.totals.length;
        if (Array.isArray(ml.lower) && ml.lower.length === ml.forecast.length) forecastLower = Math.round(sum(ml.lower) * scale);
        if (Array.isArray(ml.upper) && ml.upper.length === ml.forecast.length) forecastUpper = Math.round(sum(ml.upper) * scale);
      }
    }

    const HISTORY_WEEKS_SHOWN = 26;
    const offset = Math.max(0, series.totals.length - HISTORY_WEEKS_SHOWN);
    const sameLen = (xs?: number[]) => (Array.isArray(xs) && ml && xs.length === ml.forecast.length ? xs : null);

    return res.json({
      reporting: s.reporting,
      total_spent: s.total_spent,
      savings_rate: s.savings_rate,
      health_score: s.health_score,
      category_breakdown: s.category_breakdown,
      forecast_next_30_days: forecastNext30Days,
      forecast_model: forecastModel,
      forecast_reason: forecastReason,
      forecast_lower_30_days: forecastLower,
      forecast_upper_30_days: forecastUpper,
      forecast_weeks_of_history: forecastWeeksOfHistory,
      // The forecast starts after this date (latest transaction).
      forecast_starts_after: series.through,
      forecast_weekly: {
        week_starts: series.weekStarts.slice(offset),
        history: series.totals.slice(offset),
        forecast: ml?.forecast ?? null,
        lower: sameLen(ml?.lower),
        upper: sameLen(ml?.upper)
      },
      synthetic_demo_data: txs.some(tx => tx.source === 'synthetic'),
      // Where this account's data came from, so the UI can label it.
      data_source: txs.some(tx => tx.source === 'kaggle') ? 'kaggle' : txs.some(tx => tx.source === 'synthetic') ? 'synthetic' : txs.length ? 'user' : null,
      // For imported sample data: which dataset, its original dates, and how
      // far they were shifted, so the UI can say exactly what was done.
      data_import: (() => {
        if (!importRaw) return null;
        try {
          const m = JSON.parse(importRaw);
          return { dataset: m.dataset, url: m.url, original_first: m.original_first, original_last: m.original_last, shift_weeks: m.shift_weeks };
        } catch {
          return null;
        }
      })(),
      monthly_income: user.monthly_income,
      target_savings_percent: user.target_savings_percent,
      smart_budget: s.smart_budget,
      anomalies: s.anomalies.map(a => ({
        id: a.id, amount: a.amount, merchant: a.merchant, category: a.category, date: a.date,
        review: reviews[a.id] ?? null
      }))
    });
  }));

  // -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  const publicTx = (t: StoredTransaction) => ({ id: t.id, amount: t.amount, merchant: t.merchant, category: t.category, date: t.date });
  const newTxId = () => `tx_${now()}_${randomBytes(4).toString('hex')}`;
  // 404 for both "missing" and "someone else's", so ids cannot be probed.
  const ownTx = (user: StoredUser, id: string) => repo.getTransaction(user.id, id);

  app.get('/api/transactions', requireAuth, ah(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const list = (await userTxs(user)).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return res.json(list.map(publicTx));
  }));

  app.post('/api/transactions', requireAuth, ah(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const v = validateNewTransaction(req.body, now());
    if ('error' in v) return bad(res, v.error);
    const tx: StoredTransaction = { id: newTxId(), user_id: user.id, ...v.value };
    await repo.insertTransaction(tx, 'user');
    return res.json({ message: 'Transaction added', id: tx.id, category: tx.category, transaction: publicTx(tx) });
  }));

  app.put('/api/transactions/:id', requireAuth, ah(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const tx = await ownTx(user, req.params.id);
    if (!tx) return bad(res, 'Transaction not found', 404);
    const v = validateTransactionUpdate(req.body, now());
    if ('error' in v) return bad(res, v.error);
    const updated = (await repo.updateTransaction(user.id, tx.id, v.value))!;
    return res.json({ message: 'Transaction updated', transaction: publicTx(updated) });
  }));

  app.delete('/api/transactions/:id', requireAuth, ah(async (req, res) => {
    const user = (req as AuthedRequest).user;
    // Reviews of the transaction are removed with it.
    if (!(await repo.deleteTransaction(user.id, req.params.id))) return bad(res, 'Transaction not found', 404);
    return res.json({ message: 'Transaction deleted', id: req.params.id });
  }));

  // Live facts for Settings, "Data & models": what is running right now and
  // the trained model's own details. Measured accuracy figures live in
  // src/models/modelFacts.ts, with the report each comes from.
  app.get('/api/models', requireAuth, ah(async (_req, res) => {
    const forecastService = deps.mlStatus ? await deps.mlStatus().catch(() => 'unreachable') : 'unreachable';
    return res.json({
      forecasting: { model: 'Chronos-2', service: forecastService, minWeeks: 26, fallback: '8-week moving average' },
      categorizer: { method: 'hybrid', ...categorizerInfo() },
      anomalies: { method: 'z-score', thresholdSd: 2.5 },
      explanations: { geminiConfigured: Boolean(generate), grounded: true }
    });
  }));

  // Category suggestion for a description, from the same hybrid the server
  // uses when saving (keyword rules first, then the learned model). The
  // method is returned so the UI can say how the category was chosen.
  app.post('/api/categorize', requireAuth, (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) return bad(res, 'Text is required.');
    if (text.length > 300) return bad(res, 'Text must be at most 300 characters.');
    const g = categorize(text);
    return res.json({ category: g.category, method: g.method });
  });

  // The person's verdict on a flagged transaction; null clears it.
  app.put('/api/anomalies/:id/review', requireAuth, ah(async (req, res) => {
    const user = (req as AuthedRequest).user;
    if (!(await ownTx(user, req.params.id))) return bad(res, 'Transaction not found', 404);
    const status = req.body?.status;
    if (status !== 'expected' && status !== 'dismissed' && status !== null) {
      return bad(res, 'Status must be "expected", "dismissed" or null.');
    }
    await repo.setReview(user.id, req.params.id, status);
    return res.json({ id: req.params.id, review: status });
  }));

  app.post('/api/transactions/voice', requireAuth, ah(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const text = typeof req.query.text === 'string' ? req.query.text : req.body?.text;
    const v = parseVoiceText(text);
    if ('error' in v) return bad(res, v.error);
    const tx: StoredTransaction = { id: newTxId(), user_id: user.id, ...v.value, date: new Date(now()).toISOString() };
    await repo.insertTransaction(tx, 'user');
    return res.json({ amount: tx.amount, merchant: tx.merchant, category: tx.category, id: tx.id });
  }));

  // -------------------------------------------------------------------------
  // Gemini: chat, insights, monthly report. All grounded, all with fallbacks.
  // -------------------------------------------------------------------------

  app.post('/api/chat', requireAuth, aiQuota, noClientFigures(['prompt']), ah(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const prompt = req.body?.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) return bad(res, 'Prompt is required.');
    if (prompt.length > MAX_CHAT_PROMPT_LENGTH) return bad(res, `Prompt must be at most ${MAX_CHAT_PROMPT_LENGTH} characters.`);

    const s = summarize(user, await userTxs(user), now());
    const facts = buildSummaryFacts(s);
    const allowed = [...facts.allowed, ...extractNumbers(prompt)];
    const result = await grounded(
      { system: `${CHAT_SYSTEM}\n\n${factsBlock(facts)}`, user: prompt, temperature: 0 },
      text => {
        const c = checkGrounding(text, allowed);
        return c.ok ? { value: text } : { reason: c.reason ?? 'failed the grounding check' };
      },
      'Chat reply'
    );
    if ('value' in result) return res.json({ response: result.value, hasApiKey: true, source: 'gemini', model: result.model });
    return res.json({
      response: templateChat(s, prompt),
      hasApiKey: Boolean(generate),
      source: 'template',
      note: `${result.problem}, so this answer comes from built-in rules.`
    });
  }));

  app.post('/api/ai/insights', requireAuth, aiQuota, noClientFigures([]), ah(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const s = summarize(user, await userTxs(user), now());
    const facts = buildSummaryFacts(s);
    const result = await grounded(
      { system: INSIGHTS_SYSTEM, user: factsBlock(facts), json: true, temperature: 0 },
      text => {
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { return { reason: 'was not valid JSON' }; }
        if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(x => typeof x === 'string')) {
          return { reason: 'was not an array of strings' };
        }
        const three = (parsed as string[]).slice(0, 3);
        for (const line of three) {
          const c = checkGrounding(line, facts.allowed);
          if (!c.ok) return { reason: c.reason ?? 'failed the grounding check' };
        }
        return { value: three };
      },
      'Insights'
    );
    if ('value' in result) return res.json({ insights: result.value, has_key: true, source: 'gemini', model: result.model, reporting: s.reporting });
    return res.json({
      insights: templateInsights(s),
      has_key: Boolean(generate),
      source: 'template',
      note: `${result.problem}, so these are calculated summaries.`,
      reporting: s.reporting
    });
  }));

  app.post('/api/ai/monthly-report', requireAuth, aiQuota, noClientFigures([]), ah(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const s = summarize(user, await userTxs(user), now());
    const facts = buildSummaryFacts(s);
    const result = await grounded(
      { system: REPORT_SYSTEM, user: factsBlock(facts), temperature: 0 },
      text => {
        const c = checkGrounding(text, facts.allowed);
        return c.ok ? { value: text } : { reason: c.reason ?? 'failed the grounding check' };
      },
      'Monthly report'
    );
    if ('value' in result) return res.json({ report: result.value, has_key: true, source: 'gemini', model: result.model, reporting: s.reporting });
    return res.json({
      report: templateReport(s),
      has_key: Boolean(generate),
      source: 'template',
      note: `${result.problem}, so this is a calculated summary.`,
      reporting: s.reporting
    });
  }));

  // -------------------------------------------------------------------------
  // What-If Simulator (unchanged logic; recomputed server-side)
  // -------------------------------------------------------------------------

  const simulatorStateFor = async (user: StoredUser): Promise<FinancialState> => {
    const txs = await userTxs(user);
    const state = buildFinancialState(txs, user, new Date(now()));
    const weekly = toWeeklySeries(txs, now()).totals;
    if (weekly.length === 0) return state;
    const ml = await fetchForecast(weekly);
    if (!ml) return state;
    const total30 = (ml.forecast.reduce((a, b) => a + b, 0) * 30) / (ml.forecast.length * 7);
    return withForecastBaseline(state, total30, ml.model);
  };

  const readScenarioInput = (body: any, state: FinancialState) => {
    const changes: Record<string, number> = {};
    const raw = body && typeof body.changes === 'object' && body.changes ? body.changes : {};
    for (const c of state.categories) {
      const v = Number(raw[c.category]);
      if (Number.isFinite(v)) changes[c.category] = v;
    }
    const income = Number(body?.incomeChangePct);
    const target = Number(body?.targetSavingsPct);
    return {
      changes,
      incomeChangePct: Number.isFinite(income) ? income : 0,
      targetSavingsPct: Number.isFinite(target) ? Math.min(90, Math.max(0, target)) : state.targetSavingsPct
    };
  };

  app.get('/api/simulator/state', requireAuth, ah(async (req, res) => {
    return res.json(await simulatorStateFor((req as AuthedRequest).user));
  }));

  app.post('/api/simulator/explain', requireAuth, aiQuota, ah(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const state = await simulatorStateFor(user);
    const input = readScenarioInput(req.body, state);
    const scenario = simulateScenario(state, input);
    const plan = optimizeForGoal(state, input.targetSavingsPct);
    const facts = buildFacts(state, scenario, plan);
    const template = templateExplanation(state, scenario, plan);
    const prompt = buildPrompt(facts);

    const result = await grounded(
      { system: prompt.system, user: prompt.user, temperature: 0 },
      text => {
        const c = checkGrounding(text, facts.allowed);
        return c.ok ? { value: text } : { reason: c.reason ?? 'failed the grounding check' };
      },
      'Simulator explanation'
    );
    if ('value' in result) return res.json({ explanation: result.value, source: 'gemini', model: result.model });
    return res.json({ explanation: template, source: 'template', note: `${result.problem}, so this is the built-in explanation.` });
  }));

  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', server: 'FinAI Engine', uptime: process.uptime() }));

  // Unknown API routes get JSON, not the SPA's index.html.
  app.use('/api', (_req, res) => bad(res, 'Not found', 404));

  // Errors: a status and a generic message, never a stack trace or record.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.too.large') return bad(res, `Request body too large (limit ${JSON_BODY_LIMIT}).`, 413);
    if (err?.type === 'entity.parse.failed') return bad(res, 'Request body is not valid JSON.');
    log.error(`[FinAI] Unhandled API error: ${err instanceof Error ? err.message : 'unknown error'}`);
    return bad(res, 'Internal server error', 500);
  });

  return app;
}
