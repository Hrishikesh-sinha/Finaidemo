// Synthetic demo seed, moved unchanged from server.ts so it can be tested.
// SYNTHETIC: these are simulated transactions, never real customer data.

import type { StoredTransaction } from './types';

// Seeded transactions carry this id prefix, which is how /api/dashboard knows
// to tell the UI the data is simulated rather than real.
export const DEMO_TX_ID_PREFIX = 'tx_demo_';
// 60 weeks is deliberate: the forecasting service only uses Chronos-2 above
// 26 weeks of history, so a shorter seed would never exercise it.
export const DEMO_WEEKS = 60;
// Spikes sit at fixed weeks rather than firing on a per-week coin flip.
export const DEMO_SPIKE_WEEKS = [9, 21, 33, 45, 55];

export function generateDemoSeed(userId: string, now: Date): StoredTransaction[] {
  const seedTransactions: StoredTransaction[] = [];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEK_MS = 7 * DAY_MS;

  // mulberry32: a tiny seeded PRNG, so no dependency and no Math.random().
  let prngState = 0x9e3779b9;
  const rand = (): number => {
    prngState = (prngState + 0x6d2b79f5) >>> 0;
    let t = prngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const jitter = (spread: number): number => 1 + (rand() * 2 - 1) * spread;

  const foodMerchants = ['Local Restaurant', 'Whole Foods', 'Starbucks', 'Cafe Coffee Day', 'Swiggy Gourmet'];
  const transportMerchants = ['Uber Ride', 'MTA Subway Pass', 'Lyft Commute', 'City Metro Transit'];
  const shoppingMerchants = ['Amazon Marketplace', 'Target Store', 'Myntra', 'Decathlon'];
  const entertainmentMerchants = ['Netflix Subscription', 'PVR Cinema & IMAX', 'Spotify Premium', 'BookMyShow'];

  let demoTxSeq = 0;

  // weekIndex 0 is the oldest week, DEMO_WEEKS - 1 the current one.
  const pushDemoTx = (weekIndex: number, dayInWeek: number, amount: number, merchant: string, category: string) => {
    const ts = now.getTime() - (DEMO_WEEKS - 1 - weekIndex) * WEEK_MS - (6 - dayInWeek) * DAY_MS;
    seedTransactions.push({
      id: `${DEMO_TX_ID_PREFIX}${demoTxSeq++}`,
      user_id: userId,
      amount: Math.round(Math.max(50, amount) * 100) / 100,
      merchant,
      category,
      date: new Date(ts).toISOString()
    });
  };

  for (let w = 0; w < DEMO_WEEKS; w++) {
    const weekDate = new Date(now.getTime() - (DEMO_WEEKS - 1 - w) * WEEK_MS);
    const trend = 1 + 0.005 * w;
    const startOfYear = Date.UTC(weekDate.getUTCFullYear(), 0, 1);
    const dayOfYear = Math.floor((weekDate.getTime() - startOfYear) / DAY_MS);
    const seasonal = 1 + 0.10 * Math.sin((2 * Math.PI * dayOfYear) / 365);
    const scale = trend * seasonal;

    if (w % 4 === 0) {
      pushDemoTx(w, 1, 8000 * trend, 'Rent', 'Bills');
      pushDemoTx(w, 3, 2000 * scale * jitter(0.15), 'Electric Utility', 'Bills');
      pushDemoTx(w, 5, 1800 * trend, 'Internet Provider', 'Bills');
    }
    for (let f = 0; f < 3; f++) {
      pushDemoTx(w, 1 + f * 2, 900 * scale * jitter(0.25), foodMerchants[(w + f) % foodMerchants.length], 'Food');
    }
    for (let t = 0; t < 2; t++) {
      pushDemoTx(w, 2 + t * 3, 450 * scale * jitter(0.3), transportMerchants[(w + t) % transportMerchants.length], 'Transport');
    }
    if (w % 2 === 1) {
      pushDemoTx(w, 4, 1800 * scale * jitter(0.35), shoppingMerchants[w % shoppingMerchants.length], 'Shopping');
    }
    if (w % 3 === 2) {
      pushDemoTx(w, 6, 1200 * scale * jitter(0.3), entertainmentMerchants[w % entertainmentMerchants.length], 'Entertainment');
    }
    if (DEMO_SPIKE_WEEKS.includes(w)) {
      pushDemoTx(w, 3, 1800 * scale * (4 + rand() * 2), shoppingMerchants[(w + 2) % shoppingMerchants.length], 'Shopping');
    }
  }

  return seedTransactions;
}
