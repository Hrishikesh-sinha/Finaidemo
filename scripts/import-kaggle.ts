// Import the Kaggle "Daily Transactions Dataset" as its own demo account.
//
//   npm run import:kaggle -- data/kaggle/Daily_Household_Transactions.csv
//   options: --username kaggle_demo   account name (default kaggle_demo)
//            --no-shift               keep the original 2015-2018 dates
//            --replace                delete and re-import an existing account
//
// The password is typed at a hidden prompt (or set KAGGLE_DEMO_PASSWORD).
// Safe to run while the server is up.

import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DB_FILE, promptHidden } from './cli-common';
import { hashPassword } from '../src/server/auth';
import { SqliteRepo } from '../src/server/db';
import { buildKaggleImport } from '../src/server/kaggleImport';

async function main() {
  const args = process.argv.slice(2);
  const csv = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--username');
  const username = args.includes('--username') ? args[args.indexOf('--username') + 1] : 'kaggle_demo';
  if (!csv || !username) throw new Error('Usage: npm run import:kaggle -- <csv> [--username NAME] [--no-shift] [--replace]');
  const text = fs.readFileSync(csv, 'utf-8');

  const repo = new SqliteRepo(DB_FILE);
  try {
    const existing = repo.findUserByUsername(username);
    if (existing && !args.includes('--replace')) throw new Error(`${username} already exists. Add --replace to re-import it.`);

    const password = process.env.KAGGLE_DEMO_PASSWORD
      ?? (await promptHidden(`Password for ${username} (8+ characters): `));
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');

    const userId = existing?.id ?? `user_${randomBytes(9).toString('base64url')}`;
    const imp = buildKaggleImport(text, userId, { shift: !args.includes('--no-shift') });
    const hash = await hashPassword(password);

    repo.transaction(() => {
      if (existing) repo.deleteUser(existing.id);
      repo.createUser({ id: userId, username, password_hash: hash, monthly_income: imp.monthlyIncome, target_savings_percent: 20 });
      for (const t of imp.transactions) repo.insertTransaction(t, 'kaggle');
      repo.setMeta(`import:${userId}`, JSON.stringify({
        dataset: 'Daily Transactions Dataset (Prasad Patil, Kaggle)',
        url: 'https://www.kaggle.com/datasets/prasad22/daily-transactions-dataset',
        original_first: imp.originalFirst,
        original_last: imp.originalLast,
        shift_weeks: imp.shiftWeeks,
        imported_at: new Date().toISOString(),
        counts: imp.counts
      }));
    });

    const c = imp.counts;
    console.log(`Imported ${imp.transactions.length} spending transactions into ${username}.`);
    console.log(`  excluded as savings: ${c.savingsExcluded} expense rows + ${c.transfersExcluded} transfer-out rows; income rows: ${c.incomeRows}; skipped: ${c.skipped}`);
    console.log(`  monthly income set to ₹${imp.monthlyIncome.toLocaleString('en-IN')} (latest month's salary; change it in Settings)`);
    console.log(imp.shiftWeeks
      ? `  dates shifted forward ${imp.shiftWeeks} weeks (original ${imp.originalFirst} to ${imp.originalLast}); the app labels this`
      : `  original dates kept (${imp.originalFirst} to ${imp.originalLast})`);
  } finally {
    repo.close();
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
