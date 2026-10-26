// Multinomial Naive Bayes over word unigrams, word bigrams and character
// 3-grams, for short transaction descriptions ("Milk half lit", "Lunch
// catering service", "Uber ride"). Small, deterministic and explainable: the
// model is a table of counts, saved as JSON and loaded by the server.
//
// Trained by scripts/train-categorizer.ts on the Kaggle Daily Transactions
// dataset (2015-2017 only; 2018 is held out for testing).

export const NB_CATEGORIES = ['Bills', 'Food', 'Transport', 'Shopping', 'Entertainment'] as const;
export type NbCategory = (typeof NB_CATEGORIES)[number];

export interface NbModel {
  version: 1;
  alpha: number;
  classDocs: Record<string, number>;
  classTokenTotals: Record<string, number>;
  tokenCounts: Record<string, Record<string, number>>; // token -> class -> count
  vocabSize: number;
  trainedOn: string;
}

export function tokenize(text: string): string[] {
  const words = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => w.length >= 2 && !/^\d+$/.test(w));
  const out: string[] = [];
  for (const w of words) {
    out.push(`w:${w}`);
    const padded = `^${w}$`;
    for (let i = 0; i + 3 <= padded.length; i++) out.push(`c:${padded.slice(i, i + 3)}`);
  }
  for (let i = 0; i + 1 < words.length; i++) out.push(`b:${words[i]}_${words[i + 1]}`);
  return out;
}

export function trainNb(examples: { text: string; label: NbCategory }[], alpha = 1, trainedOn = ''): NbModel {
  const classDocs: Record<string, number> = Object.fromEntries(NB_CATEGORIES.map(c => [c, 0]));
  const classTokenTotals: Record<string, number> = Object.fromEntries(NB_CATEGORIES.map(c => [c, 0]));
  const tokenCounts: Record<string, Record<string, number>> = {};
  for (const ex of examples) {
    classDocs[ex.label]++;
    for (const t of tokenize(ex.text)) {
      (tokenCounts[t] ??= {})[ex.label] = (tokenCounts[t][ex.label] ?? 0) + 1;
      classTokenTotals[ex.label]++;
    }
  }
  return { version: 1, alpha, classDocs, classTokenTotals, tokenCounts, vocabSize: Object.keys(tokenCounts).length, trainedOn };
}

// Returns the most likely category and its posterior probability. Tokens the
// model has never seen are ignored; with no known token at all there is no
// evidence, and null is returned so the caller can fall back.
export function predictNb(model: NbModel, text: string): { label: NbCategory; probability: number } | null {
  const tokens = tokenize(text).filter(t => model.tokenCounts[t]);
  if (tokens.length === 0) return null;
  const totalDocs = NB_CATEGORIES.reduce((s, c) => s + model.classDocs[c], 0);
  const scores = NB_CATEGORIES.map(c => {
    let s = Math.log((model.classDocs[c] + 1) / (totalDocs + NB_CATEGORIES.length));
    const denom = model.classTokenTotals[c] + model.alpha * model.vocabSize;
    for (const t of tokens) s += Math.log(((model.tokenCounts[t][c] ?? 0) + model.alpha) / denom);
    return s;
  });
  const max = Math.max(...scores);
  const exp = scores.map(s => Math.exp(s - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  const best = scores.indexOf(max);
  return { label: NB_CATEGORIES[best], probability: exp[best] / sum };
}
