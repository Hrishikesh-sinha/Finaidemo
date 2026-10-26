import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { CATEGORIZER_RESULT, FORECAST_RESULTS, KAGGLE_DATASET } from '../models/modelFacts';

interface ModelsInfo {
  forecasting: { model: string; service: 'ready' | 'loading' | 'failed' | 'unreachable'; minWeeks: number; fallback: string };
  categorizer: { method: string; trainedOn: string; trainingExamples: number; vocabulary: number };
  anomalies: { method: string; thresholdSd: number };
  explanations: { geminiConfigured: boolean; grounded: boolean };
}

// What FinAI's models are, whether they are running right now, and the
// evidence for each. Live facts come from /api/models; measured results come
// from src/models/modelFacts.ts, which names the report behind each figure.
export function DataModelsSection({ token }: { token: string }) {
  const [info, setInfo] = useState<ModelsInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/models', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (!cancelled) setInfo(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [token]);

  const forecastStatus = !info
    ? null
    : info.forecasting.service === 'ready'
      ? { tone: 'pos', text: 'Running' }
      : info.forecasting.service === 'loading'
        ? { tone: 'caution', text: 'Loading the model' }
        : { tone: 'caution', text: `Not running; using the ${info.forecasting.fallback}` };

  return (
    <section id="data-models" aria-labelledby="data-models-title" className="rounded-lg border border-line bg-surface p-6">
      <h2 id="data-models-title" className="text-xl font-semibold text-ink">Data and models</h2>
      <p className="mt-1 text-sm text-ink-2 max-w-[70ch]">
        What powers FinAI, whether it is running right now, and how each part was tested. Accuracy figures come from the
        project's experiments, on the data named beside them.
      </p>
      {failed && <p role="alert" className="mt-4 text-sm text-neg">Could not load the live status. The measured results below still apply.</p>}

      <div className="mt-6 divide-y divide-line">
        <Row
          title="Spending forecast"
          model="Chronos-2 (Amazon), a pretrained time-series model"
          status={forecastStatus}
          what={`Forecasts the next four weeks once you have ${info?.forecasting.minWeeks ?? 26} weeks of history; before that, an 8-week average.`}
        >
          <Metric
            label={FORECAST_RESULTS.synthetic.label}
            value={`${FORECAST_RESULTS.synthetic.chronos.toFixed(3)} vs ${FORECAST_RESULTS.synthetic.baseline.toFixed(3)}`}
            note={`forecast error (MASE, lower is better), Chronos-2 vs ${FORECAST_RESULTS.synthetic.baselineName}`}
          />
          <Metric
            label={FORECAST_RESULTS.kaggle.label}
            value={`${FORECAST_RESULTS.kaggle.chronos.toFixed(3)} vs ${FORECAST_RESULTS.kaggle.baseline.toFixed(3)}`}
            note={`difference ${FORECAST_RESULTS.kaggle.ci[0]} to ${FORECAST_RESULTS.kaggle.ci[1]} (95% interval); a case study of one person`}
          />
        </Row>

        <Row
          title="Category suggestions"
          model="Keyword rules, then a Naive Bayes text model"
          status={info ? { tone: 'pos', text: 'Running' } : null}
          what="Suggests a category from the merchant or description. Known brands go through keyword rules; everything else goes through the learned model. You can always change the suggestion."
        >
          <Metric
            label={`Tested on ${CATEGORIZER_RESULT.testRows} unseen transactions (${CATEGORIZER_RESULT.testPeriod})`}
            value={`${CATEGORIZER_RESULT.hybridAccuracy.toFixed(1)}% vs ${CATEGORIZER_RESULT.rulesAccuracy.toFixed(1)}%`}
            note={`accuracy, hybrid vs keyword rules alone; FinAI's own demo merchants kept correct: ${CATEGORIZER_RESULT.merchantsKept}`}
          />
          <Metric
            label="Trained on"
            value={info ? `${info.categorizer.trainingExamples.toLocaleString('en-IN')} descriptions` : '…'}
            note={info ? `${info.categorizer.trainedOn}; ${info.categorizer.vocabulary.toLocaleString('en-IN')} features` : ''}
          />
          <p className="text-xs text-ink-3 sm:col-span-2">{CATEGORIZER_RESULT.caveat}</p>
        </Row>

        <Row
          title="Unusual transactions"
          model={`Statistical rule: more than ${info?.anomalies.thresholdSd ?? 2.5} standard deviations from the category's average`}
          status={info ? { tone: 'pos', text: 'Running' } : null}
          what="Flags amounts far from what you usually spend in that category, for you to review. Unusual is not the same as wrong."
        />

        <Row
          title="Written explanations"
          model="Gemini, with every number checked against FinAI's own calculations"
          status={info ? (info.explanations.geminiConfigured ? { tone: 'pos', text: 'Running' } : { tone: 'caution', text: 'No API key; built-in summaries used' }) : null}
          what="Turns computed figures into plain sentences. A reply containing any number FinAI did not calculate is rejected and replaced with a built-in summary."
        />
      </div>

      {/* The dataset behind the categorizer and the forecasting case study */}
      <div id="dataset-card" className="mt-6 rounded-md border border-line bg-canvas p-5">
        <p className="text-xs text-ink-2">Dataset used for training and testing</p>
        <a href={KAGGLE_DATASET.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 text-base font-semibold text-ink hover:text-accent">
          {KAGGLE_DATASET.name} by {KAGGLE_DATASET.author}, Kaggle <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-ink-2">Size</dt><dd className="text-ink tabular-nums">{KAGGLE_DATASET.rows.toLocaleString('en-IN')} transactions</dd></div>
          <div><dt className="text-xs text-ink-2">Period</dt><dd className="text-ink">{KAGGLE_DATASET.period}</dd></div>
          <div><dt className="text-xs text-ink-2">Currency</dt><dd className="text-ink">{KAGGLE_DATASET.currency}</dd></div>
          <div><dt className="text-xs text-ink-2">Licence</dt><dd className="text-ink">{KAGGLE_DATASET.licence ?? 'See the dataset page'}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-ink-3">
          Contents: {KAGGLE_DATASET.description}. Used to train the category model (2015–2017), test it (2018), and check the forecasting model.
          It is not shown as an account in the app.
        </p>
      </div>
    </section>
  );
}

function Row({ title, model, status, what, children }: {
  title: string;
  model: string;
  status: { tone: string; text: string } | null;
  what: string;
  children?: ReactNode;
}) {
  return (
    <div className="py-5 first:pt-0 grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {status && (
          <p data-status className={`mt-1 inline-flex items-center gap-1.5 text-xs ${status.tone === 'pos' ? 'text-pos' : 'text-caution'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status.tone === 'pos' ? 'bg-pos' : 'bg-caution'}`} aria-hidden="true" />
            {status.text}
          </p>
        )}
      </div>
      <div>
        <p className="text-sm text-ink">{model}</p>
        <p className="mt-1 text-sm text-ink-2">{what}</p>
        {children && <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>}
      </div>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-md bg-canvas border border-line p-3">
      <p className="text-xs text-ink-2">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-ink tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-3">{note}</p>}
    </div>
  );
}
