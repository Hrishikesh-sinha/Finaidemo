// FirestoreRepo against an in-memory Firestore stand-in, driven through the
// real Express app. Proves the routes work on Firestore and that a second
// server instance (a Render restart) sees everything the first one wrote.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Firestore } from 'firebase-admin/firestore';
import { createApp } from './app';
import { openStore } from './bootstrap';
import { FakeFirestore } from './fakeFirestore';
import { FirestoreRepo } from './firestoreRepo';
import { generateDemoSeed } from './seed';

const SECRET = 'integration-test-secret-longer-than-32-characters';
const NOW = new Date('2026-10-14T12:00:00Z').getTime();
const servers: { close: () => void }[] = [];
after(() => servers.forEach(s => s.close()));
const quiet = { info() {}, warn() {}, error() {} };

const repoOn = (fake: FakeFirestore) => new FirestoreRepo(fake as unknown as Firestore);

// One "server process" on the given Firestore.
async function serve(fake: FakeFirestore) {
  const repo = repoOn(fake);
  const app = createApp({ repo, authSecret: SECRET, now: () => NOW, fetchForecast: async () => null, generate: null, log: quiet });
  const server = app.listen(0);
  servers.push(server);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, url: string, o: { token?: string; body?: unknown } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}), ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const login = async (username: string, password: string) => {
    const r = await call('POST', '/api/token', { body: { username, password } });
    return r.body?.access_token as string | undefined;
  };
  return { repo, call, login };
}

test('everything done in the app is stored in Firestore and survives a restart', async () => {
  const fake = new FakeFirestore();
  const a = await serve(fake);
  assert.equal((await a.call('GET', '/api/health')).body.storage, 'firestore');

  // Accounts
  assert.equal((await a.call('POST', '/api/register', { body: { username: 'Asha', password: 'asha-password', monthly_income: 60000 } })).status, 200);
  const dup = await a.call('POST', '/api/register', { body: { username: 'asha', password: 'other-password', monthly_income: 1 } });
  assert.equal(dup.status, 400, 'usernames are unique regardless of case');
  const t = (await a.login('ASHA', 'asha-password'))!;
  assert.ok(t);
  assert.equal((await a.call('PUT', '/api/profile', { token: t, body: { monthly_income: 65000, target_savings_percent: 25 } })).status, 200);
  assert.equal((await a.call('POST', '/api/profile/password', { token: t, body: { current_password: 'asha-password', new_password: 'asha-new-password' } })).status, 200);

  // Transactions: add, voice, edit, review, delete
  const add = await a.call('POST', '/api/transactions', { token: t, body: { amount: 1200, merchant: 'Electricity bill', category: 'Bills', date: '2026-10-10' } });
  assert.equal(add.status, 200);
  const keep = add.body.id as string;
  const gone = (await a.call('POST', '/api/transactions', { token: t, body: { amount: 300, merchant: 'Movie', category: 'Entertainment', date: '2026-10-11' } })).body.id as string;
  const voice = await a.call('POST', '/api/transactions/voice', { token: t, body: { text: 'spent 250 on lunch' } });
  assert.equal(voice.status, 200);
  assert.equal((await a.call('PUT', `/api/transactions/${keep}`, { token: t, body: { amount: 1350 } })).body.transaction.amount, 1350);
  assert.equal((await a.call('PUT', `/api/anomalies/${keep}/review`, { token: t, body: { status: 'expected' } })).status, 200);
  assert.equal((await a.call('PUT', `/api/anomalies/${gone}/review`, { token: t, body: { status: 'dismissed' } })).status, 200);
  assert.equal((await a.call('DELETE', `/api/transactions/${gone}`, { token: t })).status, 200);

  // Where it landed
  const uid = (await a.repo.findUserByUsername('asha'))!.id;
  assert.deepEqual(fake.paths(`users/${uid}/anomaly_reviews/`), [`users/${uid}/anomaly_reviews/${keep}`], "a deleted transaction's review goes with it");
  assert.equal(fake.paths(`users/${uid}/transactions/`).length, 2);
  assert.ok(fake.docs.has('usernames/asha'));

  // "Restart": a brand-new server process on the same Firestore.
  const b = await serve(fake);
  assert.equal(await b.login('asha', 'asha-password'), undefined, 'old password no longer works');
  const t2 = (await b.login('asha', 'asha-new-password'))!;
  assert.ok(t2);
  const profile = (await b.call('GET', '/api/profile', { token: t2 })).body;
  assert.deepEqual([profile.monthly_income, profile.target_savings_percent], [65000, 25]);
  const list = (await b.call('GET', '/api/transactions', { token: t2 })).body as any[];
  assert.deepEqual(list.map(x => x.merchant).sort(), ['Electricity bill', voice.body.merchant].sort());
  assert.equal(list.find(x => x.id === keep).amount, 1350);
  assert.deepEqual(await b.repo.getReviews(uid), { [keep]: 'expected' });
  const dash = await b.call('GET', '/api/dashboard', { token: t2 });
  assert.equal(dash.status, 200);
  assert.ok(dash.body.total_spent > 0);
  assert.equal((await b.call('GET', '/api/simulator/state', { token: t2 })).status, 200);
});

test("one user cannot see, change or delete another user's records", async () => {
  const fake = new FakeFirestore();
  const s = await serve(fake);
  for (const u of ['alice', 'bob']) await s.call('POST', '/api/register', { body: { username: u, password: `${u}-password`, monthly_income: 50000 } });
  const ta = (await s.login('alice', 'alice-password'))!;
  const tb = (await s.login('bob', 'bob-password'))!;
  const bobTx = (await s.call('POST', '/api/transactions', { token: tb, body: { amount: 777, merchant: 'Bob Private', category: 'Food', date: '2026-10-10' } })).body.id;
  assert.equal((await s.call('PUT', `/api/transactions/${bobTx}`, { token: ta, body: { amount: 1 } })).status, 404);
  assert.equal((await s.call('DELETE', `/api/transactions/${bobTx}`, { token: ta })).status, 404);
  assert.equal((await s.call('PUT', `/api/anomalies/${bobTx}/review`, { token: ta, body: { status: 'expected' } })).status, 404);
  assert.deepEqual((await s.call('GET', '/api/transactions', { token: ta })).body, []);
  // Ids Firestore could not store are simply "not found", not a server error.
  for (const bad of ['..', '__x__', '%2Fusers']) {
    assert.equal((await s.call('DELETE', `/api/transactions/${bad}`, { token: ta })).status, 404, bad);
  }
  assert.equal((await s.repo.getTransaction((await s.repo.findUserByUsername('bob'))!.id, bobTx))!.amount, 777);
});

test('an empty Firestore gets the demo account once, and nothing is written to disk', async () => {
  const fake = new FakeFirestore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finai-fs-'));
  const dbFile = path.join(dir, 'finai_data.sqlite');
  const opts = { dbFile, legacyJsonFile: path.join(dir, 'finai_store.json'), demoPassword: 'demo-password', now: new Date(NOW), log: () => {} };
  const r1 = await openStore({ ...opts, firestore: repoOn(fake) });
  const seeded = (await r1.listTransactions('user_demo_1')).length;
  assert.equal(seeded, generateDemoSeed('user_demo_1', new Date(NOW)).length);
  const r2 = await openStore({ ...opts, firestore: repoOn(fake) });
  assert.equal((await r2.listTransactions('user_demo_1')).length, seeded, 'not seeded twice');
  assert.equal(await r2.userCount(), 1);
  assert.deepEqual(fs.readdirSync(dir), [], 'no SQLite file or anything else on disk');
});

test('a batch with one bad transaction writes nothing', async () => {
  const fake = new FakeFirestore();
  const repo = repoOn(fake);
  await repo.createUser({ id: 'u1', username: 'a', monthly_income: 1, target_savings_percent: 1 });
  await assert.rejects(repo.insertTransactions([
    { id: 'ok', user_id: 'u1', amount: 1, merchant: 'm', category: 'Food', date: '2026-01-01' },
    { id: 'bad', user_id: 'u1', amount: -1, merchant: 'm', category: 'Food', date: '2026-01-01' }
  ], 'user'));
  await assert.rejects(repo.insertTransaction({ id: 'x', user_id: 'u1', amount: 1, merchant: 'm', category: 'Groceries', date: '2026-01-01' }));
  await assert.rejects(repo.insertTransaction({ id: 'y', user_id: 'nobody', amount: 1, merchant: 'm', category: 'Food', date: '2026-01-01' }));
  assert.deepEqual(await repo.listTransactions('u1'), []);
});

test('deleting a user removes their transactions, reviews and username', async () => {
  const fake = new FakeFirestore();
  const repo = repoOn(fake);
  await repo.createUser({ id: 'u1', username: 'Kaggle_Demo', monthly_income: 1, target_savings_percent: 1 });
  await repo.insertTransaction({ id: 't1', user_id: 'u1', amount: 5, merchant: 'm', category: 'Food', date: '2026-01-01' }, 'kaggle');
  await repo.setReview('u1', 't1', 'dismissed');
  await repo.setMeta('import:u1', '{"dataset":"x"}');
  assert.equal(await repo.deleteUser('u1'), true);
  assert.deepEqual(fake.paths().filter(p => !p.startsWith('meta/')), []);
  // The name can be registered again, and import metadata is kept (as in SQLite).
  await repo.createUser({ id: 'u2', username: 'kaggle_demo', monthly_income: 1, target_savings_percent: 1 });
  assert.equal(await repo.getMeta('import:u1'), '{"dataset":"x"}');
  assert.equal(await repo.deleteUser('nobody'), false);
});

test('more rows than one Firestore batch holds are all written', async () => {
  const repo = repoOn(new FakeFirestore());
  await repo.createUser({ id: 'u1', username: 'a', monthly_income: 1, target_savings_percent: 1 });
  const rows = Array.from({ length: 1200 }, (_, i) => ({ id: `t${i}`, user_id: 'u1', amount: 1 + i, merchant: 'm', category: 'Food', date: '2026-01-01' }));
  await repo.insertTransactions(rows, 'kaggle');
  assert.equal((await repo.listTransactions('u1')).length, 1200);
  assert.equal(await repo.deleteUser('u1'), true);
});

test('transactions come back newest first, ties by id, like the SQLite query', async () => {
  const repo = repoOn(new FakeFirestore());
  await repo.createUser({ id: 'u1', username: 'a', monthly_income: 1, target_savings_percent: 1 });
  await repo.insertTransactions([
    { id: 'b', user_id: 'u1', amount: 1, merchant: 'm', category: 'Food', date: '2026-01-02' },
    { id: 'c', user_id: 'u1', amount: 1, merchant: 'm', category: 'Food', date: '2026-01-01' },
    { id: 'a', user_id: 'u1', amount: 1, merchant: 'm', category: 'Food', date: '2026-01-02' }
  ], 'user');
  assert.deepEqual((await repo.listTransactions('u1')).map(t => t.id), ['a', 'b', 'c']);
});

test('the transaction list is cached between writes, and every write refreshes it', async () => {
  const fake = new FakeFirestore();
  let clock = 0;
  const repo = new FirestoreRepo(fake as unknown as Firestore, () => clock);
  await repo.createUser({ id: 'u1', username: 'a', monthly_income: 1, target_savings_percent: 1 });
  await repo.insertTransactions(Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, user_id: 'u1', amount: 1, merchant: 'm', category: 'Food', date: '2026-01-01' })), 'user');
  await repo.listTransactions('u1');
  const reads = fake.reads;
  const again = await repo.listTransactions('u1');
  assert.equal(fake.reads, reads, 'second list served from cache');
  again[0].amount = 999; // callers cannot corrupt the cache
  assert.equal((await repo.listTransactions('u1'))[0].amount, 1);
  await repo.updateTransaction('u1', 't3', { amount: 7 });
  assert.equal((await repo.listTransactions('u1')).find(t => t.id === 't3')!.amount, 7);
  await repo.deleteTransaction('u1', 't4');
  assert.equal((await repo.listTransactions('u1')).length, 49);
  await repo.insertTransaction({ id: 'n', user_id: 'u1', amount: 2, merchant: 'm', category: 'Bills', date: '2026-02-01' });
  assert.equal((await repo.listTransactions('u1'))[0].id, 'n');
  // A write made by another process shows up once the cache expires.
  fake.docs.set('users/u1/transactions/ext', { amount: 3, merchant: 'cli', category: 'Food', date: '2026-03-01', source: 'kaggle' });
  assert.equal((await repo.listTransactions('u1'))[0].id, 'n');
  clock += 11 * 60 * 1000;
  assert.equal((await repo.listTransactions('u1'))[0].id, 'ext');
});
