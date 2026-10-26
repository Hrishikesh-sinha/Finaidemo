// SQLite storage, using Node's built-in node:sqlite (Node >= 22.5): one file,
// no database server, no extra package.
//
// Tables
//   users            one row per account; username unique, case-insensitive
//   transactions     one row per transaction; amount > 0, category one of five,
//                    deleted with their user
//   anomaly_reviews  the person's verdict on a flagged transaction; deleted
//                    with the transaction or the user
//   meta             schema version
//
// Every route reads and writes through these functions, so there is no
// in-memory copy that could go stale or overwrite a change made elsewhere.

import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

// Loaded on first use rather than with a static import: as an ES module a
// static import would load node:sqlite before quietSqliteWarning runs, and
// Node would print its "experimental feature" warning.
let DatabaseSyncCtor: typeof DatabaseSyncType | null = null;
function openSqlite(file: string): DatabaseSyncType {
  DatabaseSyncCtor ??= (process as unknown as { getBuiltinModule(id: string): typeof import('node:sqlite') })
    .getBuiltinModule('node:sqlite').DatabaseSync;
  return new DatabaseSyncCtor(file);
}
import { CATEGORIES } from '../simulator/engine';
import type { StoredTransaction, StoredUser, StoreData } from './types';

export const SCHEMA_VERSION = 1;
export type TxSource = 'user' | 'synthetic' | 'kaggle';
export type Review = 'expected' | 'dismissed';

const categoryList = CATEGORIES.map(c => `'${c}'`).join(', ');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id                     TEXT PRIMARY KEY,
  username               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash          TEXT,
  monthly_income         REAL NOT NULL CHECK (monthly_income >= 0),
  target_savings_percent REAL NOT NULL CHECK (target_savings_percent BETWEEN 0 AND 90),
  role                   TEXT CHECK (role IS NULL OR role = 'admin'),
  created_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount    REAL NOT NULL CHECK (amount > 0),
  merchant  TEXT NOT NULL CHECK (length(merchant) BETWEEN 1 AND 100),
  category  TEXT NOT NULL CHECK (category IN (${categoryList})),
  date      TEXT NOT NULL,
  source    TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'synthetic', 'kaggle'))
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date DESC);

CREATE TABLE IF NOT EXISTS anomaly_reviews (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  status         TEXT NOT NULL CHECK (status IN ('expected', 'dismissed')),
  PRIMARY KEY (user_id, transaction_id)
);
`;

type Row = Record<string, unknown>;

const toUser = (r: Row | undefined): StoredUser | undefined =>
  r
    ? {
        id: String(r.id),
        username: String(r.username),
        password_hash: r.password_hash == null ? undefined : String(r.password_hash),
        monthly_income: Number(r.monthly_income),
        target_savings_percent: Number(r.target_savings_percent),
        ...(r.role === 'admin' ? { role: 'admin' as const } : {})
      }
    : undefined;

const toTx = (r: Row): StoredTransaction & { source: TxSource } => ({
  id: String(r.id),
  user_id: String(r.user_id),
  amount: Number(r.amount),
  merchant: String(r.merchant),
  category: String(r.category),
  date: String(r.date),
  source: String(r.source) as TxSource
});

export class SqliteRepo {
  readonly db: DatabaseSyncType;

  constructor(readonly file: string) {
    this.db = openSqlite(file);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
    this.db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  }

  close(): void {
    this.db.close();
  }

  // All-or-nothing: on any error nothing is written.
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---- users -------------------------------------------------------------

  userCount(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as Row).n);
  }

  findUserById(id: string): StoredUser | undefined {
    return toUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined);
  }

  findUserByUsername(username: string): StoredUser | undefined {
    return toUser(this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as Row | undefined);
  }

  createUser(u: StoredUser, createdAt: string = new Date().toISOString()): void {
    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, monthly_income, target_savings_percent, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(u.id, u.username, u.password_hash ?? null, u.monthly_income, u.target_savings_percent, u.role ?? null, createdAt);
  }

  updateProfile(id: string, fields: { monthly_income?: number; target_savings_percent?: number }): StoredUser | undefined {
    const sets: string[] = [];
    const args: (number | string)[] = [];
    if (fields.monthly_income !== undefined) { sets.push('monthly_income = ?'); args.push(fields.monthly_income); }
    if (fields.target_savings_percent !== undefined) { sets.push('target_savings_percent = ?'); args.push(fields.target_savings_percent); }
    if (sets.length) this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    return this.findUserById(id);
  }

  setPasswordHash(id: string, hash: string): void {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  }

  setRole(id: string, role: 'admin' | null): void {
    this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }

  deleteUser(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM users WHERE id = ?').run(id).changes) > 0;
  }

  // ---- transactions ------------------------------------------------------

  listTransactions(userId: string): (StoredTransaction & { source: TxSource })[] {
    return (this.db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, id').all(userId) as Row[]).map(toTx);
  }

  // Scoped to the owner: someone else's id behaves exactly like a missing one.
  getTransaction(userId: string, id: string): (StoredTransaction & { source: TxSource }) | undefined {
    const r = this.db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(id, userId) as Row | undefined;
    return r ? toTx(r) : undefined;
  }

  // Unscoped lookup, for tests and command-line scripts only.
  findTransactionById(id: string): (StoredTransaction & { source: TxSource }) | undefined {
    const r = this.db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Row | undefined;
    return r ? toTx(r) : undefined;
  }

  insertTransaction(t: StoredTransaction, source: TxSource = 'user'): void {
    this.db
      .prepare('INSERT INTO transactions (id, user_id, amount, merchant, category, date, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(t.id, t.user_id, t.amount, t.merchant, t.category, t.date, source);
  }

  insertTransactions(rows: StoredTransaction[], source: TxSource): void {
    this.transaction(() => {
      for (const t of rows) this.insertTransaction(t, source);
    });
  }

  updateTransaction(
    userId: string,
    id: string,
    fields: Partial<Pick<StoredTransaction, 'amount' | 'merchant' | 'category' | 'date'>>
  ): (StoredTransaction & { source: TxSource }) | undefined {
    const allowed = ['amount', 'merchant', 'category', 'date'] as const;
    const sets: string[] = [];
    const args: (string | number)[] = [];
    for (const k of allowed) {
      if (fields[k] !== undefined) {
        sets.push(`${k} = ?`);
        args.push(fields[k] as string | number);
      }
    }
    if (sets.length) this.db.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...args, id, userId);
    return this.getTransaction(userId, id);
  }

  // Reviews of the transaction go with it (ON DELETE CASCADE).
  deleteTransaction(userId: string, id: string): boolean {
    return Number(this.db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(id, userId).changes) > 0;
  }

  // ---- anomaly reviews ---------------------------------------------------

  getReviews(userId: string): Record<string, Review> {
    const out: Record<string, Review> = {};
    for (const r of this.db.prepare('SELECT transaction_id, status FROM anomaly_reviews WHERE user_id = ?').all(userId) as Row[]) {
      out[String(r.transaction_id)] = String(r.status) as Review;
    }
    return out;
  }

  setReview(userId: string, transactionId: string, status: Review | null): void {
    if (status === null) {
      this.db.prepare('DELETE FROM anomaly_reviews WHERE user_id = ? AND transaction_id = ?').run(userId, transactionId);
    } else {
      this.db
        .prepare(
          `INSERT INTO anomaly_reviews (user_id, transaction_id, status) VALUES (?, ?, ?)
           ON CONFLICT (user_id, transaction_id) DO UPDATE SET status = excluded.status`
        )
        .run(userId, transactionId, status);
    }
  }

  // ---- metadata ------------------------------------------------------------

  getMeta(key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
    return r ? String(r.value) : undefined;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // ---- bulk import from the old JSON store ---------------------------------

  // Passwords must already be hashed (see store.ts migratePasswords).
  importStore(data: StoreData, demoIdPrefix: string): { users: number; transactions: number; reviews: number } {
    let reviews = 0;
    this.transaction(() => {
      for (const u of data.users) {
        if (typeof u.password === 'string') throw new Error(`refusing to import plaintext password for ${u.username}`);
        this.createUser(u);
      }
      for (const t of data.transactions) this.insertTransaction(t, t.id.startsWith(demoIdPrefix) ? 'synthetic' : 'user');
      for (const u of data.users) {
        for (const [txId, status] of Object.entries(u.anomaly_reviews ?? {})) {
          this.setReview(u.id, txId, status);
          reviews++;
        }
      }
    });
    return { users: data.users.length, transactions: data.transactions.length, reviews };
  }
}
