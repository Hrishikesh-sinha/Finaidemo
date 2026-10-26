// finai_store.json: loading, atomic saving, and the one-time password
// migration from plaintext to scrypt hashes.

import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth';
import type { StoreData, StoredUser } from './types';

export function readStore(file: string): StoreData | null {
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!data || !Array.isArray(data.users) || !Array.isArray(data.transactions)) {
    throw new Error(`${path.basename(file)} is not a FinAI store (missing users or transactions)`);
  }
  return data as StoreData;
}

// Write to a temporary file and rename it over the original, so a crash
// mid-write never leaves a truncated store.
export function writeStoreAtomic(file: string, data: StoreData): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function needsPasswordMigration(data: StoreData): boolean {
  return data.users.some(u => typeof u.password === 'string');
}

// Returns a new store in which every plaintext password has been replaced by
// a scrypt hash. Accounts and transactions are otherwise untouched.
export async function migratePasswords(
  data: StoreData,
  hash: (pw: string) => Promise<string> = hashPassword
): Promise<{ data: StoreData; migrated: string[] }> {
  const migrated: string[] = [];
  const users: StoredUser[] = [];
  for (const u of data.users) {
    const { password, ...rest } = u;
    if (typeof password === 'string' && password.length > 0) {
      users.push({ ...rest, password_hash: await hash(password) });
      migrated.push(u.username);
    } else {
      users.push(rest);
    }
  }
  return { data: { ...data, users }, migrated };
}

// Migrate in place on disk. Order: hash in memory, write a backup of the
// migrated records (no plaintext in it), then atomically replace the store.
// The backup exists so the transactions are on disk twice while the store is
// being rewritten in its new format.
export async function migrateStoreFile(file: string, now: Date = new Date()): Promise<{ migrated: string[]; backup: string | null }> {
  const data = readStore(file);
  if (!data || !needsPasswordMigration(data)) return { migrated: [], backup: null };

  const { data: next, migrated } = await migratePasswords(data);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backup = file.replace(/\.json$/, '') + `.pre-auth-migration-${stamp}.json`;
  fs.writeFileSync(backup, JSON.stringify(next, null, 2), { mode: 0o600 });
  writeStoreAtomic(file, next);
  return { migrated, backup };
}
