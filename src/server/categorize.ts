// Categorization: keyword rules (moved unchanged from server.ts) plus, since
// 25 Oct, a learned Naive Bayes model for descriptions the rules do not know.

import MODEL_JSON from './categorizerModel.json';
import { predictNb, type NbModel } from './nbCategorizer';

const MODEL = MODEL_JSON as unknown as NbModel;

// The category a keyword rule assigns, or null when no rule matches.
export function ruleCategory(text: string): string | null {
  const lower = text.toLowerCase();
  if (/uber|lyft|subway|metro|transit|bus|train|cab|taxi|flight|airline|fuel|petrol|diesel|gas station|auto|parking/.test(lower)) {
    return 'Transport';
  }
  if (/starbucks|mcdonald|restaurant|cafe|coffee|grocery|whole foods|food|burger|pizza|zomato|swiggy|dining|bakery|supermarket|tea|bistro/.test(lower)) {
    return 'Food';
  }
  if (/rent|electric|utility|power|internet|wifi|broadband|water|energy|bill|insurance|telecom|phone|airtel|jio/.test(lower)) {
    return 'Bills';
  }
  if (/netflix|movie|theater|cinema|spotify|concert|gaming|steam|playstation|xbox|pub|bar|club|show|ticket/.test(lower)) {
    return 'Entertainment';
  }
  if (/amazon|target|apple|walmart|zara|myntra|flipkart|nike|clothing|shoes|clothes|mall|store|electronics|gadget|shop/.test(lower)) {
    return 'Shopping';
  }
  return null;
}

export interface CategoryGuess {
  category: string;
  // How it was decided: a keyword rule, the learned model, or the fallback.
  method: 'rule' | 'model' | 'default';
  // The model's probability for its choice (model only).
  probability?: number;
}

// Hybrid categorizer, adopted after the experiment in
// docs/CATEGORIZER_EXPERIMENT.md (2018 test: 91.0% vs 27.8% for the rules
// alone, with all of FinAI's demo merchants still correct):
//   1. keyword rules, which know brand names (Uber, Netflix, Swiggy);
//   2. otherwise the Naive Bayes model trained on 2015-2017 descriptions;
//   3. otherwise Shopping, as before.
export function categorize(text: string): CategoryGuess {
  const rule = ruleCategory(text);
  if (rule) return { category: rule, method: 'rule' };
  const model = predictNb(MODEL, text);
  if (model) return { category: model.label, method: 'model', probability: Math.round(model.probability * 1000) / 1000 };
  return { category: 'Shopping', method: 'default' };
}

// The trained model's own details, read from the model file.
export function categorizerInfo() {
  const examples = Object.values(MODEL.classDocs).reduce((a, b) => a + b, 0);
  return { trainedOn: MODEL.trainedOn, trainingExamples: examples, vocabulary: MODEL.vocabSize, smoothing: MODEL.alpha };
}

export function predictCategory(text: string): string {
  return categorize(text).category;
}

