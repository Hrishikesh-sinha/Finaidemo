import { useMemo, useState } from 'react';
import { benchmarkFor, errorReductionPct } from '../forecast/benchmark';
import { forecastPeriod } from '../ui/period';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceArea, ReferenceLine
} from 'recharts';
import { CircleCheck, TriangleAlert, Info } from 'lucide-react';
import type { DashboardStats } from '../types';
import { C, inr, inrShort } from '../ui/theme';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_WEEKS = 16;

const shortDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getDate()} ${d.toLocaleString('en-IN', { month: 'short' })}`;
};

/** A round axis step from the 1/2/5 ladder, so ticks read ₹5k, ₹10k, ₹15k
 *  rather than whatever the data's maximum happens to divide into. */
function niceTicks(max: number, target = 5): { domain: [number, number]; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { domain: [0, 1], ticks: [0, 1] };
  const raw = max / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= raw) ?? 10 * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v));
  return { domain: [0, top], ticks };
}

interface Point {
  label: string;
  actual?: number;
  median?: number;
  range?: [number, number];
}

interface Method {
  name: string;
  /** How much to trust it. Drives the chip, never the numbers. */
  tone: 'model' | 'fallback';
  lead: string;
  /** Figures that already exist elsewhere in the project, shown as figures
   *  rather than buried in a paragraph. Empty for the fallback methods. */
  stats: { label: string; value: string; note?: string }[];
  footnote?: string;
}

/**
 * Why this method produced the number. Backtest figures come from
 * src/forecast/benchmark.ts, which picks the row matching this user's history
 * length. They are benchmark results on synthetic data, not this user's own
 * forecast accuracy, and the card says so. Nothing here may claim a model
 * that did not run.
 */
function methodFor(stats: DashboardStats): Method {
  const weeks = stats.forecast_weeks_of_history ?? 0;
  switch (stats.forecast_model) {
    case 'chronos-2': {
      const bench = benchmarkFor(weeks);
      const c = bench.cohort;
      return {
        name: 'Chronos-2',
        tone: 'model',
        lead:
          `A time-series foundation model Amazon released in October 2025. It reads your last ${weeks} weeks of ` +
          'spending and forecasts the next four without ever being trained on your data.',
        stats: c
          ? [
              { label: 'History used', value: `${weeks} weeks`, note: 'used from 26 weeks up' },
              { label: 'Benchmark error (MASE)', value: c.chronosMase.toFixed(3), note: `vs ${c.baselineMase.toFixed(3)}, ${c.baselineName}` },
              { label: 'Benchmark error vs that baseline', value: `${errorReductionPct(c)}% lower` }
            ]
          : [{ label: 'History used', value: `${weeks} weeks` }],
        footnote:
          (c
            ? `Benchmark, not your accuracy: rolling-origin backtest on synthetic data (40 users), measured at ${c.evaluated}. ${bench.note} `
            : '') +
          'Below 26 weeks of history Chronos-2 was no better than a simple average, so FinAI does not use it there.'
      };
    }
    case 'moving_average':
      return {
        name: '8-week average',
        tone: 'fallback',
        lead: stats.forecast_reason?.includes('weeks of history')
          ? `There are ${weeks} weeks of history. Chronos-2 is used from 26 weeks up, because below that it was no better than a simple average in our backtest, so FinAI uses the average of your last 8 weeks and says so.`
          : 'Chronos-2 is not available right now, so FinAI uses the average of your last 8 weeks instead and says so.',
        stats: []
      };
    case 'heuristic':
      return {
        name: 'Flat 3% estimate',
        tone: 'fallback',
        lead: 'The forecasting service is not reachable, so this is your last 30 days of spending plus 3%. It is an estimate, not a model forecast, and is labelled as one.',
        stats: []
      };
    default:
      return { name: 'Not reported', tone: 'fallback', lead: 'The forecast method was not reported.', stats: [] };
  }
}

export function ForecastSection({ stats }: { stats: DashboardStats }) {
  const weekly = stats.forecast_weekly;
  const [fullHistory, setFullHistory] = useState(false);

  const { points, weeks, historyWeeks, junctionLabel } = useMemo(() => {
    const empty = {
      points: [] as Point[],
      weeks: [] as { label: string; value: number; lo: number | null; hi: number | null }[],
      historyWeeks: 0,
      junctionLabel: null as string | null
    };
    if (!weekly || weekly.history.length === 0) return empty;

    const starts = weekly.week_starts.map(s => new Date(s).getTime());
    const total = weekly.history.length;
    // Four forecast weeks against sixty of history leaves the forecast a
    // sliver at the right edge, so the default view is the recent window.
    const from = fullHistory ? 0 : Math.max(0, total - RECENT_WEEKS);

    const pts: Point[] = weekly.history.slice(from).map((v, i) => ({
      label: shortDate(starts[from + i]),
      actual: Math.round(v)
    }));

    const fc = weekly.forecast ?? [];
    const last = pts[pts.length - 1];
    // Start the forecast at the last actual week so the lines join.
    if (fc.length && last && typeof last.actual === 'number') {
      last.median = last.actual;
      last.range = [last.actual, last.actual];
    }
    const junction = last?.label ?? null;

    const lastStart = starts[starts.length - 1] ?? Date.now();
    const rows = fc.map((v, i) => {
      const lo = weekly.lower?.[i] ?? null;
      const hi = weekly.upper?.[i] ?? null;
      const label = shortDate(lastStart + (i + 1) * WEEK_MS);
      pts.push({
        label,
        median: Math.round(v),
        range: lo !== null && hi !== null ? [Math.round(lo), Math.round(hi)] : undefined
      });
      return { label, value: v, lo, hi };
    });

    return { points: pts, weeks: rows, historyWeeks: total, junctionLabel: junction };
  }, [weekly, fullHistory]);

  const axis = useMemo(() => {
    const vals: number[] = [];
    for (const p of points) {
      if (typeof p.actual === 'number') vals.push(p.actual);
      if (typeof p.median === 'number') vals.push(p.median);
      if (p.range) vals.push(p.range[1]);
    }
    return niceTicks(Math.max(0, ...vals));
  }, [points]);

  const method = methodFor(stats);
  const hasRange =
    typeof stats.forecast_lower_30_days === 'number' && typeof stats.forecast_upper_30_days === 'number';
  const canToggle = historyWeeks > RECENT_WEEKS;
  const tickEvery = Math.max(1, Math.ceil(points.length / 9));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-8 lg:gap-10 items-start">
      {/* The number, and the case for it */}
      <div className="space-y-5">
        <div>
          <p className="text-sm text-ink-2">Expected in {forecastPeriod(stats)}</p>
          <p className="mt-1.5 text-5xl font-semibold tracking-[-0.03em] text-ink">
            {inr(stats.forecast_next_30_days)}
          </p>
          {hasRange && (
            <p className="mt-3 text-sm text-ink-2">
              Likely between{' '}
              <span className="text-ink">{inr(stats.forecast_lower_30_days!)}</span> and{' '}
              <span className="text-ink">{inr(stats.forecast_upper_30_days!)}</span>
              <span className="text-ink-3"> — an 80% range</span>
            </p>
          )}
        </div>

        <div className="rounded-lg border border-line bg-surface p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">How this number was made</h3>
            <span
              className={`shrink-0 text-micro px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 border ${
                method.tone === 'model'
                  ? 'bg-pos/10 text-pos border-pos/30'
                  : 'bg-caution/10 text-caution border-caution/30'
              }`}
            >
              {method.tone === 'model'
                ? <CircleCheck className="w-3.5 h-3.5" />
                : <TriangleAlert className="w-3.5 h-3.5" />}
              {method.name}
            </span>
          </div>

          <p className="text-sm leading-relaxed text-ink-2">{method.lead}</p>

          {method.stats.length > 0 && (
            <dl className="divide-y divide-line border-t border-line">
              {method.stats.map(s => (
                <div key={s.label} className="py-2.5 flex items-baseline justify-between gap-4">
                  <dt className="text-xs text-ink-2">{s.label}</dt>
                  <dd className="text-right">
                    <span className="text-sm font-medium text-ink tabular">{s.value}</span>
                    {s.note && <span className="block text-micro text-ink-3 tabular">{s.note}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {method.footnote && (
            <p className="text-micro text-ink-3 leading-relaxed flex items-start gap-1.5 pt-1">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>{method.footnote}</span>
            </p>
          )}
        </div>
      </div>

      {/* The series */}
      <div className="rounded-lg border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Weekly spending and the next four weeks</h3>
            <p className="text-micro text-ink-3 mt-0.5">
              {canToggle && !fullHistory
                ? `Showing the last ${RECENT_WEEKS} of ${historyWeeks} weeks.`
                : `Showing all ${historyWeeks} weeks of history.`}
            </p>
          </div>
          {canToggle && (
            <div className="flex items-center bg-sunken p-0.5 rounded-md border border-line shrink-0">
              {[
                { on: false, label: `Last ${RECENT_WEEKS} weeks` },
                { on: true, label: 'All history' }
              ].map(o => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => setFullHistory(o.on)}
                  aria-pressed={fullHistory === o.on}
                  className={`px-2.5 py-1 rounded-sm text-micro transition-colors ${
                    fullHistory === o.on ? 'bg-raised text-ink font-medium' : 'text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-micro text-ink-3 mb-3">
          <span className="flex items-center gap-1.5"><span className="w-3.5 h-0.5 rounded" style={{ backgroundColor: C.ink }} />Actual</span>
          {weeks.length > 0 && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-0.5 rounded border-t-2 border-dashed" style={{ borderColor: C.accent }} />Forecast
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-2.5 rounded-xs" style={{ backgroundColor: C.accent, opacity: 0.4 }} />80% range
              </span>
            </>
          )}
        </div>

        <div className="h-72 w-full">
          {points.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-ink-3">
              Add some transactions to see a weekly forecast.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} margin={{ top: 16, right: 8, left: -4, bottom: 0 }}>
                <CartesianGrid stroke={C.line} strokeWidth={1} vertical={false} />

                {/* The weeks that have not happened yet, called out as such. */}
                {junctionLabel && weeks.length > 0 && (
                  <ReferenceArea
                    x1={junctionLabel}
                    x2={weeks[weeks.length - 1].label}
                    ifOverflow="extendDomain"
                    shape={(p: { x: number; y: number; width: number; height: number }) => (
                      <rect x={p.x} y={p.y} width={p.width} height={p.height} fill={C.accent} fillOpacity={0.06} />
                    )}
                  />
                )}
                {junctionLabel && weeks.length > 0 && (
                  <ReferenceLine
                    x={junctionLabel}
                    stroke={C.lineStrong}
                    strokeWidth={1}
                    label={{
                      value: 'forecast',
                      position: fullHistory ? 'insideTopRight' : 'insideTopLeft',
                      fill: C.ink3, fontSize: 11, dy: -10, dx: fullHistory ? -4 : 4
                    }}
                  />
                )}

                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: C.ink3 }}
                  axisLine={{ stroke: C.line }}
                  tickLine={false}
                  interval={tickEvery - 1}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: C.ink3 }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                  domain={axis.domain}
                  ticks={axis.ticks}
                  tickFormatter={(v: number) => (v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`)}
                />
                <Tooltip
                  cursor={{ stroke: C.lineStrong, strokeWidth: 1 }}
                  contentStyle={{
                    backgroundColor: C.raised, borderRadius: '8px',
                    border: `1px solid ${C.line}`, color: C.ink, fontSize: '12px'
                  }}
                  labelStyle={{ color: C.ink2, marginBottom: 4 }}
                  labelFormatter={(l: string) => `Week of ${l}`}
                  formatter={(val: number | [number, number], name: string) =>
                    Array.isArray(val)
                      ? [`${inr(val[0])} to ${inr(val[1])}`, '80% range']
                      : [inr(val), name === 'actual' ? 'Actual' : 'Forecast']
                  }
                />

                <Area
                  type="linear"
                  dataKey="range"
                  stroke={C.accent}
                  strokeOpacity={0.5}
                  strokeWidth={1}
                  fill={C.accent}
                  fillOpacity={0.22}
                  isAnimationActive={false}
                />
                <Line type="linear" dataKey="actual" stroke={C.ink} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line
                  type="linear"
                  dataKey="median"
                  stroke={C.accent}
                  strokeWidth={2.5}
                  strokeDasharray="5 4"
                  dot={{ r: 3.5, fill: C.accent, stroke: C.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {weeks.length > 0 && (
          <ul className="mt-5 pt-4 border-t border-line grid grid-cols-2 sm:grid-cols-4 gap-4">
            {weeks.map(w => (
              <li key={w.label} className="rounded-md bg-sunken border border-line p-3">
                <p className="text-micro text-ink-3">Week of {w.label}</p>
                <p className="mt-1 text-lg font-semibold text-ink">{inr(w.value)}</p>
                {w.lo !== null && w.hi !== null && (
                  <p className="text-micro text-ink-3 mt-0.5">{inrShort(w.lo)}–{inrShort(w.hi)}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
