// Server-side validation for anything that becomes a stored transaction or a
// user account. Every failure is a 400 with a message the UI can show.
//
// Limits introduced in Phase 2 (none existed before):
//   amount     0.01 .. 1,00,00,000 (one crore) rupees, at most 2 decimals.
//              A sanity bound against typos and garbage, not a business rule.
//   merchant   1..100 characters after trimming.
//   date       a real calendar date, 2000-01-01 or later, and not more than
//              36 hours in the future (date-only input is stored at 00:00 UTC,
//              which is up to 5.5 h ahead of the same date in IST).
//   category   one of the five categories the app uses everywhere; omitted
//              means the rule-based categorizer picks one.

import { CATEGORIES } from '../simulator/engine';
import { predictCategory } from './categorize';

export const MIN_AMOUNT = 0.01;
export const MAX_AMOUNT = 10_000_000;
export const MAX_MERCHANT_LENGTH = 100;
export const EARLIEST_DATE_MS = Date.UTC(2000, 0, 1);
export const FUTURE_TOLERANCE_MS = 36 * 60 * 60 * 1000;
export const MAX_VOICE_TEXT_LENGTH = 300;

// Check with `'error' in r` (the project's tsconfig is not strict, so a
// boolean discriminant would not narrow).
export type Result<T> = { value: T } | { error: string };
const fail = <T>(error: string): Result<T> => ({ error });
const ok = <T>(value: T): Result<T> => ({ value });

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function parseAmount(raw: unknown): Result<number> {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(raw)) {
    n = Number(raw.trim());
  } else {
    return fail('Amount must be a number.');
  }
  if (!Number.isFinite(n)) return fail('Amount must be a finite number.');
  if (n < MIN_AMOUNT) return fail('Amount must be greater than zero.');
  if (n > MAX_AMOUNT) return fail(`Amount must not exceed ${inr(MAX_AMOUNT)}.`);
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return fail('Amount can have at most 2 decimal places.');
  return ok(Math.round(n * 100) / 100);
}

export function parseMerchant(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return fail('Merchant is required.');
  // Drop control characters, collapse whitespace.
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return fail('Merchant is required.');
  if (cleaned.length > MAX_MERCHANT_LENGTH) return fail(`Merchant must be at most ${MAX_MERCHANT_LENGTH} characters.`);
  return ok(cleaned);
}

export function parseCategory(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return fail(`Category must be one of: ${CATEGORIES.join(', ')}.`);
  const match = CATEGORIES.find(c => c.toLowerCase() === raw.trim().toLowerCase());
  return match ? ok(match) : fail(`Category must be one of: ${CATEGORIES.join(', ')}.`);
}

export function parseDate(raw: unknown, now: number): Result<string> {
  if (typeof raw !== 'string') return fail('Date must be a date string such as 2026-10-23.');
  const s = raw.trim();
  let ts: number;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const [y, m, d] = [Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3])];
    ts = Date.UTC(y, m - 1, d);
    const back = new Date(ts);
    // Date.UTC rolls 2026-02-30 over to March; a real date survives the round trip.
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
      return fail(`${s} is not a real calendar date.`);
    }
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) {
    ts = Date.parse(s);
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (!Number.isFinite(ts) || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
      return fail(`${s} is not a real date and time.`);
    }
  } else {
    return fail('Date must look like 2026-10-23 (or a full ISO timestamp).');
  }

  if (ts < EARLIEST_DATE_MS) return fail('Date must be on or after 2000-01-01.');
  if (ts > now + FUTURE_TOLERANCE_MS) return fail('Date cannot be in the future.');
  return ok(new Date(ts).toISOString());
}

export interface TransactionFields {
  amount: number;
  merchant: string;
  category: string;
  date: string;
}

// For creation: amount and merchant required; category and date optional.
export function validateNewTransaction(body: unknown, now: number): Result<TransactionFields> {
  if (!body || typeof body !== 'object') return fail('Request body must be a JSON object.');
  const b = body as Record<string, unknown>;

  const amount = parseAmount(b.amount);
  if ('error' in amount) return amount;
  const merchant = parseMerchant(b.merchant);
  if ('error' in merchant) return merchant;

  let category: string;
  if (b.category === undefined || b.category === null || b.category === '') {
    category = predictCategory(merchant.value);
  } else {
    const c = parseCategory(b.category);
    if ('error' in c) return c;
    category = c.value;
  }

  let date = new Date(now).toISOString();
  if (b.date !== undefined && b.date !== null && b.date !== '') {
    const d = parseDate(b.date, now);
    if ('error' in d) return d;
    date = d.value;
  }

  return ok({ amount: amount.value, merchant: merchant.value, category, date });
}

// For editing: any subset of the fields, each validated by the same rules.
export function validateTransactionUpdate(body: unknown, now: number): Result<Partial<TransactionFields>> {
  if (!body || typeof body !== 'object') return fail('Request body must be a JSON object.');
  const b = body as Record<string, unknown>;
  const allowed = ['amount', 'merchant', 'category', 'date'];
  const unknown = Object.keys(b).filter(k => !allowed.includes(k));
  if (unknown.length) return fail(`Unknown field(s): ${unknown.join(', ')}.`);

  const out: Partial<TransactionFields> = {};
  if ('amount' in b) {
    const r = parseAmount(b.amount);
    if ('error' in r) return r;
    out.amount = r.value;
  }
  if ('merchant' in b) {
    const r = parseMerchant(b.merchant);
    if ('error' in r) return r;
    out.merchant = r.value;
  }
  if ('category' in b) {
    const r = parseCategory(b.category);
    if ('error' in r) return r;
    out.category = r.value;
  }
  if ('date' in b) {
    const r = parseDate(b.date, now);
    if ('error' in r) return r;
    out.date = r.value;
  }
  if (Object.keys(out).length === 0) return fail('Nothing to update.');
  return ok(out);
}

// Voice entry: the amount must actually be spoken. A missing amount is an
// error, never a made-up default.
export function parseVoiceText(raw: unknown): Result<{ amount: number; merchant: string; category: string }> {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fail('No speech text was received.');
  const text = raw.trim();
  if (text.length > MAX_VOICE_TEXT_LENGTH) return fail(`Speech text must be at most ${MAX_VOICE_TEXT_LENGTH} characters.`);

  // "1,200", "1,20,000", "350", "99.50"
  const m = text.match(/\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/);
  if (!m) {
    return fail('No amount was found in what you said. Try something like "Spent 350 rupees on books at Crossword".');
  }
  const amount = parseAmount(m[0].replace(/,/g, ''));
  if ('error' in amount) return amount;

  const atMatch = text.match(/\bat\s+([a-zA-Z0-9_ &'.-]+)/i);
  const forMatch = text.match(/\bfor\s+([a-zA-Z0-9_ &'.-]+)/i);
  let merchantRaw = atMatch?.[1] ?? forMatch?.[1] ?? text.slice(0, 30);
  merchantRaw = merchantRaw.trim();
  const merchant = parseMerchant(merchantRaw || 'Voice entry');
  if ('error' in merchant) return merchant;

  return ok({ amount: amount.value, merchant: merchant.value, category: predictCategory(`${merchant.value} ${text}`) });
}

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
// Deliberately loose (one @, a dot in the domain, no spaces): the address is
// stored, not verified, so a stricter pattern would only reject real ones.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalizeEmail = (e: string) => e.trim().toLowerCase();

// Monthly income is no longer asked for at sign-up; it starts at 0 and the
// person sets it on the welcome screen or in Settings. An income is never
// invented for them.
export function validateRegistration(body: unknown): Result<{ username: string; email: string; password: string; monthly_income: number }> {
  if (!body || typeof body !== 'object') return fail('Request body must be a JSON object.');
  const b = body as Record<string, unknown>;
  if (typeof b.username !== 'string' || !USERNAME_RE.test(b.username)) {
    return fail('Username must be 3–32 characters: letters, digits, dot, dash or underscore.');
  }
  const email = typeof b.email === 'string' ? normalizeEmail(b.email) : '';
  if (!email) return fail('Enter your email address.');
  if (email.length > 254 || !EMAIL_RE.test(email)) return fail('Enter a valid email address, like name@example.com.');
  if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 128) {
    return fail('Password must be 8–128 characters.');
  }
  let income = 0;
  if (b.monthly_income !== undefined) {
    const n = typeof b.monthly_income === 'number' ? b.monthly_income : NaN;
    if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return fail('Monthly income must be a number between 0 and ₹1,00,00,000.');
    income = Math.round(n * 100) / 100;
  }
  return ok({ username: b.username, email, password: b.password, monthly_income: income });
}

// Settings: monthly income and savings target, both optional, at least one.
export function validateProfileUpdate(body: unknown): Result<{ monthly_income?: number; target_savings_percent?: number }> {
  if (!body || typeof body !== 'object') return fail('Request body must be a JSON object.');
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).filter(k => k !== 'monthly_income' && k !== 'target_savings_percent');
  if (unknown.length) return fail(`Unknown field(s): ${unknown.join(', ')}.`);
  const out: { monthly_income?: number; target_savings_percent?: number } = {};
  if ('monthly_income' in b) {
    const n = b.monthly_income;
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) {
      return fail('Monthly income must be more than ₹0 and at most ₹1,00,00,000.');
    }
    out.monthly_income = Math.round(n * 100) / 100;
  }
  if ('target_savings_percent' in b) {
    const n = b.target_savings_percent;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 90) {
      return fail('Savings target must be between 0% and 90%.');
    }
    out.target_savings_percent = Math.round(n * 10) / 10;
  }
  if (Object.keys(out).length === 0) return fail('Nothing to update.');
  return ok(out);
}

export function validatePasswordChange(body: unknown): Result<{ current: string; next: string }> {
  if (!body || typeof body !== 'object') return fail('Request body must be a JSON object.');
  const b = body as Record<string, unknown>;
  if (typeof b.current_password !== 'string' || !b.current_password) return fail('Enter your current password.');
  if (typeof b.new_password !== 'string' || b.new_password.length < 8 || b.new_password.length > 128) {
    return fail('New password must be 8–128 characters.');
  }
  if (b.new_password === b.current_password) return fail('The new password must be different from the current one.');
  return ok({ current: b.current_password, next: b.new_password });
}
