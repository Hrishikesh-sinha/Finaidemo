// The storage interface every route and script uses. Two implementations:
//   FirestoreRepo (firestoreRepo.ts)  production: Firebase Firestore holds
//                                     every account, transaction, review and
//                                     import record; nothing is kept on disk.
//   sqliteAsRepo(SqliteRepo)          local development and tests, when
//                                     FIREBASE_SERVICE_ACCOUNT is not set.

import type { Review, SqliteRepo, TxSource } from './db';
import type { StoredTransaction, StoredUser } from './types';

export type { Review, TxSource };
export type Tx = StoredTransaction & { source: TxSource };
export type TxFields = Partial<Pick<StoredTransaction, 'amount' | 'merchant' | 'category' | 'date'>>;

export interface Repo {
  readonly backend: 'firestore' | 'sqlite';
  userCount(): Promise<number>;
  findUserById(id: string): Promise<StoredUser | undefined>;
  findUserByUsername(username: string): Promise<StoredUser | undefined>;
  findUserByEmail(email: string): Promise<StoredUser | undefined>;
  // Throws if the username or email (case-insensitive) or id is already taken.
  createUser(u: StoredUser, createdAt?: string): Promise<void>;
  updateProfile(id: string, fields: { monthly_income?: number; target_savings_percent?: number }): Promise<StoredUser | undefined>;
  setPasswordHash(id: string, hash: string): Promise<void>;
  setRole(id: string, role: 'admin' | null): Promise<void>;
  // Removes the user's transactions and reviews too.
  deleteUser(id: string): Promise<boolean>;
  listTransactions(userId: string): Promise<Tx[]>;
  // Scoped to the owner: someone else's id behaves exactly like a missing one.
  getTransaction(userId: string, id: string): Promise<Tx | undefined>;
  insertTransaction(t: StoredTransaction, source?: TxSource): Promise<void>;
  // All rows are checked before anything is written.
  insertTransactions(rows: StoredTransaction[], source: TxSource): Promise<void>;
  updateTransaction(userId: string, id: string, fields: TxFields): Promise<Tx | undefined>;
  // Removes the transaction's review too.
  deleteTransaction(userId: string, id: string): Promise<boolean>;
  getReviews(userId: string): Promise<Record<string, Review>>;
  setReview(userId: string, transactionId: string, status: Review | null): Promise<void>;
  getMeta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;
  close(): Promise<void>;
}

export function sqliteAsRepo(r: SqliteRepo): Repo {
  return {
    backend: 'sqlite',
    userCount: async () => r.userCount(),
    findUserById: async id => r.findUserById(id),
    findUserByUsername: async u => r.findUserByUsername(u),
    findUserByEmail: async e => r.findUserByEmail(e),
    createUser: async (u, at) => r.createUser(u, at),
    updateProfile: async (id, f) => r.updateProfile(id, f),
    setPasswordHash: async (id, h) => r.setPasswordHash(id, h),
    setRole: async (id, role) => r.setRole(id, role),
    deleteUser: async id => r.deleteUser(id),
    listTransactions: async id => r.listTransactions(id),
    getTransaction: async (u, id) => r.getTransaction(u, id),
    insertTransaction: async (t, s) => r.insertTransaction(t, s),
    insertTransactions: async (rows, s) => r.insertTransactions(rows, s),
    updateTransaction: async (u, id, f) => r.updateTransaction(u, id, f),
    deleteTransaction: async (u, id) => r.deleteTransaction(u, id),
    getReviews: async u => r.getReviews(u),
    setReview: async (u, id, s) => r.setReview(u, id, s),
    getMeta: async k => r.getMeta(k),
    setMeta: async (k, v) => r.setMeta(k, v),
    close: async () => r.close()
  };
}
