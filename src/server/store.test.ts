import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateStoreFile, migratePasswords, needsPasswordMigration, readStore } from './store';
import { verifyPassword } from './auth';
import type { StoreData } from './types';

const legacy = (): StoreData => ({
  users: [
    { id: 'u1', username: 'demo_user', password: 'password123', monthly_income: 50000, target_savings_percent: 20 },
    { id: 'u2', username: 'second', password: 'another-pass', monthly_income: 30000, target_savings_percent: 15 }
  ],
  transactions: [
    { id: 't1', user_id: 'u1', amount: 100, merchant: 'A', category: 'Food', date: '2026-10-01T00:00:00.000Z' },
    { id: 't2', user_id: 'u2', amount: 200, merchant: 'B', category: 'Bills', date: '2026-10-02T00:00:00.000Z' }
  ]
});

function tmpStore(data: StoreData) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finai-store-'));
  const file = path.join(dir, 'finai_store.json');
  fs.writeFileSync(file, JSON.stringify(data));
  return { dir, file };
}

test('migration hashes every plaintext password and keeps accounts and transactions', async () => {
  const { data, migrated } = await migratePasswords(legacy());
  assert.deepEqual(migrated, ['demo_user', 'second']);
  assert.ok(data.users.every(u => !('password' in u) && typeof u.password_hash === 'string'));
  assert.equal(await verifyPassword('password123', data.users[0].password_hash!), true);
  assert.equal(await verifyPassword('another-pass', data.users[1].password_hash!), true);
  assert.deepEqual(data.transactions, legacy().transactions);
  assert.deepEqual(data.users.map(u => [u.id, u.username, u.monthly_income]), [['u1', 'demo_user', 50000], ['u2', 'second', 30000]]);
});

test('on disk: no plaintext left in the store or in the backup it writes', async () => {
  const { dir, file } = tmpStore(legacy());
  const { migrated, backup } = await migrateStoreFile(file, new Date('2026-10-23T12:00:00Z'));
  assert.equal(migrated.length, 2);
  assert.ok(backup && fs.existsSync(backup));
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf-8');
    assert.ok(!text.includes('password123') && !text.includes('another-pass'), `plaintext found in ${f}`);
    assert.ok(!/"password"\s*:/.test(text), `password field left in ${f}`);
  }
  assert.equal(readStore(file)!.transactions.length, 2);
  assert.ok(!fs.readdirSync(dir).some(f => f.endsWith('.tmp')), 'no temp file left behind');
});

test('migration runs once: a migrated store is left alone and no new backup is made', async () => {
  const { dir, file } = tmpStore(legacy());
  await migrateStoreFile(file);
  const before = fs.readFileSync(file, 'utf-8');
  const second = await migrateStoreFile(file);
  assert.deepEqual(second, { migrated: [], backup: null });
  assert.equal(fs.readFileSync(file, 'utf-8'), before);
  assert.equal(fs.readdirSync(dir).filter(f => f.includes('pre-auth-migration')).length, 1);
  assert.equal(needsPasswordMigration(readStore(file)!), false);
});
