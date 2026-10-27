import { useState, useEffect, useMemo, useRef, type ReactNode, type FormEvent } from 'react';
import { 
  TrendingUp, TrendingDown, DollarSign, Wallet, 
  Activity, AlertTriangle, MessageSquare, Plus,
  ArrowLeft, ArrowRight, ShieldAlert,
  Info, PieChart as PieIcon, BarChart2, Calendar, Check,
  Sparkles, CheckCircle2, XCircle, ArrowUpRight, Shield,
  FileText, Copy, RefreshCw, Loader2, Camera,
  Receipt
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, AreaChart, Area, CartesianGrid
} from 'recharts';
import { DashboardStats, Transaction, MockUser, MockTransaction } from '../types';
import { TransactionModal } from './TransactionModal';
import { EditTransactionDialog } from './EditTransactionDialog';
import { forecastPeriod, isStale, shortDate } from '../ui/period';
import { ChatAssistant } from './ChatAssistant';
import { SimulatorPanel } from './SimulatorPanel';
import { ForecastSection } from './ForecastSection';
import { type StorySection } from './SectionNav';
import { isAppView, type AppView } from './AppNav';
import { AppSidebar } from './AppSidebar';
import { TransactionsView } from './TransactionsView';
import { SettingsView } from './SettingsView';
import { CategoryBadge } from './CategoryBadge';
import { C, categoryColor, inrShort } from '../ui/theme';

interface Props {
  token?: string | null;
  mockUser?: MockUser | null;
  onBackToAdmin?: () => void;
  onSelectUser?: (user: MockUser) => void;
  allMockUsers?: MockUser[];
  onLogout?: () => void;
  username?: string;
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
  onSignOut?: () => void;
}

// Deviation of a transaction from its own category's average, in standard
// deviations, computed the same way the server's detectAnomalies does, so the
// figure shown to the user is the one that actually triggered the flag.
// Returns null when the category has too little data for a meaningful sigma.
function categoryDeviationSigma(
  tx: { amount: number; category?: string },
  all: { amount: number; category: string }[]
): number | null {
  if (!tx.category) return null;

  const amounts = all.filter(t => t.category === tx.category).map(t => t.amount);
  if (amounts.length < 3) return null;

  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance = amounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / amounts.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return null;

  return (tx.amount - mean) / sd;
}

function deviationSentence(
  tx: { amount: number; category?: string },
  all: { amount: number; category: string }[]
): string {
  const category = tx.category || 'this category';
  const sigma = categoryDeviationSigma(tx, all);

  if (sigma === null) {
    return `Flagged as an outlier against the ${category} average`;
  }

  return `Spent ${Math.abs(sigma).toFixed(1)}σ ${sigma >= 0 ? 'above' : 'below'} the ${category} average`;
}

// Forecast provenance labels. The dashboard names the method that actually
// produced the number; it must never imply a model that did not run.
const FORECAST_METHOD_NAMES: Record<string, string> = {
  'chronos-2': 'Chronos-2',
  moving_average: '8-week average',
  heuristic: 'flat 3% estimate'
};

function forecastQualifier(reason?: string | null): string {
  if (!reason) return '';
  if (reason.includes('weeks of history')) return ' (insufficient history)';
  if (reason.includes('still loading')) return ' (model loading)';
  if (reason.includes('failed during inference')) return ' (model error)';
  if (reason.includes('unavailable')) return ' (model unavailable)';
  if (reason.includes('unreachable')) return ' (service unavailable)';
  if (reason.includes('no transactions')) return ' (no data)';
  return '';
}

function forecastMethodLabel(model?: string, reason?: string | null): string {
  if (!model) return 'Forecast method not reported';
  return `Forecast: ${FORECAST_METHOD_NAMES[model] ?? model}${forecastQualifier(reason)}`;
}

// The dashboard reads top to bottom as one story.
const STORY_SECTIONS: StorySection[] = [
  { id: 'this-month', label: 'This month' },
  { id: 'next-month', label: 'Next month' },
  { id: 'what-if', label: 'What if?' },
  { id: 'details', label: 'The details' }
];

function SectionHeading({ title, lead }: { step?: number; title: string; lead: string }) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink">{title}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{lead}</p>
    </div>
  );
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

// The forecast as a plain sentence that names the method that produced it.
function forecastSentence(stats: DashboardStats): string {
  const amount = inr(stats.forecast_next_30_days);
  const period = forecastPeriod(stats);
  switch (stats.forecast_model) {
    case 'chronos-2':
      return `Chronos-2 expects you to spend about ${amount} in ${period}.`;
    case 'moving_average':
      return `Going by your 8-week average, expect about ${amount} in ${period}.`;
    case 'heuristic':
      return `A simple projection puts ${period} at about ${amount}, because the forecasting service is not available.`;
    default:
      return `Projected spending for ${period}: about ${amount}.`;
  }
}

// Animates a number from its previous value to a new one, once per change.
// Skipped entirely when the user has asked their device to reduce motion.
function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !Number.isFinite(target)) {
      setValue(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

function healthLabel(score: number): string {
  if (score >= 80) return 'Healthy';
  if (score >= 65) return 'Fair';
  return 'Needs attention';
}

function forecastBandLabel(lower?: number | null, upper?: number | null): string {
  if (typeof lower !== 'number' || typeof upper !== 'number') return 'no interval';
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  return `${fmt(lower)}–${fmt(upper)}`;
}

// The health score as a 270-degree arc. The band is also named in words
// beside it, so the score is never carried by colour alone.
function healthTone(score: number): string {
  if (score >= 80) return C.pos;
  if (score >= 65) return C.accent;
  return C.caution;
}

function HealthArc({ score }: { score: number }) {
  const size = 116;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const sweep = 270;
  const start = 135; // bottom-left, running clockwise to bottom-right
  const circumference = 2 * Math.PI * r;
  const arcLength = (sweep / 360) * circumference;
  const clamped = Math.max(0, Math.min(100, score));
  const tone = healthTone(clamped);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`Financial health score ${score} out of 100`}>
        <g transform={`rotate(${start} ${cx} ${cy})`}>
          <circle
            cx={cx} cy={cy} r={r} fill="none"
            stroke={C.raised} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
          />
          <circle
            cx={cx} cy={cy} r={r} fill="none"
            stroke={tone} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${(arcLength * clamped) / 100} ${circumference}`}
            style={{ transition: 'stroke-dasharray 700ms ease' }}
          />
        </g>
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold leading-none text-ink">{score}</span>
        <span className="text-micro text-ink-3 mt-0.5">of 100</span>
      </span>
    </div>
  );
}

// Where a month's income went: spending, then what was left, with the savings
// goal drawn as the spending ceiling that still reaches it. The same encoding
// the What-If Simulator uses, so the two screens read the same way.
function CompositionBar({
  income, spent, goalPct, meetsGoal
}: { income: number; spent: number; goalPct: number; meetsGoal: boolean }) {
  const scale = Math.max(income, spent, 1);
  const saved = Math.max(0, income - spent);
  const over = Math.max(0, spent - income);
  const pct = (v: number) => `${(v / scale) * 100}%`;
  const goalFrac = Math.max(0, Math.min(1, (income - (income * goalPct) / 100) / scale));

  return (
    <div>
      <div className="relative h-4">
        <span
          className="absolute top-0 text-micro text-ink whitespace-nowrap -translate-x-1/2"
          style={{ left: `${goalFrac * 100}%` }}
        >
          {goalPct}% goal
        </span>
      </div>
      <div className="relative h-7 rounded-md bg-sunken overflow-hidden mt-1">
        <div className="absolute inset-y-0 left-0" style={{ width: pct(Math.min(spent, income)), backgroundColor: C.lineStrong }} />
        {saved > 0 && (
          <div
            className="absolute inset-y-0"
            style={{
              left: `calc(${pct(spent)} + 2px)`,
              width: `max(0px, calc(${pct(saved)} - 2px))`,
              backgroundColor: meetsGoal ? C.pos : C.caution
            }}
          />
        )}
        {over > 0 && (
          <div
            className="absolute inset-y-0"
            style={{ left: `calc(${pct(income)} + 2px)`, width: `max(0px, calc(${pct(over)} - 2px))`, backgroundColor: C.neg }}
          />
        )}
        <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${goalFrac * 100}%` }} aria-hidden="true" />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro text-ink-3 mt-2">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2.5 rounded-xs" style={{ backgroundColor: C.lineStrong }} />Spent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2.5 rounded-xs" style={{ backgroundColor: meetsGoal ? C.pos : C.caution }} />
          {over > 0 ? 'Nothing left' : 'Saved'}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-0.5 h-3 bg-ink" />Spending past this line misses the goal
        </span>
      </div>
    </div>
  );
}

export function Dashboard({ token, mockUser, onBackToAdmin, onSelectUser, allMockUsers, onLogout, username, isAdmin, onOpenAdmin, onSignOut }: Props) {
  const [stats, setStats] = useState<DashboardStats | null>(mockUser ? mockUser.stats : null);
  const [transactions, setTransactions] = useState<Transaction[]>(
    mockUser && Array.isArray(mockUser.transactions) ? mockUser.transactions : []
  );
  const [loading, setLoading] = useState(!mockUser);
  const [categoryChartType, setCategoryChartType] = useState<'bar' | 'donut'>('bar');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  // Which view is open. Kept in the address (#transactions etc.) so the
  // browser's back button and a refresh land on the same view.
  const [view, setView] = useState<AppView>(() => {
    const h = window.location.hash.slice(1);
    return isAppView(h) ? h : 'overview';
  });
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.slice(1);
      setView(isAppView(h) ? h : 'overview');
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, []);
  const go = (v: AppView) => {
    if (window.location.hash !== `#${v}`) window.history.pushState(null, '', `#${v}`);
    setView(v);
    window.scrollTo({ top: 0 });
  };
  // Sample users in the admin view keep the single long page.
  const show = (v: AppView) => Boolean(mockUser) || view === v;
  const [modalInitialMethod, setModalInitialMethod] = useState<'manual' | 'ocr' | 'voice'>('manual');
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Anomaly action state for quick Verify / Dismiss
  const [reviews, setReviews] = useState<Record<string, 'expected' | 'dismissed' | null>>({});
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Synchronize state if mockUser prop changes
  useEffect(() => {
    if (mockUser) {
      setStats(mockUser.stats || null);
      setTransactions(Array.isArray(mockUser.transactions) ? mockUser.transactions : []);
      setLoading(false);
    }
  }, [mockUser]);

  const fetchData = async () => {
    if (!token || mockUser) return;
    try {
      const [statsRes, txRes] = await Promise.all([
        fetch('/api/dashboard', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/transactions', { headers: { 'Authorization': `Bearer ${token}` } })
      ]);

      if (statsRes.status === 401 || txRes.status === 401) {
        console.warn('Session expired or unauthorized, logging out');
        localStorage.removeItem('finai_token');
        if (onLogout) {
          onLogout();
        }
        return;
      }

      if (!statsRes.ok || !txRes.ok) {
        console.error('API response error:', statsRes.status, txRes.status);
        setTransactions([]);
        return;
      }

      const s = await statsRes.json();
      const t = await txRes.json();

      if (s && typeof s === 'object' && !('detail' in s)) {
        setStats(s);
      }
      if (Array.isArray(t)) {
        setTransactions(t);
      } else {
        setTransactions([]);
      }
    } catch (e) {
      console.error('Error fetching dashboard data:', e);
      setTransactions([]);
      if (!stats) {
        setStats({
          total_spent: 0,
          savings_rate: 0,
          health_score: 80,
          forecast_next_30_days: 0,
          smart_budget: {
            'Needs (Bills, Food)': 25000,
            'Wants (Entertainment, Shopping)': 15000,
            'Savings Target': 10000
          },
          anomalies: []
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!mockUser && token) {
      fetchData();
    }
  }, [token, mockUser]);

  // Charts, the budget and the insights describe the same 30 days as the
  // "spent" figure (the server's total_spent). Sample users in the admin view
  // are fixtures with fixed dates, so they use all of their transactions.
  const windowTxs = useMemo(() => {
    if (!Array.isArray(transactions)) return [];
    if (mockUser) return transactions;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return transactions.filter(t => new Date(t.date).getTime() >= cutoff);
  }, [transactions, mockUser]);

  // Group the window's spending by category (excluding income credits)
  const categoryData = useMemo(() => {
    if (windowTxs.length === 0) return [];
    const expenseTxs = windowTxs.filter(t => (t as MockTransaction)?.type !== 'income');
    const grouped = expenseTxs.reduce((acc, t) => {
      acc[t.category] = (acc[t.category] || 0) + t.amount;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value: Number(value) }))
      .sort((a, b) => b.value - a.value);
  }, [windowTxs]);

  const categoryTotal = useMemo(() => categoryData.reduce((sum, c) => sum + c.value, 0), [categoryData]);
  const categoryMax = useMemo(() => Math.max(0, ...categoryData.map(c => c.value)), [categoryData]);

  // Chronological spending trend line data
  const trendData = useMemo(() => {
    if (windowTxs.length === 0) return [];
    const expenseTxs = [...windowTxs]
      .filter(t => (t as MockTransaction)?.type !== 'income')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let cumulative = 0;
    return expenseTxs.map(t => {
      cumulative += t.amount;
      const d = new Date(t.date);
      const day = d.getDate();
      const month = d.toLocaleString('en-IN', { month: 'short' });
      return {
        date: `${day} ${month}`,
        rawDate: t.date,
        merchant: t.merchant,
        category: t.category,
        amount: t.amount,
        cumulative: Math.round(cumulative)
      };
    });
  }, [windowTxs]);

  // Spending pace: running total over the last 30 days against the 30 days
  // before, day by day. Real accounts are measured up to now (the same window
  // as "spent"); sample users up to their own latest transaction.
  const pace = useMemo(() => {
    const DAY = 24 * 60 * 60 * 1000;
    const spend = (Array.isArray(transactions) ? transactions : [])
      .filter(t => (t as MockTransaction)?.type !== 'income')
      .map(t => ({ ts: new Date(t.date).getTime(), amount: t.amount }))
      .filter(t => Number.isFinite(t.ts) && Number.isFinite(t.amount));
    if (spend.length === 0) return null;

    const end = mockUser ? Math.max(...spend.map(t => t.ts)) : Date.now();
    const start = end - 30 * DAY;
    const prevStart = start - 30 * DAY;
    const current = new Array<number>(30).fill(0);
    const previous = new Array<number>(30).fill(0);
    for (const t of spend) {
      if (t.ts >= start && t.ts <= end) current[Math.min(29, Math.floor((t.ts - start) / DAY))] += t.amount;
      else if (t.ts >= prevStart && t.ts < start) previous[Math.min(29, Math.floor((t.ts - prevStart) / DAY))] += t.amount;
    }

    let c = 0;
    let p = 0;
    const points = current.map((v, i) => {
      c += v;
      p += previous[i];
      const d = new Date(start + (i + 1) * DAY);
      return { label: `${d.getDate()} ${d.toLocaleString('en-IN', { month: 'short' })}`, current: Math.round(c), previous: Math.round(p) };
    });
    return {
      points,
      total: Math.round(c),
      previousTotal: Math.round(p),
      diff: Math.round(c - p),
      hasPrevious: previous.some(v => v > 0)
    };
  }, [transactions, mockUser]);

  const animatedSpent = useCountUp(stats?.total_spent ?? 0);

  // AI Insights State
  const [insights, setInsights] = useState<string[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsHasKey, setInsightsHasKey] = useState<boolean | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [lastGeneratedTime, setLastGeneratedTime] = useState<string | null>(null);

  // AI Monthly Report State
  const [report, setReport] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportCopied, setReportCopied] = useState(false);
  const [reportHasKey, setReportHasKey] = useState<boolean | null>(null);

  // A signed-in account with nothing logged yet gets a welcome screen instead
  // of a dashboard of zeros, a 100/100 score and an empty forecast.
  const isNewAccount = !mockUser && !loading && Array.isArray(transactions) && transactions.length === 0;

  // Effective monthly income calculation
  const effectiveMonthlyIncome = useMemo(() => {
    if (mockUser) return mockUser.monthly_income;
    if (!stats) return 50000;
    if (typeof stats.monthly_income === 'number') return stats.monthly_income;
    return stats.total_spent > 0 ? (stats.total_spent / (1 - (stats.savings_rate / 100 || 0.2))) : 50000;
  }, [mockUser, stats]);

  // Compact financial summary context for Gemini
  const financialContext = useMemo(() => {
    if (!stats) return null;
    const catTotals: Record<string, number> = {};
    categoryData.forEach(c => {
      catTotals[c.name] = c.value;
    });

    return {
      monthly_income: Math.round(effectiveMonthlyIncome),
      total_spent: Math.round(stats.total_spent),
      category_breakdown: catTotals,
      budget_status: {
        needs: Math.round(effectiveMonthlyIncome * 0.5),
        wants: Math.round(effectiveMonthlyIncome * 0.3),
        savings: Math.round(effectiveMonthlyIncome * 0.2)
      },
      savings_rate: Number(stats.savings_rate.toFixed(1)),
      health_score: stats.health_score
    };
  }, [stats, effectiveMonthlyIncome, categoryData]);

  // Unique signature of transactions to prevent redundant AI API calls
  const txSignature = useMemo(() => {
    const userKey = mockUser ? mockUser.id : (token ? 'auth_user' : 'anon');
    const txList = Array.isArray(transactions) ? transactions : [];
    const count = txList.length;
    const firstTx = txList[0]?.id || 'none';
    const total = stats?.total_spent || 0;
    return `${userKey}_${count}_${firstTx}_${total}`;
  }, [mockUser, token, transactions, stats?.total_spent]);

  // Fetch AI Insights with local caching
  const fetchInsights = async (forceRefresh = false) => {
    if (!financialContext) return;
    if (mockUser || !token) {
      // AI text is computed on the server from a signed-in account's own
      // records; the admin view's sample users have no server records.
      setInsights([]);
      setInsightsError('AI insights are generated only for signed-in accounts, from their own records.');
      return;
    }
    const cacheKey = `finai_insights_cache_${mockUser ? mockUser.id : 'user'}`;

    if (!forceRefresh) {
      try {
        const saved = localStorage.getItem(cacheKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.signature === txSignature && Array.isArray(parsed.insights) && parsed.insights.length > 0) {
            setInsights(parsed.insights);
            setInsightsHasKey(parsed.hasKey ?? true);
            setLastGeneratedTime(parsed.time || 'Cached');
            return;
          }
        }
      } catch (e) {
        // Cache miss
      }
    }

    setInsightsLoading(true);
    setInsightsError(null);

    try {
      const res = await fetch('/api/ai/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: '{}'
      });

      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))).detail;
        throw new Error(detail || `Insights service returned HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.insights && Array.isArray(data.insights)) {
        setInsights(data.insights);
        setInsightsHasKey(data.has_key);
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setLastGeneratedTime(timeStr);
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            signature: txSignature,
            insights: data.insights,
            hasKey: data.has_key,
            time: timeStr
          }));
        } catch (e) {
          // localStorage ignored
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch insights:', err);
      setInsightsError(err?.message || 'Unable to load insights.');
    } finally {
      setInsightsLoading(false);
    }
  };

  useEffect(() => {
    if (financialContext && !loading && !isNewAccount) {
      fetchInsights(false);
    }
  }, [txSignature, loading]);

  // Generate AI Monthly Report
  const generateMonthlyReport = async () => {
    if (!financialContext) return;
    if (mockUser || !token) {
      setReportError('The monthly report is generated only for signed-in accounts, from their own records.');
      return;
    }
    setReportLoading(true);
    setReportError(null);
    setReportCopied(false);

    try {
      const res = await fetch('/api/ai/monthly-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: '{}'
      });

      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))).detail;
        throw new Error(detail || `Report service returned HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.report) {
        setReport(data.report);
        setReportHasKey(data.has_key);
      } else {
        throw new Error('Empty report body received');
      }
    } catch (err: any) {
      console.error('Monthly report error:', err);
      setReportError(err?.message || 'Unable to generate the report.');
    } finally {
      setReportLoading(false);
    }
  };

  const handleCopyReport = () => {
    if (!report) return;
    navigator.clipboard.writeText(report);
    setReportCopied(true);
    setTimeout(() => setReportCopied(false), 2000);
  };

  if (loading || !stats) {
    return (
      <div className="flex h-[calc(100vh-64px)] items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-3">
          <Activity className="w-8 h-8 animate-spin text-accent" />
          <span className="text-sm text-ink-2">Loading your dashboard…</span>
        </div>
      </div>
    );
  }

  // Smart budget calculations: 50/30/20 heuristic
  const budgetAllocation = [
    {
      name: 'Needs',
      subtitle: 'bills, food, transport',
      ratio: '50%',
      target: effectiveMonthlyIncome * 0.5,
      current: categoryData.filter(c => ['Bills', 'Food', 'Transport'].includes(c.name)).reduce((sum, c) => sum + c.value, 0),
      fill: C.accent,
      trackColor: 'bg-accent',
      badge: '50% Target'
    },
    {
      name: 'Wants',
      subtitle: 'shopping, entertainment',
      ratio: '30%',
      target: effectiveMonthlyIncome * 0.3,
      current: categoryData.filter(c => ['Shopping', 'Entertainment'].includes(c.name)).reduce((sum, c) => sum + c.value, 0),
      fill: C.accent,
      trackColor: 'bg-caution',
      badge: '30% Target'
    },
    {
      name: 'Savings',
      subtitle: 'income left after spending',
      ratio: '20%',
      target: effectiveMonthlyIncome * 0.2,
      current: Math.max(0, effectiveMonthlyIncome - stats.total_spent),
      fill: C.accent,
      trackColor: 'bg-pos',
      badge: '20% Target'
    },
  ];

  // User switcher helpers for Admin detail view
  const currentMockUserIndex = allMockUsers && mockUser 
    ? allMockUsers.findIndex(u => u.id === mockUser.id)
    : -1;
  const prevUser = allMockUsers && currentMockUserIndex > 0 ? allMockUsers[currentMockUserIndex - 1] : null;
  const nextUser = allMockUsers && currentMockUserIndex < allMockUsers.length - 1 ? allMockUsers[currentMockUserIndex + 1] : null;

  // Formatted total spend for donut center
  const totalSpendFormatted = stats.total_spent >= 1000 
    ? `₹${(stats.total_spent / 1000).toFixed(1)}k` 
    : `₹${stats.total_spent.toFixed(0)}`;

  // Whatever the anomaly check actually found, and nothing else. An account
  // with no outliers shows an empty state rather than a substituted
  // transaction.
  const primaryAnomalies = stats.anomalies ?? [];
  const savingsGoal = mockUser?.target_savings_percent ?? stats.target_savings_percent ?? 20;
  const recentUnusual = mockUser
    ? primaryAnomalies.length
    : primaryAnomalies.filter(a => new Date(a.date).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000).length;

  // Saved on the server, so a verdict survives a refresh. Local state only
  // mirrors what the server confirmed.
  const setReview = async (id: string | number, status: 'expected' | 'dismissed' | null) => {
    if (mockUser || !token) return;
    setReviewError(null);
    try {
      const res = await fetch(`/api/anomalies/${encodeURIComponent(String(id))}/review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReviews(prev => ({ ...prev, [String(id)]: status }));
    } catch {
      setReviewError(String(id));
    }
  };

  return (
    <div className={`min-h-screen bg-canvas text-ink font-sans ${mockUser ? '' : 'lg:pl-60 pb-20 lg:pb-0'}`}>
      {!mockUser && (
        <AppSidebar view={view} onChange={go} username={username} isAdmin={isAdmin} onOpenAdmin={onOpenAdmin} onSignOut={onSignOut} />
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
        <div className="pt-8">
          {/* SYNTHETIC DATA NOTICE - shown for the seeded demo account and for
              the admin mock users, both of which are simulated, never for a real
              account's own transactions. */}
          {!mockUser && stats.data_source === 'kaggle' && stats.data_import && (
            <div
              id="kaggle-data-notice"
              className="flex items-start gap-2.5 p-3 rounded-lg bg-caution/10 border border-caution/30 text-caution"
            >
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <p className="text-xs leading-relaxed">
                <span className="font-semibold">Sample dataset:</span>{' '}
                {stats.data_import.dataset}, one individual's spending in INR from {stats.data_import.original_first} to{' '}
                {stats.data_import.original_last}, described by its author as dummy data.
                {stats.data_import.shift_weeks > 0 && <> Dates moved forward {stats.data_import.shift_weeks} weeks so it ends this week; amounts and order are unchanged.</>}
              </p>
            </div>
          )}

          

          {/* STALE LOG NOTICE - the 30-day window runs to today, so days with
              nothing logged count as no spending. Say so instead of presenting
              an understated total and an inflated savings rate as complete. */}
          {!mockUser && isStale(stats) && (
            <div
              id="stale-log-notice"
              role="status"
              className="mt-3 flex items-start gap-2.5 p-3 rounded-lg bg-caution/10 border border-caution/30 text-caution"
            >
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <p className="text-xs leading-relaxed">
                <span className="font-semibold">Nothing logged since {shortDate(stats.reporting!.data_through!)}.</span>{' '}
                {stats.reporting!.unlogged_days_in_window} of the last 30 days have no entries, so spending is likely
                understated and the savings rate overstated.
              </p>
            </div>
          )}

        </div>

        {/* Income is no longer asked for at sign-up: until it is set, ask here
            rather than computing a savings rate against ₹0. */}
        {!mockUser && token && stats && stats.monthly_income === 0 && (view === 'overview' || view === 'forecast' || view === 'planner') && (
          <IncomePrompt token={token} onSaved={fetchData} />
        )}

        {isNewAccount && (view === 'overview' || view === 'forecast' || view === 'planner') ? (
          <NewAccountWelcome
            income={stats.monthly_income ?? effectiveMonthlyIncome}
            onAdd={method => { setModalInitialMethod(method); setIsModalOpen(true); }}
          />
        ) : (<>
        {/* OVERVIEW */}
        {show('overview') && (
        <section id="this-month" aria-label="This month" className="scroll-mt-32 pt-8 pb-16 space-y-6">
          {/* ADMIN DETAIL VIEW TOP BAR */}
          {mockUser ? (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
                <div className="flex items-center gap-3">
                  {onBackToAdmin && (
                    <button 
                      id="admin-back-to-users-btn"
                      onClick={onBackToAdmin}
                      className="flex items-center gap-2 px-3 py-1.5 bg-raised hover:bg-line text-ink rounded-lg text-xs font-medium border border-line transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>All users</span>
                    </button>
                  )}
                  <span className="text-xs text-ink-2">
                    Sample users / <strong className="text-ink font-medium">{mockUser.name}</strong>
                  </span>
                </div>

                {/* Quick Next/Previous User Buttons */}
                {allMockUsers && onSelectUser && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-2 hidden md:inline">Quick Switch:</span>
                    {prevUser && (
                      <button
                        onClick={() => onSelectUser(prevUser)}
                        className="px-2.5 py-1 bg-surface hover:bg-raised text-ink rounded-lg text-xs border border-line flex items-center gap-1.5 transition-colors"
                        title={`Previous: ${prevUser.name}`}
                      >
                        <ArrowLeft className="w-3 h-3 text-ink-2" />
                        <span>{prevUser.name.split(' ')[0]}</span>
                      </button>
                    )}
                    {nextUser && (
                      <button
                        onClick={() => onSelectUser(nextUser)}
                        className="px-2.5 py-1 bg-surface hover:bg-raised text-ink rounded-lg text-xs border border-line flex items-center gap-1.5 transition-colors"
                        title={`Next: ${nextUser.name}`}
                      >
                        <span>{nextUser.name.split(' ')[0]}</span>
                        <ArrowRight className="w-3 h-3 text-ink-2" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* User Profile Header Banner */}
              <div className="bg-surface p-5 rounded-lg border border-line flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-lg ${mockUser.avatarColor} flex items-center justify-center font-bold text-base flex-shrink-0 text-white`}>
                    {mockUser.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h1 className="text-xl sm:text-2xl font-semibold text-ink tracking-tight">{mockUser.name}</h1>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-raised text-ink-2 border border-line">
                        {mockUser.spending_pattern_title}
                      </span>
                      {mockUser.anomaly_flag.isFlagged && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium flex items-center gap-1.5 bg-neg/10 text-neg border border-neg/30">
                          <ShieldAlert className="w-3 h-3" />
                          {mockUser.anomaly_flag.badgeText}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink-2 mt-1">{mockUser.spending_pattern_description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-ink-2">
                      <span>Account: @{mockUser.username}</span>
                      <span>•</span>
                      <span>Monthly income: {inr(mockUser.monthly_income)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="px-3.5 py-2 rounded-lg bg-canvas border border-line text-right">
                    <div className="text-[10px] text-ink-2">Access level</div>
                    <div className="text-xs font-medium text-pos flex items-center gap-1.5 justify-end mt-0.5">
                      <Shield className="w-3 h-3" />
                      Admin
                    </div>
                  </div>
                </div>
              </div>

              {/* Anomaly Highlight Banner if user has flagged spending */}
              {mockUser.anomaly_flag.isFlagged && (
                <div className="p-4 rounded-lg border flex items-start gap-3.5 bg-neg/10 border-neg/30 text-neg">
                  <div className="w-8 h-8 rounded-lg bg-neg/10 border border-neg/30 flex items-center justify-center flex-shrink-0 mt-0.5 text-neg">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-neg flex items-center gap-2">
                      <span>Flagged spending</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-neg/15 border border-neg/30 font-medium">
                        {mockUser.anomaly_flag.badgeText}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-ink">
                      {mockUser.anomaly_flag.reason}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* STANDARD USER HEADER */
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink">Overview</h1>
                </div>
                <p className="text-xs text-ink-2 mt-1">
                  The last 30 days: what came in, what went out, and where it went.
                </p>
              </div>
            
              <div className="flex flex-wrap items-center gap-2">
                <button 
                  id="btn-open-assistant"
                  onClick={() => setIsChatOpen(true)}
                  className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-raised text-ink hover:text-ink rounded-full border border-line hover:border-ink-2/40 hover:bg-line transition-all text-xs font-medium"
                >
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  <span>Ask FinAI</span>
                </button>
                <button 
                  id="btn-scan-receipt-header"
                  onClick={() => { setModalInitialMethod('ocr'); setIsModalOpen(true); }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-raised text-ink hover:text-ink rounded-lg border border-line hover:border-accent hover:bg-line transition-all text-xs font-medium cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5 text-accent" />
                  <span>Scan Receipt</span>
                </button>
                <button 
                  id="btn-add-entry"
                  onClick={() => { setModalInitialMethod('manual'); setIsModalOpen(true); }}
                  className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-accent text-canvas rounded-lg font-medium hover:bg-accent-hi transition-all text-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add transaction</span>
                </button>
              </div>
            </div>
          )}

          {/* 2. THE FINANCIAL STATE: income, spending and savings as one
              picture, with the health score beside it. This is the "personal
              financial state" the rest of the page reasons about. */}
          <section id="summary-statement" aria-label="Your financial state" className="bg-surface rounded-lg border border-line">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="p-6 sm:p-8">
                <p className="text-sm text-ink-2">
                  {mockUser
                    ? 'Sample period'
                    : isStale(stats)
                      ? `Last 30 days · ${stats.reporting!.window_days - stats.reporting!.unlogged_days_in_window} of ${stats.reporting!.window_days} days logged`
                      : 'Last 30 days'}
                </p>

                <dl className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
                  <div className="rounded-lg bg-raised px-3 sm:px-4 py-3 sm:py-3.5 min-w-0">
                    <dt className="text-xs text-ink-2">Income</dt>
                    <dd className="mt-1 text-lg sm:text-2xl font-semibold text-ink tabular-nums leading-tight">{inr(effectiveMonthlyIncome)}</dd>
                    <dd className="text-xs text-ink-3">per month</dd>
                  </div>
                  <div className="rounded-lg bg-raised px-3 sm:px-4 py-3 sm:py-3.5 min-w-0">
                    <dt className="text-xs text-ink-2">Spent</dt>
                    <dd className="mt-1 text-lg sm:text-2xl font-semibold text-ink tabular-nums leading-tight" aria-label={inr(stats.total_spent)}>{inr(animatedSpent)}</dd>
                    <dd className="text-xs text-ink-3">{mockUser ? 'sample period' : 'last 30 days'}</dd>
                  </div>
                  <div className="rounded-lg bg-side px-3 sm:px-4 py-3 sm:py-3.5 text-white min-w-0">
                    <dt className="text-xs text-side-ink">Saved</dt>
                    <dd className="mt-1 text-lg sm:text-2xl font-semibold tabular-nums leading-tight">
                      {effectiveMonthlyIncome - stats.total_spent < 0 ? '−' : ''}{inr(Math.abs(effectiveMonthlyIncome - stats.total_spent))}
                    </dd>
                    <dd className="text-xs text-side-ink tabular-nums">
                      {stats.savings_rate.toFixed(1)}%<span className="hidden sm:inline"> of income,{' '}
                      {stats.savings_rate >= savingsGoal ? `meets the ${savingsGoal}% goal` : `below the ${savingsGoal}% goal`}</span>
                    </dd>
                  </div>
                </dl>

                <div className="mt-5">
                  <CompositionBar
                    income={effectiveMonthlyIncome}
                    spent={stats.total_spent}
                    goalPct={savingsGoal}
                    meetsGoal={stats.savings_rate >= savingsGoal}
                  />
                </div>

                <p className="mt-6 text-base leading-relaxed text-ink max-w-[52ch]">
                  {forecastSentence(stats)}
                </p>
                <p className="mt-1.5 text-xs text-ink-3" title={stats.forecast_reason ?? undefined}>
                  {forecastMethodLabel(stats.forecast_model, stats.forecast_reason)}
                  {typeof stats.forecast_lower_30_days === 'number' && typeof stats.forecast_upper_30_days === 'number' && (
                    <>, likely between {forecastBandLabel(stats.forecast_lower_30_days, stats.forecast_upper_30_days)}</>
                  )}
                </p>
              </div>

              <div className="flex flex-row lg:flex-col items-center justify-around lg:justify-start gap-6 p-6 sm:p-8 border-t lg:border-t-0 lg:border-l border-line lg:min-w-[232px]">
                <div className="text-center">
                  <HealthArc score={stats.health_score} />
                  <p className="mt-2 text-sm font-medium text-ink">{healthLabel(stats.health_score)}</p>
                  <p className="text-micro text-ink-3">Financial health</p>
                </div>

                <div className="text-center lg:pt-5 lg:border-t lg:border-line lg:w-full">
                  <p className={`text-3xl font-semibold leading-none ${recentUnusual > 0 ? 'text-neg' : 'text-ink'}`}>
                    {recentUnusual}
                  </p>
                  <p className="mt-1.5 text-xs text-ink-2">unusual {recentUnusual === 1 ? 'transaction' : 'transactions'}</p>
                  <p className="text-micro text-ink-3">{mockUser ? 'in the sample' : 'in the last 30 days'}</p>
                </div>
              </div>
            </div>
          </section>

          {/* 3. ANALYTICS & VISUALIZATION SECTION (2-COLUMN GRID) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Where it went: a ranked list by default, because ranking and
                exact shares are what a reader wants here and a ring hides
                both. The donut stays available as a second view. */}
            <div className="bg-surface p-5 rounded-lg border border-line flex flex-col">
              <div className="flex justify-between items-start gap-3 mb-5">
                <div>
                  <h2 className="text-lg font-semibold text-ink">Where it went</h2>
                  <p className="text-xs text-ink-3 mt-0.5">Spending by category, last 30 days</p>
                </div>

                <div className="flex items-center bg-sunken p-0.5 rounded-md border border-line shrink-0">
                  {([
                    { key: 'bar' as const, label: 'Ranked', Icon: BarChart2 },
                    { key: 'donut' as const, label: 'Share', Icon: PieIcon }
                  ]).map(o => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setCategoryChartType(o.key)}
                      aria-pressed={categoryChartType === o.key}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-micro transition-colors ${
                        categoryChartType === o.key ? 'bg-raised text-ink font-medium' : 'text-ink-3 hover:text-ink-2'
                      }`}
                    >
                      <o.Icon className="w-3 h-3" />
                      <span>{o.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {categoryData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-ink-3 text-xs">
                  No spending in the last 30 days.
                </div>
              ) : categoryChartType === 'bar' ? (
                <ul className="space-y-4 flex-1">
                  {categoryData.map(cat => {
                    const share = categoryTotal > 0 ? (cat.value / categoryTotal) * 100 : 0;
                    const width = categoryMax > 0 ? (cat.value / categoryMax) * 100 : 0;
                    return (
                      <li key={cat.name}>
                        <div className="flex items-baseline justify-between gap-3 text-xs mb-1.5">
                          <span className="flex items-center gap-2 text-ink font-medium">
                            <CategoryBadge name={cat.name} size="sm" />
                            {cat.name}
                          </span>
                          <span className="text-right">
                            <span className="text-ink">{inr(cat.value)}</span>
                            <span className="text-ink-3 ml-2">{share.toFixed(0)}%</span>
                          </span>
                        </div>
                        <div className="h-2.5 rounded-xs bg-sunken overflow-hidden">
                          <div
                            className="h-full rounded-r-[4px]"
                            style={{ width: `${width}%`, backgroundColor: categoryColor(cat.name) }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <>
                  <div className="h-64 sm:h-72 w-full relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: C.raised, borderRadius: '8px',
                            border: `1px solid ${C.line}`, color: C.ink, fontSize: '12px'
                          }}
                          formatter={(val: number) => [inr(val), 'Spent']}
                        />
                        <Pie
                          data={categoryData}
                          cx="50%" cy="50%"
                          innerRadius={66} outerRadius={92}
                          paddingAngle={2}
                          dataKey="value"
                          stroke={C.surface}
                          strokeWidth={2}
                        >
                          {categoryData.map(entry => (
                            <Cell key={`cell-${entry.name}`} fill={categoryColor(entry.name)} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>

                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xs text-ink-3">Spent</span>
                      <span className="text-2xl font-semibold text-ink mt-0.5">{totalSpendFormatted}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-line">
                    {categoryData.map(cat => (
                      <span
                        key={cat.name}
                        className="flex items-center gap-1.5 pl-1 pr-2.5 py-1 bg-sunken rounded-full border border-line text-micro"
                      >
                        <CategoryBadge name={cat.name} size="sm" />
                        <span className="text-ink font-medium">{cat.name}</span>
                        <span className="text-ink-3">{inrShort(cat.value)}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Spending pace: last 30 days against the 30 days before */}
            <div className="bg-surface p-5 rounded-lg border border-line flex flex-col justify-between">
              <div className="flex justify-between items-start gap-4 mb-4">
                <div>
                  <h2 className="text-base font-semibold text-ink">Spending pace</h2>
                  <p className="text-xs text-ink-2 mt-0.5">Running total, last 30 days against the 30 days before</p>
                </div>
                {pace?.hasPrevious && (
                  <p className={`text-sm font-semibold text-right ${pace.diff <= 0 ? 'text-pos' : 'text-neg'}`}>
                    {inr(Math.abs(pace.diff))} {pace.diff <= 0 ? 'under' : 'over'}
                    <span className="block text-[11px] font-normal text-ink-2">the 30 days before</span>
                  </p>
                )}
              </div>

              <div className="h-64 sm:h-72 w-full">
                {!pace || pace.total === 0 ? (
                  <div className="h-full flex items-center justify-center text-ink-2 text-xs">
                    No spending in the last 30 days.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={pace.points} margin={{ top: 10, right: 10, left: -5, bottom: 0 }}>
                      <defs>
                        <linearGradient id="paceGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={C.accent} stopOpacity={0.35} />
                          <stop offset="95%" stopColor={C.accent} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={C.line} strokeWidth={1} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.ink2 }} axisLine={{ stroke: C.line }} tickLine={false} interval={6} />
                      <YAxis
                        tick={{ fontSize: 11, fill: C.ink2 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={val => `₹${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: C.raised, borderRadius: '8px', border: `1px solid ${C.line}`, color: C.ink, fontSize: '11px' }}
                        formatter={(val: number, name: string) => [inr(val), name === 'current' ? 'Last 30 days' : 'The 30 days before']}
                      />
                      {pace.hasPrevious && (
                        <Area type="monotone" dataKey="previous" stroke={C.ink3} strokeDasharray="5 4" strokeWidth={2} fill="none" dot={false} isAnimationActive={false} />
                      )}
                      <Area type="monotone" dataKey="current" stroke={C.accent} strokeWidth={2} fill="url(#paceGradient)" dot={false} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-3 border-t border-line text-xs text-ink-2">
                <span className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-accent rounded" />Last 30 days</span>
                  {pace?.hasPrevious && (
                    <span className="flex items-center gap-1.5"><span className="w-3 border-t border-dashed border-ink-2" />The 30 days before</span>
                  )}
                </span>
                <span className="text-ink font-medium">
                  {inr(pace?.total ?? 0)}{pace?.hasPrevious ? ` vs ${inr(pace.previousTotal)}` : ''}
                </span>
              </div>
            </div>
          </div>

          {/* 1.5. AI INSIGHTS PANEL */}
          <div id="ai-insights-panel" className="bg-surface rounded-lg border border-line p-5 space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
                <h2 className="text-sm font-semibold tracking-tight text-ink">Insights</h2>
                {insightsHasKey !== null && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-raised text-ink-2 border border-line">
                    {insightsHasKey ? 'Written by Gemini' : 'Built-in summary'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 sm:gap-3">
                {lastGeneratedTime && (
                  <span className="text-[11px] text-ink-2 hidden sm:inline">
                    {lastGeneratedTime.includes(':') ? `Generated at ${lastGeneratedTime}` : lastGeneratedTime}
                  </span>
                )}
                <button
                  id="btn-refresh-insights"
                  type="button"
                  onClick={() => fetchInsights(true)}
                  disabled={insightsLoading}
                  className="flex items-center gap-1.5 text-xs text-ink hover:text-ink px-2.5 py-1 rounded-lg bg-raised hover:bg-line border border-line transition-colors disabled:opacity-50 cursor-pointer"
                  title="Generate new insights from your latest data"
                >
                  <RefreshCw className={`w-3 h-3 ${insightsLoading ? 'animate-spin text-accent' : 'text-ink-2'}`} />
                  <span>Refresh insights</span>
                </button>
              </div>
            </div>

            {/* Insights Content */}
            {insightsLoading ? (
              <div className="space-y-2.5 py-1">
                <div className="h-4 bg-raised rounded-md animate-pulse w-11/12" />
                <div className="h-4 bg-raised rounded-md animate-pulse w-full" />
                <div className="h-4 bg-raised rounded-md animate-pulse w-4/5" />
              </div>
            ) : insightsError ? (
              <div className="p-3 rounded-lg border bg-neg/10 border-neg/30 text-neg text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-neg flex-shrink-0" />
                  <span>{insightsError}</span>
                </div>
                <button 
                  onClick={() => fetchInsights(true)} 
                  className="underline text-neg hover:text-ink text-xs cursor-pointer font-medium"
                >
                  Retry
                </button>
              </div>
            ) : insights.length > 0 ? (
              <div className="space-y-2.5">
                {insights.map((insight, idx) => (
                  <div key={idx} className="flex items-start gap-3 text-xs text-ink leading-relaxed group">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5 flex-shrink-0 group-hover:scale-125 transition-transform" />
                    <p className="flex-1 text-ink">{insight}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-2 text-xs text-ink-2">
                No insights yet. Select Refresh insights to generate them.
              </div>
            )}

            {/* API Key prompt if not configured */}
            {insightsHasKey === false && (
              <div className="pt-2.5 border-t border-line flex items-center justify-between text-xs text-ink-2">
                <div className="flex items-center gap-2">
                  <Info className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                  <span>These come from built-in rules. Set <code className="text-accent bg-canvas border border-line px-1.5 py-0.5 rounded font-mono text-[11px]">GEMINI_API_KEY</code> on the server to have Gemini write them.</span>
                </div>
              </div>
            )}
          </div>

        </section>
        )}

        {/* FORECAST */}
        {show('forecast') && (
        <section id="next-month" aria-label="Forecast" className={`scroll-mt-32 space-y-8 ${mockUser ? 'py-16 border-t border-line' : 'pt-8 pb-16'}`}>
          <SectionHeading title="Forecast" lead="What your spending is likely to be over the four weeks after your latest transaction, and how that number is made." />
          <ForecastSection stats={stats} />
        </section>
        )}

        {/* SAVINGS PLANNER */}
        {show('planner') && (
        <section id="what-if" aria-label="Savings planner" className={`scroll-mt-32 space-y-8 ${mockUser ? 'py-16 border-t border-line' : 'pt-8 pb-16'}`}>
          <SectionHeading title="Savings planner" lead="Set a savings goal, try a change before you make it, and see the plan that reaches the goal with the least effort." />
          {token && !mockUser ? (
            <SimulatorPanel token={token} />
          ) : (
            <p className="text-sm text-ink-2">The simulator works on your own account's data, so it is not available for sample users.</p>
          )}
        </section>
        )}

        {/* BUDGET, ALERTS AND SUMMARY (part of the overview) */}
        {show('overview') && (
        <section id="details" aria-label="Budget, alerts and summary" className="scroll-mt-32 py-16 border-t border-line space-y-6">
          <SectionHeading title="Budget, alerts and summary" lead="Where the last 30 days stand against the 50/30/20 rule, anything worth a second look, and a written summary." />
          {/* 4. SMART BUDGET & OUTLIER SURVEILLANCE (2-COLUMN GRID) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Smart Budget Allocation (50/30/20 Heuristic) */}
            <div className="bg-surface p-5 rounded-lg border border-line flex flex-col">
              <div className="flex justify-between items-center mb-5">
                <div>
                  <h2 className="text-lg font-semibold text-ink">Budget, last 30 days</h2>
                  <p className="text-xs text-ink-2 mt-0.5">50/30/20 rule: half of income for needs, 30% for wants, 20% saved</p>
                </div>
              </div>

              <div className="flex-1">
                {budgetAllocation.map(item => {
                  const isSavings = item.name === 'Savings';
                  const share = item.current / Math.max(item.target, 1);
                  const over = !isSavings && item.current > item.target;
                  const met = isSavings && item.current >= item.target;
                  const shortfall = isSavings && item.current < item.target;
                  // Plain words instead of a bare percentage: savings above
                  // target is good news, spending above its share is not, and
                  // neither is ever shown as "500%".
                  const status = isSavings
                    ? met
                      ? `${inr(item.current - item.target)} above the ${inr(item.target)} target`
                      : `${inr(item.target - item.current)} short of the ${inr(item.target)} target`
                    : over
                      ? `${inr(item.current - item.target)} over its ${inr(item.target)} share`
                      : `${inr(item.target - item.current)} left of ${inr(item.target)}`;
                  return (
                    <div key={item.name} className="py-3 border-b border-line last:border-b-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-ink font-medium">
                          {item.name} <span className="text-xs text-ink-3 font-normal">{item.subtitle}</span>
                        </span>
                        <span className="text-sm text-ink font-semibold tabular-nums">{inr(item.current)}{isSavings ? ' saved' : ''}</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-raised overflow-hidden" aria-hidden="true">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, Math.max(0, share * 100))}%`,
                            backgroundColor: over ? C.neg : shortfall ? C.caution : met ? C.pos : C.ink2
                          }}
                        />
                      </div>
                      <p className={`mt-1.5 text-xs ${over ? 'text-neg' : shortfall ? 'text-caution' : met ? 'text-pos' : 'text-ink-2'}`}>
                        {status}
                      </p>
                    </div>
                  );
                })}

                <div className="pt-3 flex items-center justify-between text-xs text-ink-2">
                  <span>Based on monthly income of {inr(effectiveMonthlyIncome)}</span>
                </div>
              </div>
            </div>

            {/* Unusual transactions: a review list, not an alarm. */}
            <div className="bg-surface rounded-lg border border-line p-5 flex flex-col">
              <h2 className="text-lg font-semibold text-ink">Worth a second look</h2>
              <p className="text-xs text-ink-2 mt-0.5">
                Flagged when an amount is more than 2.5 standard deviations from that category's average. Unusual is not the same as wrong.
              </p>

              {primaryAnomalies.length === 0 ? (
                <p id="no-anomalies-empty-state" className="mt-5 text-sm text-ink-2">
                  Nothing unusual: every transaction is within the normal range for its category.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {primaryAnomalies.map(anomaly => {
                    const key = String(anomaly.id);
                    // A local entry (including null after Undo) wins over the value loaded with the page.
                    const review = key in reviews ? reviews[key] : (anomaly as Transaction).review ?? null;
                    return (
                      <li key={anomaly.id} className="py-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm text-ink font-medium truncate">{anomaly.merchant}</span>
                          <span className="text-sm text-ink font-semibold tabular-nums whitespace-nowrap">{inr(anomaly.amount)}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-ink-2">
                          {anomaly.category}, {anomaly.date ? new Date(anomaly.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'date unknown'}. {deviationSentence(anomaly, transactions)}
                        </p>
                        <div className="mt-2 flex items-center gap-3 text-xs">
                          {review ? (
                            <>
                              <span className={review === 'expected' ? 'text-pos' : 'text-ink-2'}>
                                {review === 'expected' ? 'You marked this as expected.' : 'You dismissed this.'}
                              </span>
                              {!mockUser && (
                                <button type="button" onClick={() => setReview(anomaly.id, null)} className="text-ink-2 hover:text-ink underline-offset-2 hover:underline">
                                  Undo
                                </button>
                              )}
                            </>
                          ) : mockUser ? (
                            <span className="text-ink-3">Sample data: reviews are not saved.</span>
                          ) : (
                            <>
                              <span className="text-ink-2">Expected?</span>
                              <button
                                id={`anomaly-verify-${anomaly.id}`}
                                type="button"
                                onClick={() => setReview(anomaly.id, 'expected')}
                                className="px-2.5 py-1 rounded-md border border-line-strong text-ink hover:border-pos hover:text-pos"
                              >
                                Yes, expected
                              </button>
                              <button
                                id={`anomaly-dismiss-${anomaly.id}`}
                                type="button"
                                onClick={() => setReview(anomaly.id, 'dismissed')}
                                className="px-2.5 py-1 rounded-md text-ink-2 hover:text-ink"
                              >
                                Dismiss
                              </button>
                            </>
                          )}
                        </div>
                        {reviewError === String(anomaly.id) && (
                          <p role="alert" className="mt-1 text-xs text-neg">Could not save that. Check your connection and try again.</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {!mockUser && (
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <h2 className="text-lg font-semibold text-ink">Latest transactions</h2>
              </div>
              <TransactionsView
                compact
                transactions={transactions as Transaction[]}
                onEdit={setEditingTx}
                onAdd={method => { setModalInitialMethod(method); setIsModalOpen(true); }}
                onShowAll={() => go('transactions')}
              />
            </div>
          )}

          {/* 5. JOURNAL LEDGER (TRANSACTION TABLE) - sample users in the admin view */}
          {mockUser && (
          <div className="bg-surface rounded-lg border border-line overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-line flex justify-between items-center bg-canvas/50">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-semibold text-ink">Transactions</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-raised text-ink-2 border border-line">
                  {Array.isArray(transactions) ? transactions.length : 0} total
                </span>
              </div>
              <div className="flex items-center gap-2">
                {!mockUser && (
                  <>
                    <button
                      id="btn-scan-receipt-table"
                      onClick={() => { setModalInitialMethod('ocr'); setIsModalOpen(true); }}
                      className="flex items-center gap-1.5 text-xs text-ink hover:text-ink px-2.5 py-1 rounded-lg bg-raised hover:bg-line border border-line hover:border-accent transition-colors cursor-pointer font-medium"
                    >
                      <Camera className="w-3 h-3 text-accent" />
                      <span>Scan Receipt</span>
                    </button>
                    <button
                      id="btn-add-entry-table"
                      onClick={() => { setModalInitialMethod('manual'); setIsModalOpen(true); }}
                      className="flex items-center gap-1 text-xs text-canvas px-2.5 py-1 rounded-lg bg-accent hover:bg-accent-hi transition-colors cursor-pointer font-medium"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add transaction</span>
                    </button>
                  </>
                )}
                {mockUser && (
                  <span className="text-xs text-ink-2">
                    Newest first
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto max-h-[380px] scrollbar-thin scrollbar-thumb-line scrollbar-track-transparent">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-xs font-semibold text-ink-2 bg-canvas sticky top-0 backdrop-blur-sm z-10 border-b border-line">
                    <th className="px-5 py-3">Merchant</th>
                    <th className="px-5 py-3">Category</th>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    {!mockUser && <th className="px-3 py-3"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-line">
                  {Array.isArray(transactions) && transactions.length > 0 ? (
                    transactions.map(t => {
                      const isAnomaly = (t as MockTransaction)?.isAnomaly;
                      const isIncome = (t as MockTransaction)?.type === 'income';

                      return (
                        <tr 
                          key={t.id} 
                          className={`hover:bg-raised/40 transition-colors ${
                            isAnomaly 
                              ? 'bg-neg/5' 
                              : isIncome
                              ? 'bg-pos/5'
                              : ''
                          }`}
                        >
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <CategoryBadge name={t.category} />
                              <span className={`font-medium ${isAnomaly ? 'text-neg' : isIncome ? 'text-pos' : 'text-ink'}`}>
                                {t.merchant}
                              </span>
                              {isAnomaly && (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-medium bg-neg/10 text-neg border border-neg/30">
                                  Unusual
                                </span>
                              )}
                              {isIncome && (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-medium bg-pos/10 text-pos border border-pos/30">
                                  Income
                                </span>
                              )}
                            </div>
                            {(t as MockTransaction)?.notes && (
                              <div className="text-[11px] text-ink-2 mt-0.5">
                                {(t as MockTransaction).notes}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3.5">
                            <span className="bg-raised text-ink-2 text-xs px-2.5 py-0.5 rounded-full border border-line">
                              {t.category}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-ink-2 text-xs">
                            {new Date(t.date).toLocaleDateString('en-IN', { month: 'short', day: '2-digit', year: 'numeric' })}
                          </td>
                          <td className={`px-5 py-3.5 text-right font-medium text-xs ${
                            isIncome ? 'text-pos' : isAnomaly ? 'text-neg' : 'text-ink'
                          }`}>
                            {isIncome ? '+' : ''}₹{t.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                          {!mockUser && (
                            <td className="px-3 py-3.5 text-right">
                              <button
                                type="button"
                                onClick={() => setEditingTx(t)}
                                className="text-xs text-ink-2 hover:text-ink px-2 py-1 rounded-md hover:bg-raised"
                                aria-label={`Edit ${t.merchant}, ₹${t.amount}`}
                              >
                                Edit
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={mockUser ? 4 : 5} className="px-5 py-8 text-center text-ink-2">
                        No transactions recorded yet. Click &ldquo;Add Entry&rdquo; or &ldquo;Scan Receipt&rdquo; to add your first transaction.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          )}

          {/* 6. AI MONTHLY REPORT */}
          <div id="ai-monthly-report-section" className="bg-surface rounded-lg border border-line p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-line">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
                    <FileText className="w-3.5 h-3.5" />
                  </div>
                  <h2 className="text-base font-semibold tracking-tight text-ink">Monthly summary</h2>
                  {reportHasKey !== null && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-raised text-ink-2 border border-line">
                      {reportHasKey ? 'Written by Gemini' : 'Built-in summary'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink-2">
                  A short note on your month: income, spending, savings rate, top category and one suggestion.
                </p>
              </div>

              <button
                id="btn-generate-monthly-report"
                type="button"
                onClick={generateMonthlyReport}
                disabled={reportLoading}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hi text-canvas rounded-lg text-xs font-medium transition-all disabled:opacity-50 flex-shrink-0 cursor-pointer"
              >
                {reportLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Writing summary…</span>
                  </>
                ) : (
                  <>
                    <FileText className="w-3.5 h-3.5" />
                    <span>{report ? 'Write a new summary' : 'Write summary'}</span>
                  </>
                )}
              </button>
            </div>

            {/* Report Body / States */}
            {reportLoading ? (
              <div className="p-5 bg-canvas rounded-lg border border-line space-y-3 animate-pulse">
                <div className="h-3.5 bg-raised rounded w-11/12" />
                <div className="h-3.5 bg-raised rounded w-full" />
                <div className="h-3.5 bg-raised rounded w-4/5" />
                <div className="h-3.5 bg-raised rounded w-9/12" />
                <div className="flex items-center gap-2 pt-1 text-[11px] text-ink-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                  <span>Writing your summary…</span>
                </div>
              </div>
            ) : reportError ? (
              <div className="p-4 rounded-lg border bg-neg/10 border-neg/30 text-neg text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-neg flex-shrink-0" />
                  <span>{reportError}</span>
                </div>
                <button 
                  onClick={generateMonthlyReport} 
                  className="underline text-neg hover:text-ink text-xs font-medium cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : report ? (
              <div className="p-5 bg-canvas rounded-lg border border-line space-y-3 relative">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-ink-2">Advisor Synthesis</span>
                    <span className="text-[10px] text-ink-2">• 4–6 sentence advisory note</span>
                  </div>
                  <button
                    id="btn-copy-monthly-report"
                    type="button"
                    onClick={handleCopyReport}
                    className="flex items-center gap-1.5 px-3 py-1 bg-raised hover:bg-line text-ink hover:text-ink border border-line rounded-lg text-xs font-medium transition-colors shadow-2xs cursor-pointer"
                    title="Copy report text to clipboard"
                  >
                    {reportCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-pos" />
                        <span className="text-pos font-medium">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-ink-2" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="text-xs sm:text-sm text-ink leading-relaxed pt-1 whitespace-pre-wrap">
                  {report}
                </div>

                {reportHasKey === false && (
                  <div className="pt-2 border-t border-line flex items-center gap-2 text-[11px] text-ink-2">
                    <Info className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                    <span>Synthesized via deterministic heuristics. Add your <code className="text-accent font-mono">GEMINI_API_KEY</code> in Settings for live model inference.</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-5 bg-canvas rounded-lg border border-dashed border-line flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
                <div>
                  <h3 className="text-xs font-medium text-ink">No summary yet</h3>
                  <p className="text-xs text-ink-2 mt-0.5">
                    Use Write summary above for a 4–6 sentence note on the last 30 days.
                  </p>
                </div>
                
              </div>
            )}
          </div>

        </section>
        )}

        {!mockUser && view === 'transactions' && (
          <section aria-label="Transactions" className="pt-8 pb-16 space-y-6">
            <SectionHeading title="Transactions" lead="Everything you have logged. Search, filter by category or date, sort, and edit any entry." />
            <TransactionsView
              transactions={transactions as Transaction[]}
              onEdit={setEditingTx}
              onAdd={method => { setModalInitialMethod(method); setIsModalOpen(true); }}
            />
          </section>
        )}

        {!mockUser && view === 'settings' && token && (
          <section aria-label="Settings" className="pt-8 pb-16 space-y-8">
            <SectionHeading title="Settings" lead="Your income, savings goal, password, and the data and models behind FinAI." />
            <SettingsView
              token={token}
              username={username}
              isAdmin={isAdmin}
              income={stats.monthly_income ?? effectiveMonthlyIncome}
              target={stats.target_savings_percent ?? 20}
              spentLast30={stats.total_spent}
              windowComplete={stats.reporting?.complete}
              transactions={transactions as Transaction[]}
              synthetic={stats.synthetic_demo_data}
              dataSource={stats.data_source ?? null}
              onSaved={fetchData}
            />
          </section>
        )}
        </>)}

        {/* SUBTLE DEMO NOTE IF IN ADMIN DETAIL VIEW */}
        {mockUser && (
          <div className="p-4 bg-surface rounded-lg border border-line flex items-center justify-between gap-3 text-xs text-ink-2">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-accent flex-shrink-0" />
              <span>Sample user view</span>
            </div>
            {onBackToAdmin && (
              <button 
                onClick={onBackToAdmin}
                className="text-accent hover:text-accent-hi text-xs font-medium flex items-center gap-1 transition-colors"
              >
                Return to cohort directory <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* Transaction Modal (User Mode) */}
        {!mockUser && (
          <TransactionModal 
            isOpen={isModalOpen} 
            initialMethod={modalInitialMethod}
            onClose={() => setIsModalOpen(false)} 
            onTransactionAdded={fetchData}
            token={token || ''} 
          />
        )}

        {!mockUser && token && (
          <EditTransactionDialog
            transaction={editingTx}
            token={token}
            onClose={() => setEditingTx(null)}
            onChanged={fetchData}
          />
        )}

        {/* FinAI Chat Assistant */}
        {!mockUser && isChatOpen && token && (
          <ChatAssistant token={token} onClose={() => setIsChatOpen(false)} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// First screen for an account with no transactions. Nothing here is a
// computed figure except the income the person entered at sign-up.
// ---------------------------------------------------------------------------

// Shown while the account has no monthly income set (new sign-ups).
function IncomePrompt({ token, onSaved }: { token: string; onSaved: () => unknown }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const n = Number(value);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || !Number.isFinite(n) || n <= 0) return setError('Enter an amount greater than zero.');
    if (n > 10_000_000) return setError('Enter at most ₹1,00,00,000.');
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ monthly_income: Math.round(n * 100) / 100 })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not save. Try again.');
      await onSaved();
    } catch (err: any) {
      setError(err?.message || 'Could not save. Try again.');
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} aria-labelledby="income-prompt-title" className="mt-8 rounded-lg border border-accent/40 bg-surface p-5 flex flex-col sm:flex-row sm:items-end gap-4">
      <div className="flex-1 min-w-0">
        <h2 id="income-prompt-title" className="text-base font-semibold text-ink">What is your monthly income?</h2>
        <p className="mt-1 text-sm text-ink-2">Take-home pay for a typical month. Your savings rate and goals are worked out from it; you can change it in Settings.</p>
        {error && <p role="alert" className="mt-2 text-sm text-neg">{error}</p>}
      </div>
      <label className="sr-only" htmlFor="income-prompt-input">Monthly income in rupees</label>
      <div className="flex gap-2">
        <div className="relative">
          <span className="absolute inset-y-0 left-3 flex items-center text-sm text-ink-2" aria-hidden="true">₹</span>
          <input
            id="income-prompt-input"
            type="number"
            inputMode="decimal"
            min="1"
            step="any"
            value={value}
            onChange={e => setValue(e.target.value)}
            className="w-40 pl-7 pr-3 py-2.5 rounded-lg border border-line bg-raised text-ink text-sm tabular-nums focus:outline-none focus:border-accent"
          />
        </div>
        <button type="submit" disabled={busy} className="px-4 py-2.5 rounded-lg bg-accent text-canvas text-sm font-medium hover:bg-accent-hi disabled:opacity-60">
          {busy ? 'Saving' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function NewAccountWelcome({ income, onAdd }: { income: number; onAdd: (method: 'manual' | 'ocr' | 'voice') => void }) {
  const steps: { when: string; what: string }[] = [
    {
      when: 'Your first entry',
      what: income > 0
        ? `Spending for the last 30 days by category, your savings rate against ${inr(income)} a month, and the What-if simulator.`
        : 'Spending for the last 30 days by category, your savings rate against your monthly income, and the What-if simulator.'
    },
    {
      when: 'A few entries in a category',
      what: 'Alerts when a transaction is far from what you usually spend there. They are prompts to review, not verdicts.'
    },
    {
      when: '26 weeks of history',
      what: 'Forecasts from Chronos-2. Until then the forecast is an 8-week average, and it says so.'
    }
  ];

  return (
    <section aria-labelledby="welcome-title" className="pt-10 pb-16 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-10 lg:gap-16 items-start">
      <div>
        <h1 id="welcome-title" className="text-3xl sm:text-4xl font-semibold tracking-tight text-ink">Your account is ready</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2 max-w-[52ch]">
          There is nothing to analyse yet. Add what you have spent recently, and FinAI builds the picture from it.
          The more days you log, the more it can tell you.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            id="welcome-add-transaction"
            type="button"
            onClick={() => onAdd('manual')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-canvas text-sm font-medium hover:bg-accent-hi"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add a transaction
          </button>
          <button
            type="button"
            onClick={() => onAdd('ocr')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-line bg-raised text-ink text-sm hover:border-line-strong"
          >
            <Camera className="w-4 h-4 text-accent" aria-hidden="true" />
            Scan a receipt
          </button>
          <button
            type="button"
            onClick={() => onAdd('voice')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-line bg-raised text-ink text-sm hover:border-line-strong"
          >
            Say it instead
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold text-ink">What appears as you log</h2>
        <ol className="mt-5 space-y-5">
          {steps.map((step, i) => (
            <li key={step.when} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
              <span className="w-7 h-7 rounded-full border border-line-strong text-xs text-ink-2 flex items-center justify-center tabular-nums" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-ink">{step.when}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">{step.what}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
