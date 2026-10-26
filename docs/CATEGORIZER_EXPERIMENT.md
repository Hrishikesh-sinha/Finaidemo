# Categorizer experiment: Kaggle Daily Transactions

Dataset: Daily Transactions Dataset (Prasad Patil, Kaggle), one individual, INR, described by its author as dummy data. Spending rows only (savings products excluded), text = subcategory + note, label = the dataset's category mapped onto FinAI's five.

Split by time: fit 988 rows (2015-01 to 2017-06), validation 437 (2017-07 to 2017-12), test 564 (2018-01 to 2018-09).
Test class counts: Bills 171, Food 276, Transport 73, Shopping 35, Entertainment 9. Always guessing the most common class scores 48.9%.

Settings chosen on validation only, among candidates that keep all 20 of FinAI's demo merchants correct (a requirement fixed before any test data was seen): **Hybrid, rules first (alpha 1)** (validation accuracy 87.9%; rules 32.5%). 20 candidates were compared; 4 met the requirement.

## Test period (2018), scored once

| Method | Accuracy | Macro F1 |
|---|---|---|
| Keyword rules (current) | 27.8% | 0.344 |
| Naive Bayes alone (alpha 1), for reference: fails FinAI merchants | 92.4% | 0.838 |
| Chosen: Hybrid, rules first (alpha 1) | 91.0% | 0.783 |

Chosen minus rules, paired bootstrap over 564 test rows: +63.1 points, 95% CI [59.0, 67.2].

FinAI's own demo merchants kept correct: chosen 20/20, rules 20/20.

**Decision: adopted.** The model is saved to src/server/categorizerModel.json and used by the server.

### Confusion on the test period, chosen method

| true \ predicted | Bills | Food | Transport | Shopping | Entertainment |
|---|---|---|---|---|---|
| Bills | 142 | 11 | 0 | 14 | 4 |
| Food | 0 | 266 | 1 | 1 | 8 |
| Transport | 1 | 0 | 69 | 3 | 0 |
| Shopping | 4 | 0 | 0 | 31 | 0 |
| Entertainment | 1 | 0 | 1 | 2 | 5 |

### Confusion on the test period, rules

| true \ predicted | Bills | Food | Transport | Shopping | Entertainment |
|---|---|---|---|---|---|
| Bills | 8 | 4 | 0 | 155 | 4 |
| Food | 0 | 44 | 0 | 224 | 8 |
| Transport | 0 | 0 | 67 | 6 | 0 |
| Shopping | 0 | 0 | 0 | 35 | 0 |
| Entertainment | 0 | 0 | 0 | 6 | 3 |

### Validation ranking (all candidates)

| Candidate | Validation accuracy | Validation macro F1 | FinAI merchants correct |
|---|---|---|---|
| Naive Bayes (alpha 1) | 88.8% | 0.825 | 7/20 |
| Hybrid, model first at p>=0.6 (alpha 1) | 88.8% | 0.825 | 7/20 |
| Hybrid, model first at p>=0.8 (alpha 1) | 88.8% | 0.825 | 10/20 |
| Hybrid, model first at p>=0.9 (alpha 1) | 88.8% | 0.821 | 14/20 |
| Hybrid, model first at p>=0.6 (alpha 0.3) | 88.3% | 0.818 | 8/20 |
| Naive Bayes (alpha 0.5) | 88.3% | 0.818 | 8/20 |
| Hybrid, model first at p>=0.6 (alpha 0.5) | 88.3% | 0.818 | 8/20 |
| Hybrid, model first at p>=0.8 (alpha 0.5) | 88.3% | 0.818 | 8/20 |
| Hybrid, model first at p>=0.8 (alpha 0.3) | 88.1% | 0.816 | 10/20 |
| Hybrid, model first at p>=0.9 (alpha 0.3) | 88.1% | 0.816 | 13/20 |
| Hybrid, model first at p>=0.9 (alpha 0.5) | 88.1% | 0.816 | 13/20 |
| Naive Bayes (alpha 0.3) | 88.1% | 0.815 | 8/20 |
| Naive Bayes (alpha 0.1) | 87.9% | 0.828 | 8/20 |
| Hybrid, model first at p>=0.6 (alpha 0.1) | 87.9% | 0.828 | 9/20 |
| Hybrid, model first at p>=0.8 (alpha 0.1) | 87.9% | 0.828 | 12/20 |
| Hybrid, model first at p>=0.9 (alpha 0.1) | 87.9% | 0.828 | 12/20 |
| Hybrid, rules first (alpha 1) | 87.9% | 0.815 | 20/20 |
| Hybrid, rules first (alpha 0.3) | 87.4% | 0.809 | 20/20 |
| Hybrid, rules first (alpha 0.5) | 87.4% | 0.809 | 20/20 |
| Hybrid, rules first (alpha 0.1) | 87.0% | 0.800 | 20/20 |

Caveats: one individual's descriptions; the category mapping onto FinAI's five is a judgement call; short notes repeat often (e.g. "Milk"), so results describe this person's vocabulary, not Indian spending in general.
