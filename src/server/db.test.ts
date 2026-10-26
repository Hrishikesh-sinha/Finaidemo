import './quietSqliteWarning';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteRepo } from './db';
import { openDatabase } from './bootstrap';
import { verifyPassword } from './auth';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'finai-db-'));
const repoAt = (dir: string) => new SqliteRepo(path.join(dir, 'finai_data.sqlite'));
const user = (id: string, username: string) => ({ id, username, monthly_income: 50000, target_savings_percent: 20 });
const tx = (id: string, user_id: string, extra: Record<string, unknown> = {}) =>
  ({ id, user_id, amount: 100, merchant: 'Shop', category: 'Food', date: '2026-10-01T00:00:00.000Z', ...extra }) as any;

test('constraints reject bad data at the database level', () => {
  const r = repoAt(tmp());
  r.createUser(user('u1', 'Asha'));
  assert.throws(() => r.createUser(user('u2', 'asha')), /UNIQUE/, 'usernames are unique regardless of case');
  assert.throws(() => r.insertTransaction(tx('t1', 'u1', { amount: 0 })), /CHECK/);
  assert.throws(() => r.insertTransaction(tx('t2', 'u1', { amount: -5 })), /CHECK/);
  assert.throws(() => r.insertTransaction(tx('t3', 'u1', { category: 'Hacking' })), /CHECK/);
  assert.throws(() => r.insertTransaction(tx('t4', 'u1', { merchant: '' })), /CHECK/);
  assert.throws(() => r.insertTransaction(tx('t5', 'nobody')), /FOREIGN KEY/, 'a transaction must belong to a real user');
  assert.throws(() => r.createUser({ ...user('u3', 'x3'), target_savings_percent: 95 }), /CHECK/);
});

test('reviews go with their transaction, and everything goes with the user', () => {
  const r = repoAt(tmp());
  r.createUser(user('u1', 'a'));
  r.insertTransaction(tx('t1', 'u1'));
  r.insertTransaction(tx('t2', 'u1'));
  r.setReview('u1', 't1', 'expected');
  r.setReview('u1', 't2', 'dismissed');
  assert.ok(r.deleteTransaction('u1', 't1'));
  assert.deepEqual(r.getReviews('u1'), { t2: 'dismissed' });
  assert.ok(r.deleteUser('u1'));
  assert.equal(r.findTransactionById('t2'), undefined);
  assert.equal(Number((r.db.prepare('SELECT COUNT(*) n FROM anomaly_reviews').get() as any).n), 0);
});

test('owner scoping: another user cannot read, change or delete a transaction', () => {
  const r = repoAt(tmp());
  r.createUser(user('u1', 'a')); r.createUser(user('u2', 'b'));
  r.insertTransaction(tx('t1', 'u1'));
  assert.equal(r.getTransaction('u2', 't1'), undefined);
  assert.equal(r.updateTransaction('u2', 't1', { amount: 1 }), undefined);
  assert.equal(r.deleteTransaction('u2', 't1'), false);
  assert.equal(r.findTransactionById('t1')!.amount, 100);
});

test('a bulk insert with one bad row writes nothing', () => {
  const r = repoAt(tmp());
  r.createUser(user('u1', 'a'));
  assert.throws(() => r.insertTransactions([tx('t1', 'u1'), tx('t2', 'u1'), tx('t3', 'u1', { amount: -1 })], 'kaggle'));
  assert.equal(r.listTransactions('u1').length, 0);
});

test('changes are visible to a second connection immediately (no stale copy)', () => {
  const dir = tmp();
  const a = repoAt(dir), b = repoAt(dir);
  a.createUser(user('u1', 'a'));
  a.insertTransaction(tx('t1', 'u1'));
  assert.equal(b.listTransactions('u1').length, 1);
  b.updateProfile('u1', { monthly_income: 70000 });
  assert.equal(a.findUserById('u1')!.monthly_income, 70000);
});

test('first start imports the old JSON store, hashes passwords, keeps a backup, and never imports twice', async () => {
  const dir = tmp();
  const json = path.join(dir, 'finai_store.json');
  fs.writeFileSync(json, JSON.stringify({
    users: [{ id: 'user_demo_1', username: 'demo_user', password: 'old-plain-pass', monthly_income: 50000, target_savings_percent: 20,
              anomaly_reviews: { tx_demo_1: 'expected' } }],
    transactions: [
      { id: 'tx_demo_1', user_id: 'user_demo_1', amount: 500, merchant: 'Rent', category: 'Bills', date: '2026-10-01T00:00:00.000Z' },
      { id: 'tx_123_abc', user_id: 'user_demo_1', amount: 80, merchant: 'Tea', category: 'Food', date: '2026-10-02T00:00:00.000Z' }
    ]
  }));
  const logs: string[] = [];
  const db = path.join(dir, 'finai_data.sqlite');
  const r = await openDatabase({ dbFile: db, legacyJsonFile: json, log: m => logs.push(m) });
  const u = r.findUserByUsername('demo_user')!;
  assert.equal(await verifyPassword('old-plain-pass', u.password_hash!), true, 'same password still signs in');
  assert.deepEqual(r.listTransactions(u.id).map(t => [t.id, t.source]).sort(), [['tx_123_abc', 'user'], ['tx_demo_1', 'synthetic']]);
  assert.deepEqual(r.getReviews(u.id), { tx_demo_1: 'expected' });
  assert.ok(!fs.existsSync(json), 'JSON moved aside');
  const backups = fs.readdirSync(dir).filter(f => f.startsWith('finai_store.json.imported-'));
  assert.equal(backups.length, 1);
  for (const f of fs.readdirSync(dir)) {
    assert.ok(!fs.readFileSync(path.join(dir, f)).toString('latin1').includes('old-plain-pass'), `plaintext found in ${f}`);
  }
  assert.match(logs[0], /Imported 1 user\(s\), 2 transactions and 1 review\(s\).*hashed 1 plaintext password/);
  r.close();
  // Second start: data already there, nothing re-imported or re-seeded.
  const r2 = await openDatabase({ dbFile: db, legacyJsonFile: json, log: m => logs.push(m) });
  assert.equal(r2.listTransactions('user_demo_1').length, 2);
  assert.equal(logs.length, 1);
});

test('first start with no JSON creates the synthetic demo account', async () => {
  const dir = tmp();
  const r = await openDatabase({ dbFile: path.join(dir, 'd.sqlite'), legacyJsonFile: path.join(dir, 'none.json'), demoPassword: 'demo-pass-123', now: new Date('2026-10-14T10:22:15.941Z'), log: () => {} });
  const u = r.findUserByUsername('demo_user')!;
  assert.equal(await verifyPassword('demo-pass-123', u.password_hash!), true);
  const txs = r.listTransactions(u.id);
  assert.equal(txs.length, 400);
  assert.ok(txs.every(t => t.source === 'synthetic'));
});
