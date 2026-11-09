// Copy the accounts in a local SQLite database (e.g. the kaggle_demo account
// imported on your laptop) into Firestore. Accounts whose username already
// exists in Firestore are skipped, so running it twice is harmless.
//
//   npm run firestore:upload                      uses finai_data.sqlite
//   npm run firestore:upload -- path/to/file.sqlite
//
// Needs FIREBASE_SERVICE_ACCOUNT in .env.local (or the shell).

import fs from 'node:fs';
import path from 'node:path';
import { DB_FILE } from './cli-common';
import { SqliteRepo, type TxSource } from '../src/server/db';
import { firestoreFromEnv } from '../src/server/firestoreRepo';

async function main() {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : DB_FILE;
  if (!fs.existsSync(file)) throw new Error(`No SQLite database at ${file}.`);
  const target = await firestoreFromEnv();
  if (!target) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set (put it in .env.local).');
  const local = new SqliteRepo(file);
  try {
    const users = local.db.prepare('SELECT id, created_at FROM users ORDER BY created_at').all() as { id: string; created_at: string }[];
    let copied = 0;
    for (const { id, created_at } of users) {
      const u = local.findUserById(id)!;
      if (await target.findUserByUsername(u.username)) {
        console.log(`skip ${u.username}: already in Firestore`);
        continue;
      }
      await target.createUser(u, created_at);
      const txs = local.listTransactions(id);
      for (const source of ['user', 'synthetic', 'kaggle'] as TxSource[]) {
        const rows = txs.filter(t => t.source === source);
        if (rows.length) await target.insertTransactions(rows, source);
      }
      for (const [txId, status] of Object.entries(local.getReviews(id))) await target.setReview(id, txId, status);
      const meta = local.getMeta(`import:${id}`);
      if (meta) await target.setMeta(`import:${id}`, meta);
      console.log(`copied ${u.username}: ${txs.length} transactions`);
      copied++;
    }
    console.log(`Done: ${copied} of ${users.length} account(s) copied to Firestore.`);
  } finally {
    local.close();
    await target.close();
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
