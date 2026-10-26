// Turns the Kaggle "Daily Transactions Dataset" (Prasad Patil,
// kaggle.com/datasets/prasad22/daily-transactions-dataset) into FinAI
// transactions. Pure functions; the command-line wrapper is
// scripts/import-kaggle.ts.
//
// Rules (agreed 25 Oct):
//   * Only "Expense" rows are spending. Savings products (Investment, Public
//     Provident Fund, Recurring Deposit) are excluded, and so is every
//     "Transfer-Out" row (FDs, funds, shares, insurance): they are savings.
//   * Categories map onto FinAI's five (CATEGORY_MAP).
//   * Monthly income = the most recent month's salary.
//   * Dates can be shifted forward by a whole number of weeks so the latest
//     transaction falls in the current week. Order, weekdays, gaps and amounts
//     are unchanged, and the shift is recorded and shown in the app.

import type { StoredTransaction } from './types';

export const SAVINGS_CATEGORIES = new Set(['Investment', 'Public Provident Fund', 'Recurring Deposit']);

export const CATEGORY_MAP: Record<string, string> = {
  Food: 'Food',
  Transportation: 'Transport',
  ...Object.fromEntries(['Household', 'subscription', 'Rent', 'maid', 'Cook', 'Health', 'Education', 'water (jar /tanker)',
    'garbage disposal', 'Documents', 'Family', 'Money transfer'].map(c => [c, 'Bills'])),
  ...Object.fromEntries(['Apparel', 'Gift', 'Beauty', 'Grooming', 'Self-development', 'Other'].map(c => [c, 'Shopping'])),
  ...Object.fromEntries(['Tourism', 'Festivals', 'Culture', 'Social Life'].map(c => [c, 'Entertainment']))
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// RFC 4180-style CSV: quoted fields may contain commas, quotes ("") and newlines.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// "20/09/2018 12:04:08" or "1/1/2017" (day first), read as local wall time in
// UTC so the calendar day never moves.
export function parseDayFirst(s: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s.trim());
  if (!m) return NaN;
  const [, d, mo, y, h = '12', mi = '0', se = '0'] = m;
  const ts = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  const back = new Date(ts);
  return back.getUTCDate() === +d && back.getUTCMonth() === +mo - 1 ? ts : NaN;
}

export interface KaggleImport {
  transactions: StoredTransaction[];
  monthlyIncome: number;
  shiftWeeks: number;
  originalFirst: string;
  originalLast: string;
  counts: { rows: number; spending: number; savingsExcluded: number; transfersExcluded: number; incomeRows: number; skipped: number };
}

const clean = (s: string) => s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();

export function buildKaggleImport(csvText: string, userId: string, opts: { now?: number; shift?: boolean } = {}): KaggleImport {
  const rows = parseCsv(csvText.replace(/^\uFEFF/, ''));
  const header = rows[0].map(h => h.trim());
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSV has no "${name}" column; is this the Daily Transactions dataset?`);
    return i;
  };
  const [iDate, iCat, iSub, iNote, iAmt, iType, iCur] = ['Date', 'Category', 'Subcategory', 'Note', 'Amount', 'Income/Expense', 'Currency'].map(col);

  const counts = { rows: rows.length - 1, spending: 0, savingsExcluded: 0, transfersExcluded: 0, incomeRows: 0, skipped: 0 };
  const spend: { ts: number; amount: number; merchant: string; category: string }[] = [];
  const salaryByMonth = new Map<string, number>();
  let first = Infinity, last = -Infinity;

  for (const r of rows.slice(1)) {
    if (r.length < header.length) { counts.skipped++; continue; }
    if (r[iCur].trim() !== 'INR') throw new Error(`Non-INR row found (${r[iCur]}); refusing to mix currencies`);
    const ts = parseDayFirst(r[iDate]);
    const amount = Number(r[iAmt]);
    if (!Number.isFinite(ts) || !Number.isFinite(amount) || amount <= 0) { counts.skipped++; continue; }
    first = Math.min(first, ts); last = Math.max(last, ts);
    const type = r[iType].trim();
    const category = r[iCat].trim();
    if (type === 'Income') {
      counts.incomeRows++;
      if (category === 'Salary') {
        const key = new Date(ts).toISOString().slice(0, 7);
        salaryByMonth.set(key, (salaryByMonth.get(key) ?? 0) + amount);
      }
      continue;
    }
    if (type === 'Transfer-Out') { counts.transfersExcluded++; continue; }
    if (type !== 'Expense') { counts.skipped++; continue; }
    if (SAVINGS_CATEGORIES.has(category)) { counts.savingsExcluded++; continue; }
    const finai = CATEGORY_MAP[category];
    if (!finai) throw new Error(`No FinAI category for "${category}"`);
    const merchant = (clean(r[iSub] || '') || clean(r[iNote] || '') || category).slice(0, 100);
    spend.push({ ts, amount: Math.round(amount * 100) / 100, merchant, category: finai });
    counts.spending++;
  }
  if (!spend.length) throw new Error('No spending rows found');

  const now = opts.now ?? Date.now();
  const shiftWeeks = opts.shift === false ? 0 : Math.max(0, Math.floor((now - last) / WEEK_MS));
  const shiftMs = shiftWeeks * WEEK_MS;
  const latestSalaryMonth = [...salaryByMonth.keys()].sort().pop();
  const monthlyIncome = latestSalaryMonth ? Math.round(salaryByMonth.get(latestSalaryMonth)! * 100) / 100 : 0;

  const transactions = spend
    .sort((a, b) => a.ts - b.ts)
    .map((t, i) => ({
      id: `tx_kg_${String(i).padStart(5, '0')}`,
      user_id: userId,
      amount: t.amount,
      merchant: t.merchant,
      category: t.category,
      date: new Date(t.ts + shiftMs).toISOString()
    }));

  return {
    transactions,
    monthlyIncome,
    shiftWeeks,
    originalFirst: new Date(first).toISOString().slice(0, 10),
    originalLast: new Date(last).toISOString().slice(0, 10),
    counts
  };
}
