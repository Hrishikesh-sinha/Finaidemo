// Shapes of the records kept in finai_store.json.

export interface StoredUser {
  id: string;
  username: string;
  // scrypt hash, see auth.ts. Plaintext `password` fields only exist in stores
  // written before the Phase-2 migration and are removed by migrateStore().
  password_hash?: string;
  password?: string;
  monthly_income: number;
  target_savings_percent: number;
  // Granted only with scripts/grant-admin.ts; never from the browser.
  role?: 'admin';
  // The person's verdict on flagged transactions, keyed by transaction id.
  anomaly_reviews?: Record<string, 'expected' | 'dismissed'>;
}

export interface StoredTransaction {
  id: string;
  user_id: string;
  amount: number;
  merchant: string;
  category: string;
  date: string;
}

export interface StoreData {
  users: StoredUser[];
  transactions: StoredTransaction[];
}
