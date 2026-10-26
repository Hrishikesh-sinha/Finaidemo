// Weekly total spend, oldest first, as the forecasting service expects.
//
// Weeks are counted back from the latest transaction, so the newest bucket
// always holds seven full days. (They used to be counted forward from the
// earliest one, which left the newest bucket partial whenever the log did not
// end exactly on a week boundary, and a part-week looks like a sudden drop.)
// The oldest bucket may still be partial; it is kept, because a day with no
// entries cannot be told apart from a day before the log began.

const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

export interface WeeklySeries {
  totals: number[];
  // Start of each week (exclusive bound), ISO, aligned with totals.
  weekStarts: string[];
  // Latest transaction the series covers, ISO; null when empty.
  through: string | null;
}

export function toWeeklySeries(txs: { amount: number; date: string }[], now: number = Date.now()): WeeklySeries {
  const stamped = txs
    .map(t => ({ ts: new Date(t.date).getTime(), amount: Number(t.amount) }))
    .filter(t => Number.isFinite(t.ts) && Number.isFinite(t.amount) && t.ts <= now);
  if (stamped.length === 0) return { totals: [], weekStarts: [], through: null };

  const latest = Math.max(...stamped.map(t => t.ts));
  const earliest = Math.min(...stamped.map(t => t.ts));
  const weeks = Math.floor((latest - earliest) / WEEK_MS) + 1;

  const totals = new Array<number>(weeks).fill(0);
  for (const t of stamped) {
    const back = Math.floor((latest - t.ts) / WEEK_MS);
    totals[weeks - 1 - back] += t.amount;
  }

  const rounded = totals.map(v => Math.round(v * 100) / 100);

  const weekStarts = rounded.map((_, i) => new Date(latest - (weeks - i) * WEEK_MS).toISOString());
  return { totals: rounded, weekStarts, through: new Date(latest).toISOString() };
}
