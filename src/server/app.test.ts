// Integration tests: the real Express app, an isolated store in a temp dir,
// stubbed forecast service and Gemini. Never touches finai_store.json.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp, type GenerateFn, type MlForecast } from './app';
import { hashPassword, signToken } from './auth';
import { RateLimiter } from './rateLimit';
import { generateDemoSeed } from './seed';
import { SqliteRepo } from './db';
import { sqliteAsRepo } from './repo';
import type { StoredTransaction } from './types';

const SECRET = 'integration-test-secret-longer-than-32-characters';
const NOW = new Date('2026-10-14T12:00:00Z').getTime();
const servers: { close: () => void }[] = [];
after(() => servers.forEach(s => s.close()));

interface Harness {
  base: string;
  file: string;
  repo: SqliteRepo;
  // A second, independent connection to the same file: proves a change
  // reached the database rather than sitting in some in-memory copy.
  fresh: () => SqliteRepo;
  token: (userId: string) => string;
  login: (username: string, password: string) => Promise<Response>;
  call: (method: string, url: string, opts?: { token?: string; body?: unknown; raw?: string }) => Promise<{ status: number; body: any }>;
  geminiCalls: number;
}

async function harness(opts: { generate?: GenerateFn | null; ml?: MlForecast | null; aiLimit?: number } = {}): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finai-app-'));
  const file = path.join(dir, 'finai_data.sqlite');
  const repo = new SqliteRepo(file);
  repo.createUser({ id: 'user_alice', username: 'alice', password_hash: await hashPassword('alice-password'), monthly_income: 50000, target_savings_percent: 20 });
  repo.createUser({ id: 'user_bob', username: 'bob', password_hash: await hashPassword('bob-password'), monthly_income: 40000, target_savings_percent: 20 });
  repo.insertTransactions(generateDemoSeed('user_alice', new Date(NOW)), 'synthetic');
  const bobTx: StoredTransaction = { id: 'tx_bob_1', user_id: 'user_bob', amount: 777, merchant: 'Bob Private', category: 'Food', date: '2026-10-10T00:00:00.000Z' };
  repo.insertTransaction(bobTx, 'user');
  const opened: SqliteRepo[] = [repo];
  const fresh = () => { const r = new SqliteRepo(file); opened.push(r); return r; };

  const h: Partial<Harness> = { geminiCalls: 0 };
  const generate = opts.generate === undefined ? null : opts.generate;
  const app = createApp({
    repo: sqliteAsRepo(repo),
    authSecret: SECRET,
    now: () => NOW,
    fetchForecast: async () => (opts.ml === undefined ? null : opts.ml),
    generate: generate ? async r => { h.geminiCalls!++; return generate(r); } : null,
    aiLimiter: new RateLimiter(opts.aiLimit ?? 1000, 60_000, () => NOW),
    log: { info() {}, warn() {}, error() {} }
  });
  const server = app.listen(0);
  servers.push(server);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return Object.assign(h, {
    base, file, repo, fresh,
    token: (id: string) => signToken(id, SECRET, NOW),
    login: (username: string, password: string) =>
      fetch(`${base}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password }).toString()
      }),
    call: async (method: string, url: string, o: { token?: string; body?: unknown; raw?: string } = {}) => {
      const res = await fetch(base + url, {
        method,
        headers: {
          ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
          ...(o.body !== undefined || o.raw !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined)
      });
      const text = await res.text();
      let body: any = text;
      try { body = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, body };
    }
  }) as Harness;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test('login: right password gets a signed token that works; wrong password and unknown user get the same 400', async () => {
  const h = await harness();
  const ok = await h.login('alice', 'alice-password');
  assert.equal(ok.status, 200);
  const { access_token } = await ok.json();
  assert.match(access_token, /^v1\./);
  const profile = await h.call('GET', '/api/profile', { token: access_token });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.username, 'alice');
  assert.equal(profile.body.is_admin, false);

  const wrong = await h.login('alice', 'nope');
  const unknown = await h.login('mallory', 'whatever');
  assert.equal(wrong.status, 400);
  assert.equal(unknown.status, 400);
  assert.deepEqual(await wrong.json(), await unknown.json());
});

test('forged, legacy-unsigned, tampered and expired tokens are all 401', async () => {
  const h = await harness();
  const legacy = Buffer.from(JSON.stringify({ sub: 'alice', exp: NOW + 1e9 })).toString('base64');
  const valid = h.token('user_alice');
  const [v, , sig] = valid.split('.');
  const tampered = `${v}.${Buffer.from(JSON.stringify({ sub: 'user_bob', iat: NOW, exp: NOW + 1e6 })).toString('base64url')}.${sig}`;
  const expired = signToken('user_alice', SECRET, NOW - 2 * 24 * 3600 * 1000);
  const wrongKey = signToken('user_alice', 'x'.repeat(40), NOW);
  for (const t of [legacy, tampered, expired, wrongKey, 'garbage']) {
    for (const url of ['/api/profile', '/api/transactions', '/api/dashboard']) {
      assert.equal((await h.call('GET', url, { token: t })).status, 401, `${url} accepted ${t.slice(0, 12)}…`);
    }
  }
  assert.equal((await h.call('GET', '/api/profile')).status, 401);
  assert.equal((await h.call('GET', '/api/profile', { token: valid })).status, 200);
});

test('a token for a deleted user stops working', async () => {
  const h = await harness();
  const t = h.token('user_bob');
  h.repo.deleteUser('user_bob');
  assert.equal((await h.call('GET', '/api/profile', { token: t })).status, 401);
});

test('registration stores a hash, never the password, and enforces the rules', async () => {
  const h = await harness();
  const r = await h.call('POST', '/api/register', { body: { username: 'carol', password: 'carol-secret-1', monthly_income: 45000 } });
  assert.equal(r.status, 200);
  const onDisk = [h.file, `${h.file}-wal`].filter(f => fs.existsSync(f)).map(f => fs.readFileSync(f).toString('latin1')).join('');
  assert.ok(!onDisk.includes('carol-secret-1'), 'password must never reach the database file');
  assert.ok(h.fresh().findUserByUsername('carol')!.password_hash!.startsWith('scrypt$'));
  assert.equal((await h.login('carol', 'carol-secret-1')).status, 200);
  assert.equal((await h.call('POST', '/api/register', { body: { username: 'CAROL', password: 'whatever-123' } })).status, 400);
  assert.equal((await h.call('POST', '/api/register', { body: { username: 'dave', password: 'short' } })).status, 400);
});

test('repeated failed logins are rate limited', async () => {
  const h = await harness();
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) statuses.push((await h.login('alice', `wrong-${i}`)).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400));
  assert.equal(statuses[10], 429);
});

// ---------------------------------------------------------------------------
// AI endpoints
// ---------------------------------------------------------------------------

test('insights and monthly report: 401 without a valid token', async () => {
  const h = await harness();
  const legacy = Buffer.from(JSON.stringify({ sub: 'alice', exp: NOW + 1e9 })).toString('base64');
  for (const url of ['/api/ai/insights', '/api/ai/monthly-report', '/api/chat', '/api/simulator/explain']) {
    assert.equal((await h.call('POST', url, { body: {} })).status, 401, url);
    assert.equal((await h.call('POST', url, { body: {}, token: legacy })).status, 401, url);
  }
});

test('client-supplied financial context is refused, not used', async () => {
  const h = await harness();
  const t = h.token('user_alice');
  for (const url of ['/api/ai/insights', '/api/ai/monthly-report']) {
    const r = await h.call('POST', url, { token: t, body: { context: { monthly_income: 1, total_spent: 999999 } } });
    assert.equal(r.status, 400, url);
    assert.match(r.body.detail, /computed on the server/);
  }
});

test('without Gemini, figures come from the server summary of the caller\'s own data', async () => {
  const h = await harness();
  const dash = (await h.call('GET', '/api/dashboard', { token: h.token('user_alice') })).body;
  const r = await h.call('POST', '/api/ai/monthly-report', { token: h.token('user_alice'), body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'template');
  assert.ok(r.body.report.includes(`₹${Math.round(dash.total_spent).toLocaleString('en-IN')}`));
  const bob = await h.call('POST', '/api/ai/insights', { token: h.token('user_bob'), body: {} });
  assert.ok(bob.body.insights[0].includes('₹777'), 'bob sees only his own spending');
  assert.ok(!JSON.stringify(bob.body).includes(String(Math.round(dash.total_spent))), 'nothing of alice leaks to bob');
});

test('a grounded Gemini reply is used; one with an invented number falls back to the template', async () => {
  let reply = '';
  const h = await harness({ generate: async () => reply });
  const t = h.token('user_alice');
  const dash = (await h.call('GET', '/api/dashboard', { token: t })).body;
  const spent = `₹${Math.round(dash.total_spent).toLocaleString('en-IN')}`;

  reply = `You spent ${spent} in the last 30 days.`;
  let r = await h.call('POST', '/api/ai/monthly-report', { token: t, body: {} });
  assert.equal(r.body.source, 'gemini');
  assert.equal(r.body.report, reply);

  reply = `You spent ${spent} and could save ₹12,345 more.`;
  r = await h.call('POST', '/api/ai/monthly-report', { token: t, body: {} });
  assert.equal(r.body.source, 'template');
  assert.match(r.body.note, /did not produce/);

  reply = JSON.stringify([`You spent ${spent} in the last 30 days.`, 'Food is a big share.', 'Keep it up.']);
  r = await h.call('POST', '/api/ai/insights', { token: t, body: {} });
  assert.equal(r.body.source, 'gemini');
  reply = JSON.stringify(['You will save ₹99,999 next year.', 'x', 'y']);
  r = await h.call('POST', '/api/ai/insights', { token: t, body: {} });
  assert.equal(r.body.source, 'template');
  reply = 'not json';
  r = await h.call('POST', '/api/ai/insights', { token: t, body: {} });
  assert.equal(r.body.source, 'template');
});

test('Gemini failures fall back without leaking error details', async () => {
  const h = await harness({ generate: async () => { throw new Error('API key AIzaSECRET invalid'); } });
  const r = await h.call('POST', '/api/chat', { token: h.token('user_alice'), body: { prompt: 'how much am I saving?' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'template');
  assert.ok(!JSON.stringify(r.body).includes('AIza'));
});

test('chat: may repeat numbers from the question, not invent new ones', async () => {
  let reply = '';
  const h = await harness({ generate: async () => reply });
  const t = h.token('user_alice');
  reply = 'If you cut ₹2,000 from Shopping, that is a start.';
  assert.equal((await h.call('POST', '/api/chat', { token: t, body: { prompt: 'What if I cut 2000 from shopping?' } })).body.source, 'gemini');
  reply = 'You would save ₹31,415 a year.';
  assert.equal((await h.call('POST', '/api/chat', { token: t, body: { prompt: 'What if I cut 2000 from shopping?' } })).body.source, 'template');
  assert.equal((await h.call('POST', '/api/chat', { token: t, body: { prompt: 'x'.repeat(501) } })).status, 400);
});

test('AI requests are rate limited per user', async () => {
  const h = await harness({ aiLimit: 2 });
  const t = h.token('user_alice');
  const s = [];
  for (let i = 0; i < 3; i++) s.push((await h.call('POST', '/api/ai/insights', { token: t, body: {} })).status);
  assert.deepEqual(s, [200, 200, 429]);
  assert.equal((await h.call('POST', '/api/ai/insights', { token: h.token('user_bob'), body: {} })).status, 200, 'limit is per user');
});

test('oversized and malformed JSON bodies get 413/400, not a stack trace', async () => {
  const h = await harness();
  const t = h.token('user_alice');
  const big = await h.call('POST', '/api/transactions', { token: t, raw: JSON.stringify({ merchant: 'x'.repeat(40_000), amount: 1 }) });
  assert.equal(big.status, 413);
  const broken = await h.call('POST', '/api/transactions', { token: t, raw: '{"amount": 1,' });
  assert.equal(broken.status, 400);
  assert.ok(!JSON.stringify(broken.body).includes('at '), 'no stack trace');
});

// ---------------------------------------------------------------------------
// Transactions: validation, edit, delete, cross-user access
// ---------------------------------------------------------------------------

test('the Phase-1 bad inputs now get 400 instead of 500 or a silent save', async () => {
  const h = await harness();
  const t = h.token('user_alice');
  const count = () => Number((h.fresh().db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as any).n);
  const before = count();
  const cases = [
    { amount: 100, merchant: 'x', date: 'not-a-date' },
    { amount: 1e15, merchant: 'x', category: 'Hacking' },
    { amount: 10, merchant: 'x', category: 'Hacking' },
    { amount: -5, merchant: 'x' },
    { amount: 'abc', merchant: 'x' },
    { amount: 10, merchant: '' },
    { amount: 10, merchant: 'x', date: '2026-02-30' }
  ];
  for (const body of cases) {
    const r = await h.call('POST', '/api/transactions', { token: t, body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(typeof r.body.detail, 'string');
  }
  const voice = await h.call('POST', `/api/transactions/voice?text=${encodeURIComponent('bought lunch')}`, { token: t });
  assert.equal(voice.status, 400);
  assert.match(voice.body.detail, /No amount/);
  assert.equal(count(), before, 'nothing was saved');
});

test('valid create and voice entry are saved to disk', async () => {
  const h = await harness();
  const t = h.token('user_alice');
  const r = await h.call('POST', '/api/transactions', { token: t, body: { amount: 450, merchant: 'Uber Ride', date: '2026-10-13' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.category, 'Transport');
  const v = await h.call('POST', `/api/transactions/voice?text=${encodeURIComponent('Spent 350 rupees on books at Crossword')}`, { token: t });
  assert.equal(v.status, 200);
  assert.equal(v.body.amount, 350);
  const disk = h.fresh();
  const created = disk.findTransactionById(r.body.id)!;
  assert.ok(created.user_id === 'user_alice' && created.amount === 450 && created.source === 'user');
  assert.equal(disk.findTransactionById(v.body.id)!.merchant, 'Crossword');
});

test('edit: validated, persisted, and only the owner can do it', async () => {
  const h = await harness();
  const alice = h.token('user_alice');
  const bob = h.token('user_bob');
  const id = 'tx_demo_5';

  const ok = await h.call('PUT', `/api/transactions/${id}`, { token: alice, body: { amount: 123.45, category: 'Entertainment' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.transaction.amount, 123.45);
  const disk = h.fresh().findTransactionById(id)!;
  assert.equal(disk.amount, 123.45);
  assert.equal(disk.category, 'Entertainment');
  assert.equal(disk.user_id, 'user_alice');

  assert.equal((await h.call('PUT', `/api/transactions/${id}`, { token: alice, body: { amount: -1 } })).status, 400);
  assert.equal((await h.call('PUT', `/api/transactions/${id}`, { token: alice, body: { user_id: 'user_bob' } })).status, 400);
  assert.equal((await h.call('PUT', `/api/transactions/${id}`, { token: alice, body: {} })).status, 400);

  // Bob cannot edit Alice's transaction, and gets the same 404 as for a missing id.
  const cross = await h.call('PUT', `/api/transactions/${id}`, { token: bob, body: { amount: 1 } });
  const missing = await h.call('PUT', '/api/transactions/does_not_exist', { token: bob, body: { amount: 1 } });
  assert.equal(cross.status, 404);
  assert.deepEqual(cross.body, missing.body);
  assert.equal(h.fresh().findTransactionById(id)!.amount, 123.45);
  assert.equal((await h.call('PUT', `/api/transactions/${id}`, { body: { amount: 1 } })).status, 401);
});

test('delete: only the owner, persisted, and a second delete is 404', async () => {
  const h = await harness();
  const alice = h.token('user_alice');
  const bob = h.token('user_bob');

  assert.equal((await h.call('DELETE', '/api/transactions/tx_bob_1', { token: alice })).status, 404);
  assert.ok(h.fresh().findTransactionById('tx_bob_1'), "alice could not delete bob's");
  assert.equal((await h.call('DELETE', '/api/transactions/tx_bob_1')).status, 401);

  const del = await h.call('DELETE', '/api/transactions/tx_bob_1', { token: bob });
  assert.equal(del.status, 200);
  assert.equal(h.fresh().findTransactionById('tx_bob_1'), undefined);
  assert.equal((await h.call('DELETE', '/api/transactions/tx_bob_1', { token: bob })).status, 404);
});

test('each user lists and summarises only their own transactions', async () => {
  const h = await harness();
  const bobList = (await h.call('GET', '/api/transactions', { token: h.token('user_bob') })).body;
  assert.deepEqual(bobList.map((x: any) => x.id), ['tx_bob_1']);
  const aliceList = (await h.call('GET', '/api/transactions', { token: h.token('user_alice') })).body;
  assert.ok(!aliceList.some((x: any) => x.id === 'tx_bob_1'));
  const bobDash = (await h.call('GET', '/api/dashboard', { token: h.token('user_bob') })).body;
  assert.equal(bobDash.total_spent, 777);
  assert.equal(bobDash.synthetic_demo_data, false);
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

test('dashboard reports its window and the forecast period separately', async () => {
  const h = await harness({ ml: { forecast: [9000, 9100, 9200, 9300], lower: [8000, 8000, 8000, 8000], upper: [10000, 10000, 10000, 10000], model: 'chronos-2', weeks_of_history: 60, reason: null } });
  const d = (await h.call('GET', '/api/dashboard', { token: h.token('user_alice') })).body;
  assert.equal(d.reporting.window_days, 30);
  assert.equal(d.reporting.complete, true);
  assert.equal(d.forecast_model, 'chronos-2');
  assert.equal(d.forecast_next_30_days, Math.round((9000 + 9100 + 9200 + 9300) * 30 / 28));
  assert.equal(d.forecast_starts_after, d.reporting.data_through);
  assert.equal(d.forecast_weekly.history.length, 26);
  assert.equal(d.synthetic_demo_data, true);
});

test('forecast service down: labelled heuristic, nothing claims a model ran', async () => {
  const h = await harness({ ml: null });
  const d = (await h.call('GET', '/api/dashboard', { token: h.token('user_alice') })).body;
  assert.equal(d.forecast_model, 'heuristic');
  assert.equal(d.forecast_weekly.forecast, null);
  assert.match(d.forecast_reason, /unreachable/);
});

test('forecast fallback on a stale log projects from the 30 days before the latest entry, not from empty days', async () => {
  const h = await harness({ ml: null });
  const t = h.token('user_alice');
  const fresh = (await h.call('GET', '/api/dashboard', { token: t })).body;
  // Same data viewed 14 days later: the rolling window shrinks, the forecast basis must not.
  const later = createApp({
    repo: sqliteAsRepo(h.repo), authSecret: SECRET, now: () => NOW + 14 * 86400000,
    fetchForecast: async () => null, generate: null, log: { info() {}, warn() {}, error() {} }
  }).listen(0);
  servers.push(later);
  await new Promise(r => later.once('listening', r));
  const res = await fetch(`http://127.0.0.1:${(later.address() as AddressInfo).port}/api/dashboard`, {
    headers: { Authorization: `Bearer ${signToken('user_alice', SECRET, NOW + 14 * 86400000)}` }
  });
  const stale = await res.json();
  assert.equal(stale.reporting.complete, false);
  assert.ok(stale.total_spent < fresh.total_spent * 0.7, 'window total really is understated');
  assert.equal(stale.forecast_next_30_days, fresh.forecast_next_30_days);
});

test('a brand-new account gets no invented forecast', async () => {
  const h = await harness({ ml: { forecast: [1, 2, 3, 4], model: 'chronos-2' } });
  const r = await h.call('POST', '/api/register', { body: { username: 'newbie', password: 'newbie-pass-1', monthly_income: 50000 } });
  assert.equal(r.status, 200);
  const login = await (await h.login('newbie', 'newbie-pass-1')).json();
  const d = (await h.call('GET', '/api/dashboard', { token: login.access_token })).body;
  assert.equal(d.total_spent, 0);
  assert.equal(d.forecast_model, 'none');
  assert.equal(d.forecast_next_30_days, 0);
  assert.equal(d.forecast_weekly.forecast, null);
  assert.equal(d.reporting.data_through, null);
  assert.deepEqual((await h.call('GET', '/api/transactions', { token: login.access_token })).body, []);
});

test('settings: income and savings target are validated, saved and used by the dashboard', async () => {
  const h = await harness();
  const t = h.token('user_alice');
  const r = await h.call('PUT', '/api/profile', { token: t, body: { monthly_income: 64000, target_savings_percent: 25 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.monthly_income, 64000);
  const disk = h.fresh().findUserById('user_alice')!;
  assert.equal(disk.monthly_income, 64000);
  assert.equal(disk.target_savings_percent, 25);
  assert.equal((await h.call('GET', '/api/dashboard', { token: t })).body.monthly_income, 64000);
  for (const body of [{ monthly_income: 0 }, { monthly_income: -5 }, { monthly_income: '5000' }, { target_savings_percent: 95 }, { role: 'admin' }, {}]) {
    assert.equal((await h.call('PUT', '/api/profile', { token: t, body })).status, 400, JSON.stringify(body));
  }
  assert.equal(h.fresh().findUserById('user_alice')!.role, undefined, 'cannot make yourself admin');
  assert.equal((await h.call('PUT', '/api/profile', { body: { monthly_income: 1 } })).status, 401);
});

test('password change needs the current password and then works for sign-in', async () => {
  const h = await harness();
  const t = h.token('user_alice');
  assert.equal((await h.call('POST', '/api/profile/password', { token: t, body: { current_password: 'wrong', new_password: 'brand-new-pass' } })).status, 400);
  assert.equal((await h.call('POST', '/api/profile/password', { token: t, body: { current_password: 'alice-password', new_password: 'short' } })).status, 400);
  assert.equal((await h.call('POST', '/api/profile/password', { token: t, body: { current_password: 'alice-password', new_password: 'brand-new-pass' } })).status, 200);
  assert.equal((await h.login('alice', 'alice-password')).status, 400);
  assert.equal((await h.login('alice', 'brand-new-pass')).status, 200);
  assert.ok(![h.file, `${h.file}-wal`].filter(f => fs.existsSync(f)).some(f => fs.readFileSync(f).toString('latin1').includes('brand-new-pass')));
});

test('anomaly reviews persist, are per user, and only for your own transactions', async () => {
  const h = await harness();
  const alice = h.token('user_alice');
  const dash = (await h.call('GET', '/api/dashboard', { token: alice })).body;
  assert.ok(dash.anomalies.length > 0, 'seed has flagged spikes');
  const id = dash.anomalies[0].id;
  assert.equal(dash.anomalies[0].review, null);
  assert.equal((await h.call('PUT', `/api/anomalies/${id}/review`, { token: alice, body: { status: 'expected' } })).status, 200);
  const again = (await h.call('GET', '/api/dashboard', { token: alice })).body;
  assert.equal(again.anomalies.find((a: any) => a.id === id).review, 'expected');
  assert.equal(h.fresh().getReviews('user_alice')[id], 'expected');
  assert.equal((await h.call('PUT', `/api/anomalies/${id}/review`, { token: alice, body: { status: 'fraud' } })).status, 400);
  assert.equal((await h.call('PUT', `/api/anomalies/${id}/review`, { token: h.token('user_bob'), body: { status: 'dismissed' } })).status, 404);
  assert.equal((await h.call('PUT', `/api/anomalies/${id}/review`, { token: alice, body: { status: null } })).status, 200);
  assert.equal((await h.call('GET', '/api/dashboard', { token: alice })).body.anomalies.find((a: any) => a.id === id).review, null);
});

test('category suggestions: same hybrid as saving, auth required, input checked', async () => {
  const h = await harness();
  const t = h.token('user_alice');
  assert.deepEqual((await h.call('POST', '/api/categorize', { token: t, body: { text: 'Milk half litre' } })).body, { category: 'Food', method: 'model' });
  assert.deepEqual((await h.call('POST', '/api/categorize', { token: t, body: { text: 'Uber Ride' } })).body, { category: 'Transport', method: 'rule' });
  assert.equal((await h.call('POST', '/api/categorize', { body: { text: 'Milk' } })).status, 401);
  assert.equal((await h.call('POST', '/api/categorize', { token: t, body: { text: '' } })).status, 400);
  assert.equal((await h.call('POST', '/api/categorize', { token: t, body: { text: 'x'.repeat(301) } })).status, 400);
  // Saving without a category uses the same decision.
  const saved = await h.call('POST', '/api/transactions', { token: t, body: { amount: 30, merchant: 'Milk half litre' } });
  assert.equal(saved.body.category, 'Food');
});

test('models endpoint reports live state and the real model details', async () => {
  const h = await harness();
  const t = h.token('user_alice');
  assert.equal((await h.call('GET', '/api/models')).status, 401);
  const m = (await h.call('GET', '/api/models', { token: t })).body;
  assert.equal(m.forecasting.service, 'unreachable', 'no service in tests');
  assert.equal(m.explanations.geminiConfigured, false);
  // Must match the model file actually shipped (fit + validation rows).
  assert.equal(m.categorizer.trainingExamples, 1425);
  assert.match(m.categorizer.trainedOn, /Kaggle Daily Transactions, 2015-01-01 to 2017-12-31/);
  assert.ok(m.categorizer.vocabulary > 1000);
});

test('unknown API routes return JSON 404', async () => {
  const h = await harness();
  const r = await h.call('GET', '/api/nope', { token: h.token('user_alice') });
  assert.equal(r.status, 404);
  assert.equal(r.body.detail, 'Not found');
});
