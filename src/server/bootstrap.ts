import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth';
import { SqliteRepo } from './db';
import { DEMO_TX_ID_PREFIX, generateDemoSeed } from './seed';
import { migratePasswords, readStore } from './store';
import type { StoredUser } from './types';

// First start with an empty database:
//   * if the old finai_store.json exists, import it (plaintext passwords are
//     hashed first), keep a backup of the migrated records (no plaintext),
//     and remove the original so it is never imported twice;
//   * otherwise create the demo account with 60 weeks of synthetic data. It
//     gets the password in DEMO_PASSWORD if set, else none until
//     `npm run user:set-password -- demo_user` is run.
export async function openDatabase(opts: { dbFile: string; legacyJsonFile: string; demoPassword?: string; now?: Date; log?: (m: string) => void }): Promise<SqliteRepo> {
  const { dbFile: DB_FILE, legacyJsonFile: LEGACY_JSON_FILE, demoPassword } = opts;
  const log = opts.log ?? console.log;
  const repo = new SqliteRepo(DB_FILE);
  if (repo.userCount() > 0) return repo;

  const legacy = readStore(LEGACY_JSON_FILE);
  if (legacy) {
    const { data, migrated } = await migratePasswords(legacy);
    const counts = repo.importStore(data, DEMO_TX_ID_PREFIX);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${LEGACY_JSON_FILE}.imported-${stamp}`;
    // The backup is written from the migrated records, so it never holds a
    // plaintext password; only then is the original removed.
    fs.writeFileSync(backup, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.unlinkSync(LEGACY_JSON_FILE);
    log(
      `[FinAI] Imported ${counts.users} user(s), ${counts.transactions} transactions and ${counts.reviews} review(s) from finai_store.json into ${path.basename(DB_FILE)}` +
        (migrated.length ? ` (hashed ${migrated.length} plaintext password(s))` : '') +
        `. The JSON file is kept as ${path.basename(backup)}.`
    );
    return repo;
  }

  const demoUser: StoredUser = { id: 'user_demo_1', username: 'demo_user', monthly_income: 50000.0, target_savings_percent: 20.0 };
  if (demoPassword) {
    if (demoPassword.length < 8) throw new Error('DEMO_PASSWORD must be at least 8 characters');
    demoUser.password_hash = await hashPassword(demoPassword);
  }
  repo.transaction(() => {
    repo.createUser(demoUser);
    for (const t of generateDemoSeed(demoUser.id, opts.now ?? new Date())) repo.insertTransaction(t, 'synthetic');
  });
  log(
    demoPassword
      ? `[FinAI] Created ${path.basename(DB_FILE)} with synthetic demo data; demo_user uses DEMO_PASSWORD.`
      : `[FinAI] Created ${path.basename(DB_FILE)} with synthetic demo data. demo_user has no password yet: run \`npm run user:set-password -- demo_user\`.`
  );
  return repo;
}

