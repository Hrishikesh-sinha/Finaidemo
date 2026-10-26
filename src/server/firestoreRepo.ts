// Firebase Firestore storage: every account, transaction, anomaly review and
// import record lives in Firestore. Nothing is written to the server's disk,
// so Render's free tier wiping its disk on restart loses nothing.
//
// Layout
//   users/{userId}                          username, username_lower, password_hash,
//                                           monthly_income, target_savings_percent,
//                                           role, created_at
//   users/{userId}/transactions/{txId}      amount, merchant, category, date, source
//   users/{userId}/anomaly_reviews/{txId}   status
//   usernames/{username in lower case}      user_id   (keeps usernames unique)
//   meta/{key}                              value
//
// Transactions sit under their owner, so a lookup by another user's id finds
// nothing, the same guarantee the SQLite queries give with "AND user_id = ?".
//
// Configure with FIREBASE_SERVICE_ACCOUNT: the service-account JSON from
// Firebase console > Project settings > Service accounts > Generate new
// private key, pasted whole.

import type { Firestore } from 'firebase-admin/firestore';
import { CATEGORIES } from '../simulator/engine';
import type { Repo, Review, Tx, TxFields, TxSource } from './repo';
import type { StoredTransaction, StoredUser } from './types';

type Doc = Record<string, unknown>;
const BATCH_LIMIT = 450; // Firestore allows 500 writes per batch
const SOURCES: TxSource[] = ['user', 'synthetic', 'kaggle'];

// Firestore document ids may not contain "/", be "." or "..", or look like
// __name__. An id from a URL that breaks those rules cannot exist, so it is
// treated as missing instead of being sent to Firestore.
const validId = (id: string) =>
  typeof id === 'string' && id.length > 0 && id.length <= 700 && !id.includes('/') && id !== '.' && id !== '..' && !/^__.*__$/.test(id);
const nameKey = (username: string) => encodeURIComponent(username.toLowerCase());

// The same rules the SQLite schema enforces with CHECK constraints.
function checkTx(t: StoredTransaction, source: TxSource) {
  if (!validId(t.id) || !validId(t.user_id)) throw new Error(`invalid transaction id ${t.id}`);
  if (!(typeof t.amount === 'number' && Number.isFinite(t.amount) && t.amount > 0)) throw new Error('amount must be > 0');
  if (typeof t.merchant !== 'string' || t.merchant.length < 1 || t.merchant.length > 100) throw new Error('merchant must be 1-100 characters');
  if (!(CATEGORIES as readonly string[]).includes(t.category)) throw new Error(`unknown category ${t.category}`);
  if (typeof t.date !== 'string' || !t.date) throw new Error('date is required');
  if (!SOURCES.includes(source)) throw new Error(`unknown source ${source}`);
}
function checkUser(u: StoredUser) {
  if (!validId(u.id)) throw new Error(`invalid user id ${u.id}`);
  if (!(u.monthly_income >= 0)) throw new Error('monthly_income must be >= 0');
  if (!(u.target_savings_percent >= 0 && u.target_savings_percent <= 90)) throw new Error('target_savings_percent must be 0-90');
}

const toUser = (id: string, d: Doc): StoredUser => ({
  id,
  username: String(d.username),
  password_hash: d.password_hash == null ? undefined : String(d.password_hash),
  monthly_income: Number(d.monthly_income),
  target_savings_percent: Number(d.target_savings_percent),
  ...(d.role === 'admin' ? { role: 'admin' as const } : {})
});
const toTx = (userId: string, id: string, d: Doc): Tx => ({
  id,
  user_id: userId,
  amount: Number(d.amount),
  merchant: String(d.merchant),
  category: String(d.category),
  date: String(d.date),
  source: String(d.source) as TxSource
});
const txDoc = (t: StoredTransaction, source: TxSource): Doc => ({
  amount: t.amount, merchant: t.merchant, category: t.category, date: t.date, source
});

// Every dashboard, simulator and AI request reads the user's whole
// transaction list. Firestore's free tier allows 50,000 document reads a day,
// so the list is cached per user and dropped on every write this server makes
// to it. The TTL bounds staleness from writes made elsewhere (the CLI scripts).
const TX_CACHE_MS = 10 * 60 * 1000;

export class FirestoreRepo implements Repo {
  readonly backend = 'firestore' as const;
  private txCache = new Map<string, { at: number; txs: Tx[] }>();

  constructor(private readonly db: Firestore, private readonly clock: () => number = Date.now) {}

  private dropCache(userId: string) { this.txCache.delete(userId); }

  private users() { return this.db.collection('users'); }
  private user(id: string) { return this.users().doc(id); }
  private txs(userId: string) { return this.db.collection(`users/${userId}/transactions`); }
  private reviews(userId: string) { return this.db.collection(`users/${userId}/anomaly_reviews`); }
  private usernames() { return this.db.collection('usernames'); }

  // ---- users -------------------------------------------------------------

  async userCount(): Promise<number> {
    return (await this.users().count().get()).data().count;
  }

  async findUserById(id: string): Promise<StoredUser | undefined> {
    if (!validId(id)) return undefined;
    const snap = await this.user(id).get();
    return snap.exists ? toUser(snap.id, snap.data() as Doc) : undefined;
  }

  async findUserByUsername(username: string): Promise<StoredUser | undefined> {
    if (typeof username !== 'string' || !username) return undefined;
    const idx = await this.usernames().doc(nameKey(username)).get();
    if (!idx.exists) return undefined;
    return this.findUserById(String((idx.data() as Doc).user_id));
  }

  // One batch: `create` fails if the username or the id is taken, and then
  // nothing is written.
  async createUser(u: StoredUser, createdAt: string = new Date().toISOString()): Promise<void> {
    checkUser(u);
    const batch = this.db.batch();
    batch.create(this.usernames().doc(nameKey(u.username)), { user_id: u.id });
    batch.create(this.user(u.id), {
      username: u.username,
      username_lower: u.username.toLowerCase(),
      password_hash: u.password_hash ?? null,
      monthly_income: u.monthly_income,
      target_savings_percent: u.target_savings_percent,
      role: u.role ?? null,
      created_at: createdAt
    });
    await batch.commit();
  }

  async updateProfile(id: string, fields: { monthly_income?: number; target_savings_percent?: number }): Promise<StoredUser | undefined> {
    const current = await this.findUserById(id);
    if (!current) return undefined;
    const patch: Doc = {};
    if (fields.monthly_income !== undefined) patch.monthly_income = fields.monthly_income;
    if (fields.target_savings_percent !== undefined) patch.target_savings_percent = fields.target_savings_percent;
    if (Object.keys(patch).length === 0) return current;
    checkUser({ ...current, ...patch });
    await this.user(id).update(patch);
    return { ...current, ...patch } as StoredUser;
  }

  async setPasswordHash(id: string, hash: string): Promise<void> {
    if (await this.findUserById(id)) await this.user(id).update({ password_hash: hash });
  }

  async setRole(id: string, role: 'admin' | null): Promise<void> {
    if (await this.findUserById(id)) await this.user(id).update({ role });
  }

  async deleteUser(id: string): Promise<boolean> {
    const u = await this.findUserById(id);
    if (!u) return false;
    this.dropCache(id);
    const [txs, revs] = await Promise.all([this.txs(id).get(), this.reviews(id).get()]);
    const refs = [...revs.docs.map(d => d.ref), ...txs.docs.map(d => d.ref)];
    for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
      const batch = this.db.batch();
      for (const ref of refs.slice(i, i + BATCH_LIMIT)) batch.delete(ref);
      await batch.commit();
    }
    // The account itself goes last, so an interrupted delete can be re-run.
    const batch = this.db.batch();
    batch.delete(this.usernames().doc(nameKey(u.username)));
    batch.delete(this.user(id));
    await batch.commit();
    this.dropCache(id);
    return true;
  }

  // ---- transactions ------------------------------------------------------

  async listTransactions(userId: string): Promise<Tx[]> {
    if (!validId(userId)) return [];
    const hit = this.txCache.get(userId);
    if (hit && this.clock() - hit.at < TX_CACHE_MS) return hit.txs.map(t => ({ ...t }));
    const at = this.clock();
    const snap = await this.txs(userId).get();
    const list = snap.docs.map(d => toTx(userId, d.id, d.data() as Doc));
    // date DESC, then id, the same order as the SQLite query.
    list.sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.date < b.date ? 1 : -1));
    this.txCache.set(userId, { at, txs: list });
    return list.map(t => ({ ...t }));
  }

  async getTransaction(userId: string, id: string): Promise<Tx | undefined> {
    if (!validId(userId) || !validId(id)) return undefined;
    const snap = await this.txs(userId).doc(id).get();
    return snap.exists ? toTx(userId, id, snap.data() as Doc) : undefined;
  }

  async insertTransaction(t: StoredTransaction, source: TxSource = 'user'): Promise<void> {
    checkTx(t, source);
    if (!(await this.findUserById(t.user_id))) throw new Error(`no user ${t.user_id}`);
    this.dropCache(t.user_id);
    await this.txs(t.user_id).doc(t.id).create(txDoc(t, source));
    this.dropCache(t.user_id);
  }

  async insertTransactions(rows: StoredTransaction[], source: TxSource): Promise<void> {
    for (const t of rows) checkTx(t, source);
    const owners = [...new Set(rows.map(t => t.user_id))];
    for (const id of owners) if (!(await this.findUserById(id))) throw new Error(`no user ${id}`);
    try {
      for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
        const batch = this.db.batch();
        for (const t of rows.slice(i, i + BATCH_LIMIT)) batch.create(this.txs(t.user_id).doc(t.id), txDoc(t, source));
        await batch.commit();
      }
    } finally {
      for (const id of owners) this.dropCache(id);
    }
  }

  async updateTransaction(userId: string, id: string, fields: TxFields): Promise<Tx | undefined> {
    const current = await this.getTransaction(userId, id);
    if (!current) return undefined;
    const patch: Doc = {};
    for (const k of ['amount', 'merchant', 'category', 'date'] as const) {
      if (fields[k] !== undefined) patch[k] = fields[k];
    }
    if (Object.keys(patch).length === 0) return current;
    const next = { ...current, ...patch } as Tx;
    checkTx(next, next.source);
    this.dropCache(userId);
    await this.txs(userId).doc(id).update(patch);
    this.dropCache(userId);
    return next;
  }

  async deleteTransaction(userId: string, id: string): Promise<boolean> {
    if (!(await this.getTransaction(userId, id))) return false;
    const batch = this.db.batch();
    batch.delete(this.reviews(userId).doc(id));
    batch.delete(this.txs(userId).doc(id));
    this.dropCache(userId);
    await batch.commit();
    this.dropCache(userId);
    return true;
  }

  // ---- anomaly reviews ---------------------------------------------------

  async getReviews(userId: string): Promise<Record<string, Review>> {
    if (!validId(userId)) return {};
    const snap = await this.reviews(userId).get();
    const out: Record<string, Review> = {};
    for (const d of snap.docs) out[d.id] = String((d.data() as Doc).status) as Review;
    return out;
  }

  // Only for a transaction that exists (the SQLite foreign key's rule).
  async setReview(userId: string, transactionId: string, status: Review | null): Promise<void> {
    const ref = this.reviews(userId).doc(transactionId);
    if (status === null) {
      if (validId(userId) && validId(transactionId)) await ref.delete();
      return;
    }
    if (status !== 'expected' && status !== 'dismissed') throw new Error(`invalid review ${status}`);
    if (!(await this.getTransaction(userId, transactionId))) throw new Error(`no transaction ${transactionId}`);
    await ref.set({ status });
  }

  // ---- metadata ------------------------------------------------------------

  async getMeta(key: string): Promise<string | undefined> {
    const k = encodeURIComponent(key);
    const snap = await this.db.collection('meta').doc(k).get();
    return snap.exists ? String((snap.data() as Doc).value) : undefined;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.collection('meta').doc(encodeURIComponent(key)).set({ value });
  }

  async close(): Promise<void> {
    await this.db.terminate();
  }
}

// Reads FIREBASE_SERVICE_ACCOUNT; null when it is not set.
export async function firestoreFromEnv(log: (m: string) => void = console.log): Promise<FirestoreRepo | null> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || !raw.trim()) return null;
  let creds: { project_id?: string; client_email?: string; private_key?: string };
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON: paste the whole service-account file.');
  }
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = getApps()[0] ?? initializeApp({ credential: cert(creds as Parameters<typeof cert>[0]) });
  const db = getFirestore(app);
  // Fail at startup, with a clear message, if the project or key is wrong.
  try {
    await db.collection('meta').limit(1).get();
  } catch (err) {
    throw new Error(`Cannot reach Firestore for project ${creds.project_id ?? '?'}: ${err instanceof Error ? err.message : err}. Check that a Firestore database exists in that project.`);
  }
  log(`[FinAI] Storage: Firebase Firestore (project ${creds.project_id ?? 'unknown'}). Nothing is stored on this server's disk.`);
  return new FirestoreRepo(db);
}
