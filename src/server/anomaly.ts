// Per-category z-score anomaly check, moved unchanged from server.ts.
// A flag is an alert for review, not a claim that a transaction is wrong.

export interface AmountTx {
  id: string;
  amount: number;
  category: string;
}

export function detectAnomalies<T extends AmountTx>(txs: T[]): T[] {
  if (txs.length < 5) return [];

  const anomalies: T[] = [];
  const categories = Array.from(new Set(txs.map(t => t.category)));

  for (const cat of categories) {
    const catTxs = txs.filter(t => t.category === cat);
    if (catTxs.length < 3) {
      // If few transactions, flag if unusually large (> 25,000)
      for (const t of catTxs) {
        if (t.amount >= 25000) anomalies.push(t);
      }
      continue;
    }

    const amounts = catTxs.map(t => t.amount);
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / amounts.length;
    const std = Math.sqrt(variance);

    for (const t of catTxs) {
      if (std > 0 && Math.abs(t.amount - mean) > 2.5 * std) {
        anomalies.push(t);
      } else if (std === 0 && t.amount > mean * 2.5) {
        anomalies.push(t);
      }
    }
  }

  const seen = new Set<string>();
  return anomalies.filter(a => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}
