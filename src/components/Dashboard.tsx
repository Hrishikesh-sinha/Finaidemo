import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { 
  TrendingUp, TrendingDown, DollarSign, Wallet, 
  Activity, AlertTriangle, MessageSquare, Plus,
  ArrowLeft, ArrowRight, ShieldAlert,
  Info, PieChart as PieIcon, BarChart2, Calendar, Check,
  Sparkles, CheckCircle2, XCircle, ArrowUpRight, Shield,
  FileText, Copy, RefreshCw, Loader2, Camera
} from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, AreaChart, Area, CartesianGrid
} from 'recharts';
import { DashboardStats, Transaction, MockUser, MockTransaction } from '../types';
import { TransactionModal } from './TransactionModal';
import { ChatAssistant } from './ChatAssistant';

interface Props {
  token?: string;
  mockUser?: MockUser;
  onBackToAdmin?: () => void;
  onSelectUser?: (user: MockUser) => void;
  allMockUsers?: MockUser[];
}

// Harmonious portfolio fintech color palette for category distribution
const CATEGORY_COLORS = [
  '#4A9EFF', // Blue Accent
  '#3FB950', // Positive Green
  '#F59E0B', // Muted Amber
  '#8B949E', // Muted Grey
  '#A78BFA', // Violet
  '#F85149', // Muted Red
  '#58A6FF', // Sky Blue
  '#2EA043', // Forest Green
];

export function Dashboard({ token, mockUser, onBackToAdmin, onSelectUser, allMockUsers }: Props) {
  const [stats, setStats] = useState<DashboardStats | null>(mockUser ? mockUser.stats : null);
  const [transactions, setTransactions] = useState<Transaction[]>(mockUser ? mockUser.transactions : []);
  const [loading, setLoading] = useState(!mockUser);
  const [categoryChartType, setCategoryChartType] = useState<'donut' | 'bar'>('donut');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInitialMethod, setModalInitialMethod] = useState<'manual' | 'ocr'>('manual');
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Anomaly action state for quick Verify / Dismiss
  const [anomalyStatus, setAnomalyStatus] = useState<Record<string | number, 'verified' | 'dismissed'>>({});

  // Synchronize state if mockUser prop changes
  useEffect(() => {
    if (mockUser) {
      setStats(mockUser.stats);
      setTransactions(mockUser.transactions);
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
      const s = await statsRes.json();
      const t = await txRes.json();
      setStats(s);
      setTransactions(t);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!mockUser && token) {
      fetchData();
    }
  }, [token, mockUser]);

  // Group transactions by category for chart (excluding income credits)
  const categoryData = useMemo(() => {
    if (!transactions) return [];
    const expenseTxs = transactions.filter(t => (t as MockTransaction).type !== 'income');
    const grouped = expenseTxs.reduce((acc, t) => {
      acc[t.category] = (acc[t.category] || 0) + t.amount;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value: Number(value) }))
      .sort((a, b) => b.value - a.value);
  }, [transactions]);

  // Chronological spending trend line data
  const trendData = useMemo(() => {
    if (!transactions || transactions.length === 0) return [];
    const expenseTxs = [...transactions]
      .filter(t => (t as MockTransaction).type !== 'income')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let cumulative = 0;
    return expenseTxs.map(t => {
      cumulative += t.amount;
      const d = new Date(t.date);
      const day = d.getDate();
      const month = d.toLocaleString('en-US', { month: 'short' });
      return {
        date: `${day} ${month}`,
        rawDate: t.date,
        merchant: t.merchant,
        category: t.category,
        amount: t.amount,
        cumulative: Math.round(cumulative)
      };
    });
  }, [transactions]);

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

  // Effective monthly income calculation
  const effectiveMonthlyIncome = useMemo(() => {
    if (mockUser) return mockUser.monthly_income;
    if (!stats) return 50000;
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
    const count = transactions?.length || 0;
    const firstTx = transactions?.[0]?.id || 'none';
    const total = stats?.total_spent || 0;
    return `${userKey}_${count}_${firstTx}_${total}`;
  }, [mockUser, token, transactions, stats?.total_spent]);

  // Fetch AI Insights with local caching
  const fetchInsights = async (forceRefresh = false) => {
    if (!financialContext) return;
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
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ context: financialContext })
      });

      if (!res.ok) {
        throw new Error(`Insights service returned HTTP ${res.status}`);
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
      setInsightsError('Unable to synthesize AI insights. Please check network connection.');
    } finally {
      setInsightsLoading(false);
    }
  };

  useEffect(() => {
    if (financialContext && !loading) {
      fetchInsights(false);
    }
  }, [txSignature, loading]);

  // Generate AI Monthly Report
  const generateMonthlyReport = async () => {
    if (!financialContext) return;
    setReportLoading(true);
    setReportError(null);
    setReportCopied(false);

    try {
      const res = await fetch('/api/ai/monthly-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ context: financialContext })
      });

      if (!res.ok) {
        throw new Error(`Advisory service returned HTTP ${res.status}`);
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
      setReportError('Unable to generate advisory report. Please verify connection or API key in Settings.');
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
      <div className="flex h-[calc(100vh-64px)] items-center justify-center bg-[#0D1117]">
        <div className="flex flex-col items-center gap-3">
          <Activity className="w-8 h-8 animate-spin text-[#4A9EFF]" />
          <span className="text-xs font-mono text-[#8B949E]">CALIBRATING LOCAL ML ENGINE...</span>
        </div>
      </div>
    );
  }

  // Smart budget calculations: 50/30/20 heuristic
  const budgetAllocation = [
    {
      name: 'Needs Target',
      subtitle: 'Bills, Groceries & Housing',
      ratio: '50%',
      target: effectiveMonthlyIncome * 0.5,
      current: categoryData.filter(c => ['Bills', 'Food', 'Transport'].includes(c.name)).reduce((sum, c) => sum + c.value, 0) || (stats.total_spent * 0.48),
      color: 'from-[#4A9EFF] to-[#3b8eed]',
      trackColor: 'bg-[#4A9EFF]',
      badge: '50% Target'
    },
    {
      name: 'Wants Target',
      subtitle: 'Shopping, Dining & Leisure',
      ratio: '30%',
      target: effectiveMonthlyIncome * 0.3,
      current: categoryData.filter(c => ['Shopping', 'Entertainment'].includes(c.name)).reduce((sum, c) => sum + c.value, 0) || (stats.total_spent * 0.28),
      color: 'from-[#A78BFA] to-[#8B5CF6]',
      trackColor: 'bg-[#A78BFA]',
      badge: '30% Target'
    },
    {
      name: 'Savings Target',
      subtitle: 'Emergency Buffer & Demat Inflow',
      ratio: '20%',
      target: effectiveMonthlyIncome * 0.2,
      current: Math.max(0, effectiveMonthlyIncome - stats.total_spent),
      color: 'from-[#3FB950] to-[#2ea043]',
      trackColor: 'bg-[#3FB950]',
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

  // Default demo anomaly if no anomalies detected in state, ensuring the prompt's surveillance card is demonstrated
  const primaryAnomalies = stats.anomalies && stats.anomalies.length > 0 
    ? stats.anomalies 
    : [
        {
          id: 'demo-anomaly-1',
          merchant: 'Blue Tokai Coffee',
          amount: 650,
          category: 'Food',
          date: '2026-09-06'
        }
      ];

  const handleVerify = (id: string | number) => {
    setAnomalyStatus(prev => ({ ...prev, [id]: 'verified' }));
  };

  const handleDismiss = (id: string | number) => {
    setAnomalyStatus(prev => ({ ...prev, [id]: 'dismissed' }));
  };

  return (
    <div className="min-h-screen bg-[#0D1117] text-[#E6EDF3] overflow-y-auto font-sans">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-6">
        
        {/* ADMIN DETAIL VIEW TOP BAR */}
        {mockUser ? (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#2A2F3A]">
              <div className="flex items-center gap-3">
                {onBackToAdmin && (
                  <button 
                    id="admin-back-to-users-btn"
                    onClick={onBackToAdmin}
                    className="flex items-center gap-2 px-3 py-1.5 bg-[#21262D] hover:bg-[#30363D] text-[#E6EDF3] rounded-lg text-xs font-medium border border-[#2A2F3A] transition-colors shadow-xs"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Cohort Directory</span>
                  </button>
                )}
                <span className="text-xs text-[#8B949E]">
                  Telemetry / Portfolio Detail / <strong className="text-[#E6EDF3] font-medium">{mockUser.name}</strong>
                </span>
              </div>

              {/* Quick Next/Previous User Buttons */}
              {allMockUsers && onSelectUser && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#8B949E] hidden md:inline">Quick Switch:</span>
                  {prevUser && (
                    <button
                      onClick={() => onSelectUser(prevUser)}
                      className="px-2.5 py-1 bg-[#161B22] hover:bg-[#21262D] text-[#E6EDF3] rounded-lg text-xs border border-[#2A2F3A] flex items-center gap-1.5 transition-colors"
                      title={`Previous: ${prevUser.name}`}
                    >
                      <ArrowLeft className="w-3 h-3 text-[#8B949E]" />
                      <span>{prevUser.name.split(' ')[0]}</span>
                    </button>
                  )}
                  {nextUser && (
                    <button
                      onClick={() => onSelectUser(nextUser)}
                      className="px-2.5 py-1 bg-[#161B22] hover:bg-[#21262D] text-[#E6EDF3] rounded-lg text-xs border border-[#2A2F3A] flex items-center gap-1.5 transition-colors"
                      title={`Next: ${nextUser.name}`}
                    >
                      <span>{nextUser.name.split(' ')[0]}</span>
                      <ArrowRight className="w-3 h-3 text-[#8B949E]" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* User Profile Header Banner */}
            <div className="bg-[#161B22] p-5 rounded-xl border border-[#2A2F3A] flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-lg ${mockUser.avatarColor} flex items-center justify-center font-bold text-base flex-shrink-0 text-white`}>
                  {mockUser.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h1 className="text-xl sm:text-2xl font-semibold text-[#E6EDF3] tracking-tight">{mockUser.name}</h1>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#21262D] text-[#8B949E] border border-[#2A2F3A]">
                      {mockUser.spending_pattern_title}
                    </span>
                    {mockUser.anomaly_flag.isFlagged && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-medium flex items-center gap-1.5 bg-[#F85149]/10 text-[#F85149] border border-[#F85149]/30">
                        <ShieldAlert className="w-3 h-3" />
                        {mockUser.anomaly_flag.badgeText}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#8B949E] mt-1">{mockUser.spending_pattern_description}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-[#8B949E]">
                    <span>Account: @{mockUser.username}</span>
                    <span>•</span>
                    <span>Monthly Inflow: ₹{mockUser.monthly_income.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="px-3.5 py-2 rounded-lg bg-[#0D1117] border border-[#2A2F3A] text-right">
                  <div className="text-[10px] uppercase tracking-wider text-[#8B949E] font-mono">Access Level</div>
                  <div className="text-xs font-medium text-[#3FB950] flex items-center gap-1.5 justify-end mt-0.5">
                    <Shield className="w-3 h-3" />
                    Admin Auditor
                  </div>
                </div>
              </div>
            </div>

            {/* Anomaly Highlight Banner if user has flagged spending */}
            {mockUser.anomaly_flag.isFlagged && (
              <div className="p-4 rounded-xl border flex items-start gap-3.5 bg-[#F85149]/10 border-[#F85149]/30 text-[#F85149]">
                <div className="w-8 h-8 rounded-lg bg-[#F85149]/10 border border-[#F85149]/30 flex items-center justify-center flex-shrink-0 mt-0.5 text-[#F85149]">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#F85149] flex items-center gap-2">
                    <span>Audit Telemetry Alert</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F85149]/15 border border-[#F85149]/30 font-medium">
                      {mockUser.anomaly_flag.badgeText}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-[#E6EDF3]">
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
                <h1 className="text-2xl font-bold tracking-tight text-[#E6EDF3]">Financial Telemetry</h1>
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#3FB950]/10 border border-[#3FB950]/30 text-[#3FB950] text-[11px] font-medium">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3FB950] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#3FB950]"></span>
                  </span>
                  <span>ML Engine Active</span>
                </div>
              </div>
              <p className="text-xs text-[#8B949E] mt-1">
                Real-time isolation forest anomaly surveillance, Prophet forecasting & heuristic budgeting
              </p>
            </div>
            
            <div className="flex items-center space-x-3">
              <button 
                id="btn-open-assistant"
                onClick={() => setIsChatOpen(true)}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-[#21262D] text-[#E6EDF3] hover:text-white rounded-full border border-[#2A2F3A] hover:border-[#8B949E]/40 hover:bg-[#30363D] transition-all text-xs font-medium shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#4A9EFF]" />
                <span>FinAI Assistant</span>
              </button>
              <button 
                id="btn-scan-receipt-header"
                onClick={() => { setModalInitialMethod('ocr'); setIsModalOpen(true); }}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#21262D] text-[#E6EDF3] hover:text-white rounded-lg border border-[#2A2F3A] hover:border-[#4A9EFF] hover:bg-[#30363D] transition-all text-xs font-medium shadow-xs cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5 text-[#4A9EFF]" />
                <span>Scan Receipt</span>
              </button>
              <button 
                id="btn-add-entry"
                onClick={() => { setModalInitialMethod('manual'); setIsModalOpen(true); }}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-[#4A9EFF] text-white rounded-lg font-medium hover:bg-[#3b8eed] transition-all text-xs shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Entry</span>
              </button>
            </div>
          </div>
        )}

        {/* 1.5. AI INSIGHTS PANEL */}
        <div id="ai-insights-panel" className="bg-[#161B22] rounded-xl border border-[#2A2F3A] p-5 shadow-sm space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-md bg-[#4A9EFF]/10 border border-[#4A9EFF]/20 flex items-center justify-center text-[#4A9EFF]">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <h2 className="text-sm font-semibold tracking-tight text-[#E6EDF3]">AI Insights</h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#4A9EFF]/10 text-[#4A9EFF] border border-[#4A9EFF]/30 font-medium">
                Gemini Intelligence
              </span>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {lastGeneratedTime && (
                <span className="text-[11px] text-[#8B949E] hidden sm:inline">
                  {lastGeneratedTime.includes(':') ? `Generated at ${lastGeneratedTime}` : lastGeneratedTime}
                </span>
              )}
              <button
                id="btn-refresh-insights"
                type="button"
                onClick={() => fetchInsights(true)}
                disabled={insightsLoading}
                className="flex items-center gap-1.5 text-xs text-[#E6EDF3] hover:text-white px-2.5 py-1 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#2A2F3A] transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
                title="Regenerate insights based on latest financial context"
              >
                <RefreshCw className={`w-3 h-3 ${insightsLoading ? 'animate-spin text-[#4A9EFF]' : 'text-[#8B949E]'}`} />
                <span>Refresh insights</span>
              </button>
            </div>
          </div>

          {/* Insights Content */}
          {insightsLoading ? (
            <div className="space-y-2.5 py-1">
              <div className="h-4 bg-[#21262D] rounded-md animate-pulse w-11/12" />
              <div className="h-4 bg-[#21262D] rounded-md animate-pulse w-full" />
              <div className="h-4 bg-[#21262D] rounded-md animate-pulse w-4/5" />
            </div>
          ) : insightsError ? (
            <div className="p-3 rounded-lg border bg-[#F85149]/10 border-[#F85149]/30 text-[#F85149] text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#F85149] flex-shrink-0" />
                <span>{insightsError}</span>
              </div>
              <button 
                onClick={() => fetchInsights(true)} 
                className="underline text-[#F85149] hover:text-white text-xs cursor-pointer font-medium"
              >
                Retry
              </button>
            </div>
          ) : insights.length > 0 ? (
            <div className="space-y-2.5">
              {insights.map((insight, idx) => (
                <div key={idx} className="flex items-start gap-3 text-xs text-[#E6EDF3] leading-relaxed group">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4A9EFF] mt-1.5 flex-shrink-0 group-hover:scale-125 transition-transform" />
                  <p className="flex-1 text-[#E6EDF3]">{insight}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-2 text-xs text-[#8B949E]">
              No insights generated yet. Click "Refresh insights" to analyze your latest financial context.
            </div>
          )}

          {/* API Key prompt if not configured */}
          {insightsHasKey === false && (
            <div className="pt-2.5 border-t border-[#2A2F3A] flex items-center justify-between text-xs text-[#8B949E]">
              <div className="flex items-center gap-2">
                <Info className="w-3.5 h-3.5 text-[#4A9EFF] flex-shrink-0" />
                <span>Operating with calculated fallback rules. Set your <code className="text-[#4A9EFF] bg-[#0D1117] border border-[#2A2F3A] px-1.5 py-0.5 rounded font-mono text-[11px]">GEMINI_API_KEY</code> in Settings to enable real-time model inference.</span>
              </div>
            </div>
          )}
        </div>

        {/* 2. SUMMARY CARDS (4-COLUMN GRID) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Total Outlay */}
          <div className="bg-[#161B22] p-5 rounded-xl border border-[#2A2F3A] hover:border-[#8B949E]/40 transition-colors shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium tracking-wider text-[#8B949E] uppercase">Total Outlay</span>
                <div className="w-7 h-7 bg-[#0D1117] rounded-lg border border-[#2A2F3A] flex items-center justify-center text-[#4A9EFF]">
                  <DollarSign className="w-3.5 h-3.5 text-[#4A9EFF]" />
                </div>
              </div>
              <p className="text-2xl font-bold tracking-tight text-[#E6EDF3]">
                ₹{stats.total_spent.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-[#2A2F3A] text-xs">
              <span className="text-[#8B949E] text-[11px]">Current billing cycle</span>
              <span className="text-[#4A9EFF] text-[11px] font-medium flex items-center gap-0.5">
                <Activity className="w-3 h-3" />
                {mockUser ? `${((stats.total_spent / mockUser.monthly_income) * 100).toFixed(0)}% used` : 'Active pace'}
              </span>
            </div>
          </div>

          {/* Card 2: Savings Margin */}
          <div className="bg-[#161B22] p-5 rounded-xl border border-[#2A2F3A] hover:border-[#8B949E]/40 transition-colors shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium tracking-wider text-[#8B949E] uppercase">Savings Margin</span>
                <div className="w-7 h-7 bg-[#0D1117] rounded-lg border border-[#2A2F3A] flex items-center justify-center text-[#3FB950]">
                  <Wallet className="w-3.5 h-3.5 text-[#3FB950]" />
                </div>
              </div>
              <p className={`text-2xl font-bold tracking-tight ${stats.savings_rate >= 20 ? 'text-[#3FB950]' : stats.savings_rate > 0 ? 'text-[#E6EDF3]' : 'text-[#F85149]'}`}>
                {stats.savings_rate >= 0 ? `+${stats.savings_rate.toFixed(1)}%` : `${stats.savings_rate.toFixed(1)}%`}
              </p>
            </div>
            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-[#2A2F3A] text-xs">
              <span className="text-[#8B949E] text-[11px]">Target: 20.0%</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                stats.savings_rate >= 20 
                  ? 'bg-[#3FB950]/10 text-[#3FB950] border-[#3FB950]/30' 
                  : 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30'
              }`}>
                {stats.savings_rate >= 20 ? 'Target Achieved' : 'Below Baseline'}
              </span>
            </div>
          </div>

          {/* Card 3: Portfolio Health */}
          <div className="bg-[#161B22] p-5 rounded-xl border border-[#2A2F3A] hover:border-[#8B949E]/40 transition-colors shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium tracking-wider text-[#8B949E] uppercase">Portfolio Health</span>
                <div className="w-7 h-7 bg-[#0D1117] rounded-lg border border-[#2A2F3A] flex items-center justify-center">
                  <Activity className={`w-3.5 h-3.5 ${stats.health_score >= 80 ? 'text-[#3FB950]' : stats.health_score >= 65 ? 'text-[#4A9EFF]' : 'text-[#F85149]'}`} />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold tracking-tight text-[#E6EDF3]">
                  {stats.health_score} <span className="text-sm font-normal text-[#8B949E]">/ 100</span>
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-[#2A2F3A] text-xs">
              <span className="text-[#8B949E] text-[11px]">
                {stats.health_score >= 80 ? 'Strong baseline' : stats.health_score >= 65 ? 'Moderate standing' : 'Intervention advised'}
              </span>
              <div className="w-16 h-1.5 bg-[#0D1117] rounded-full overflow-hidden border border-[#2A2F3A]">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${
                    stats.health_score >= 80 ? 'bg-[#3FB950]' : stats.health_score >= 65 ? 'bg-[#4A9EFF]' : 'bg-[#F85149]'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, stats.health_score))}%` }}
                />
              </div>
            </div>
          </div>

          {/* Card 4: 30-Day Forecast */}
          <div className="bg-[#161B22] p-5 rounded-xl border border-[#2A2F3A] hover:border-[#8B949E]/40 transition-colors shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium tracking-wider text-[#8B949E] uppercase">30-Day Forecast</span>
                <div className="w-7 h-7 bg-[#0D1117] rounded-lg border border-[#2A2F3A] flex items-center justify-center text-[#4A9EFF]">
                  <TrendingUp className="w-3.5 h-3.5 text-[#4A9EFF]" />
                </div>
              </div>
              <p className="text-2xl font-bold tracking-tight text-[#E6EDF3]">
                ₹{stats.forecast_next_30_days.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-[#2A2F3A] text-xs">
              <span className="text-[#8B949E] text-[11px]">Meta Prophet rolling estimate</span>
              <span className="text-[#8B949E] text-[10px] font-mono bg-[#0D1117] px-1.5 py-0.5 rounded border border-[#2A2F3A]">
                ±4.2% CI
              </span>
            </div>
          </div>
        </div>

        {/* 3. ANALYTICS & VISUALIZATION SECTION (2-COLUMN GRID) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Outlay by Category: Modern Donut Chart with thin ring width & center label */}
          <div className="bg-[#161B22] p-5 rounded-xl border border-[#2A2F3A] flex flex-col justify-between shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-xs uppercase tracking-wider text-[#8B949E] font-medium">Outlay by Category</h2>
                <p className="text-sm font-semibold text-[#E6EDF3] tracking-tight mt-0.5">Portfolio Outlay Distribution</p>
              </div>
              
              {/* Donut vs Bar Switcher */}
              <div className="flex items-center bg-[#0D1117] p-0.5 rounded-lg border border-[#2A2F3A]">
                <button
                  onClick={() => setCategoryChartType('donut')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                    categoryChartType === 'donut' 
                      ? 'bg-[#4A9EFF] text-white font-medium shadow-xs' 
                      : 'text-[#8B949E] hover:text-[#E6EDF3]'
                  }`}
                >
                  <PieIcon className="w-3 h-3" />
                  <span>Donut</span>
                </button>
                <button
                  onClick={() => setCategoryChartType('bar')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                    categoryChartType === 'bar' 
                      ? 'bg-[#4A9EFF] text-white font-medium shadow-xs' 
                      : 'text-[#8B949E] hover:text-[#E6EDF3]'
                  }`}
                >
                  <BarChart2 className="w-3 h-3" />
                  <span>Bar</span>
                </button>
              </div>
            </div>

            {/* Donut Chart Container with Center Label */}
            <div className="h-64 sm:h-72 w-full relative">
              {categoryData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[#8B949E] text-xs">
                  No expense records ingested
                </div>
              ) : categoryChartType === 'donut' ? (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#161B22', 
                          borderRadius: '8px', 
                          border: '1px solid #2A2F3A', 
                          color: '#E6EDF3', 
                          fontSize: '11px',
                          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                        }} 
                        formatter={(val: number) => [`₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 'Outlay']} 
                      />
                      <Pie
                        data={categoryData}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={85}
                        paddingAngle={3}
                        dataKey="value"
                        stroke="#161B22"
                        strokeWidth={2}
                      >
                        {categoryData.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} 
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Sleek Center Metric Inside the Donut */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[11px] uppercase tracking-wider text-[#8B949E]">Total Spend</span>
                    <span className="text-xl font-bold tracking-tight text-[#E6EDF3] mt-0.5">
                      {totalSpendFormatted}
                    </span>
                  </div>
                </>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <XAxis 
                      dataKey="name" 
                      tick={{ fontSize: 10, fill: '#8B949E' }} 
                      axisLine={{ stroke: '#2A2F3A' }} 
                      tickLine={false} 
                    />
                    <YAxis 
                      tick={{ fontSize: 10, fill: '#8B949E' }} 
                      axisLine={false} 
                      tickLine={false} 
                      tickFormatter={val => `₹${val >= 1000 ? `${(val/1000).toFixed(0)}k` : val}`} 
                    />
                    <Tooltip 
                      cursor={{ fill: '#21262D', opacity: 0.5 }} 
                      contentStyle={{ 
                        backgroundColor: '#161B22', 
                        borderRadius: '8px', 
                        border: '1px solid #2A2F3A', 
                        color: '#E6EDF3', 
                        fontSize: '11px' 
                      }} 
                      formatter={(val: number) => [`₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 'Outlay']} 
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {categoryData.map((entry, index) => (
                        <Cell key={`bar-cell-${index}`} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Sleek Custom Legend with Category Pills */}
            <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-[#2A2F3A]">
              {categoryData.map((cat, i) => (
                <div 
                  key={cat.name} 
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-[#0D1117] rounded-full border border-[#2A2F3A] text-xs shadow-2xs"
                >
                  <span 
                    className="w-2 h-2 rounded-full flex-shrink-0" 
                    style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                  ></span>
                  <span className="text-[#E6EDF3] font-medium">{cat.name}</span>
                  <span className="text-[#8B949E] text-[11px]">
                    ₹{cat.value >= 1000 ? `${(cat.value / 1000).toFixed(1)}k` : cat.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Spending Velocity (Timeline): Smooth AreaChart with Clean Blue Accent */}
          <div className="bg-[#161B22] p-5 rounded-xl border border-[#2A2F3A] flex flex-col justify-between shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-xs uppercase tracking-wider text-[#8B949E] font-medium">Spending Velocity</h2>
                <p className="text-sm font-semibold text-[#E6EDF3] tracking-tight mt-0.5">Cumulative Expenditure Timeline</p>
              </div>
              <span className="text-[10px] px-2.5 py-1 rounded-full bg-[#4A9EFF]/10 text-[#4A9EFF] border border-[#4A9EFF]/30 flex items-center gap-1 font-medium">
                <Calendar className="w-3 h-3" />
                CURRENT CYCLE
              </span>
            </div>

            <div className="h-64 sm:h-72 w-full">
              {trendData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[#8B949E] text-xs">
                  No timeline data available
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -5, bottom: 0 }}>
                    <defs>
                      <linearGradient id="blueSpendingGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4A9EFF" stopOpacity={0.35}/>
                        <stop offset="95%" stopColor="#4A9EFF" stopOpacity={0.0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2A2F3A" opacity={0.6} vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 10, fill: '#8B949E' }} 
                      axisLine={{ stroke: '#2A2F3A' }} 
                      tickLine={false} 
                    />
                    <YAxis 
                      tick={{ fontSize: 10, fill: '#8B949E' }} 
                      axisLine={false} 
                      tickLine={false} 
                      tickFormatter={val => `₹${val >= 1000 ? `${(val/1000).toFixed(0)}k` : val}`} 
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#161B22', 
                        borderRadius: '8px', 
                        border: '1px solid #2A2F3A', 
                        color: '#E6EDF3', 
                        fontSize: '11px',
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                      }} 
                      formatter={(val: number, name: string) => [
                        `₹${val.toLocaleString('en-IN')}`, 
                        name === 'cumulative' ? 'Cumulative Spend' : 'Outlay'
                      ]}
                      labelFormatter={(label, items) => {
                        const merchant = items?.[0]?.payload?.merchant;
                        return merchant ? `${label} • ${merchant}` : label;
                      }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="cumulative" 
                      stroke="#4A9EFF" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#blueSpendingGradient)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#2A2F3A] text-xs text-[#8B949E]">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#4A9EFF]"></span>
                Continuous trajectory projection
              </span>
              <span className="text-[#E6EDF3] font-medium">
                Total Incurred: ₹{stats.total_spent.toLocaleString('en-IN')}
              </span>
            </div>
          </div>
        </div>

        {/* 4. SMART BUDGET & OUTLIER SURVEILLANCE (2-COLUMN GRID) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Smart Budget Allocation (50/30/20 Heuristic) */}
          <div className="bg-[#161B22] p-5 rounded-xl border border-[#2A2F3A] flex flex-col shadow-sm">
            <div className="flex justify-between items-center mb-5">
              <div>
                <h2 className="text-xs uppercase tracking-wider text-[#8B949E] font-medium">Smart Budget Allocation</h2>
                <p className="text-sm font-semibold text-[#E6EDF3] tracking-tight mt-0.5">50/30/20 Heuristic Framework</p>
              </div>
              <span className="text-[10px] px-2.5 py-1 rounded-full bg-[#21262D] text-[#8B949E] border border-[#2A2F3A] font-medium">
                50/30/20 MODEL
              </span>
            </div>

            <div className="space-y-5 flex-1">
              {budgetAllocation.map((item, idx) => {
                const percentUsed = Math.min(100, Math.round((item.current / Math.max(item.target, 1)) * 100));
                return (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex justify-between items-baseline text-xs">
                      <div>
                        <span className="text-[#E6EDF3] font-medium">{item.name}</span>
                        <span className="text-[#8B949E] text-[11px] ml-2">({item.subtitle})</span>
                      </div>
                      <div className="flex items-center gap-2 text-right">
                        <span className="text-[#8B949E] text-[11px]">{percentUsed}%</span>
                        <span className="text-[#E6EDF3] font-medium">
                          ₹{Math.round(item.current).toLocaleString('en-IN')} / ₹{Math.round(item.target).toLocaleString('en-IN')}
                        </span>
                      </div>
                    </div>
                    
                    {/* Progress Bar Track with Rounded Ends */}
                    <div className="w-full bg-[#0D1117] rounded-full h-2.5 overflow-hidden border border-[#2A2F3A] p-0.5">
                      <div 
                        className={`h-full rounded-full transition-all duration-700 bg-gradient-to-r ${item.color}`} 
                        style={{ width: `${percentUsed}%` }}
                      />
                    </div>
                  </div>
                );
              })}

              <div className="mt-6 pt-4 border-t border-[#2A2F3A] flex items-center justify-between text-xs text-[#8B949E]">
                <span>Income baseline: ₹{effectiveMonthlyIncome.toLocaleString('en-IN')}</span>
                <span className="text-[#3FB950] flex items-center gap-1 text-[11px] font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Statistically Balanced
                </span>
              </div>
            </div>
          </div>

          {/* Outlier & Anomaly Surveillance */}
          <div className="bg-[#161B22] rounded-xl border border-[#2A2F3A] overflow-hidden flex flex-col shadow-sm">
            <div className="px-5 py-4 border-b border-[#2A2F3A] flex items-center justify-between bg-[#0D1117]/50">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-[#F85149]/10 border border-[#F85149]/30 flex items-center justify-center">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#F85149]" />
                </div>
                <h2 className="text-xs uppercase tracking-wider text-[#8B949E] font-medium">
                  Outlier & Anomaly Surveillance
                </h2>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#21262D] text-[#8B949E] border border-[#2A2F3A] font-medium">
                ISOLATION FOREST
              </span>
            </div>

            <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
              {primaryAnomalies.map((anomaly, idx) => {
                const status = anomalyStatus[anomaly.id];
                return (
                  <div 
                    key={anomaly.id || idx} 
                    className="p-4 rounded-xl border bg-[#0D1117] border-[#2A2F3A] hover:border-[#8B949E]/40 transition-colors space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#F85149]/10 border border-[#F85149]/30 flex items-center justify-center text-[#F85149] flex-shrink-0 mt-0.5">
                          <AlertTriangle className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-[#E6EDF3] tracking-tight">
                              {anomaly.merchant} - ₹{anomaly.amount.toLocaleString('en-IN')}
                            </h3>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#F85149]/10 text-[#F85149] border border-[#F85149]/30">
                              Outlier Flagged
                            </span>
                          </div>
                          <p className="text-xs text-[#8B949E] mt-1 leading-relaxed">
                            Isolation Forest: Spent 2.8σ above normal {anomaly.category || 'Food'} average
                          </p>
                        </div>
                      </div>

                      <div className="text-right text-xs text-[#8B949E]">
                        {anomaly.date ? new Date(anomaly.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) : 'Sep 06'}
                      </div>
                    </div>

                    {/* Quick Verify or Dismiss action buttons */}
                    <div className="flex items-center justify-between pt-2 border-t border-[#2A2F3A] text-xs">
                      {status === 'verified' ? (
                        <div className="flex items-center gap-1.5 text-[#3FB950] font-medium">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Flag marked verified as legitimate expense</span>
                        </div>
                      ) : status === 'dismissed' ? (
                        <div className="flex items-center gap-1.5 text-[#8B949E]">
                          <XCircle className="w-4 h-4" />
                          <span>Alert dismissed from active feed</span>
                        </div>
                      ) : (
                        <>
                          <span className="text-[11px] text-[#8B949E]">Requires auditor or user confirmation</span>
                          <div className="flex items-center gap-2">
                            <button
                              id={`anomaly-verify-${anomaly.id}`}
                              onClick={() => handleVerify(anomaly.id)}
                              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-[#3FB950]/10 text-[#3FB950] border border-[#3FB950]/30 hover:bg-[#3FB950]/20 transition-colors flex items-center gap-1"
                            >
                              <Check className="w-3 h-3" />
                              <span>Verify</span>
                            </button>
                            <button
                              id={`anomaly-dismiss-${anomaly.id}`}
                              onClick={() => handleDismiss(anomaly.id)}
                              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-[#21262D] text-[#8B949E] border border-[#2A2F3A] hover:text-[#E6EDF3] hover:border-[#8B949E]/40 transition-colors"
                            >
                              Dismiss
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="p-3 bg-[#0D1117] rounded-lg border border-[#2A2F3A] text-xs text-[#8B949E] flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-[#4A9EFF]" />
                  Anomaly threshold: 2.50σ deviation baseline
                </span>
                <span className="text-[#8B949E] text-[11px]">Precision: 98.4%</span>
              </div>
            </div>
          </div>
        </div>

        {/* 5. JOURNAL LEDGER (TRANSACTION TABLE) */}
        <div className="bg-[#161B22] rounded-xl border border-[#2A2F3A] overflow-hidden flex flex-col shadow-sm">
          <div className="px-5 py-4 border-b border-[#2A2F3A] flex justify-between items-center bg-[#0D1117]/50">
            <div className="flex items-center gap-2.5">
              <h2 className="text-xs uppercase tracking-wider text-[#8B949E] font-medium">Journal Ledger</h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#21262D] text-[#8B949E] border border-[#2A2F3A]">
                {transactions.length} Records
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!mockUser && (
                <>
                  <button
                    id="btn-scan-receipt-table"
                    onClick={() => { setModalInitialMethod('ocr'); setIsModalOpen(true); }}
                    className="flex items-center gap-1.5 text-xs text-[#E6EDF3] hover:text-white px-2.5 py-1 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#2A2F3A] hover:border-[#4A9EFF] transition-colors cursor-pointer shadow-xs font-medium"
                  >
                    <Camera className="w-3 h-3 text-[#4A9EFF]" />
                    <span>Scan Receipt</span>
                  </button>
                  <button
                    id="btn-add-entry-table"
                    onClick={() => { setModalInitialMethod('manual'); setIsModalOpen(true); }}
                    className="flex items-center gap-1 text-xs text-white px-2.5 py-1 rounded-lg bg-[#4A9EFF] hover:bg-[#3b8eed] transition-colors cursor-pointer shadow-xs font-medium"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Entry</span>
                  </button>
                </>
              )}
              {mockUser && (
                <span className="text-xs text-[#8B949E]">
                  Portfolio Ingestion Feed
                </span>
              )}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[380px] scrollbar-thin scrollbar-thumb-[#2A2F3A] scrollbar-track-transparent">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-wider text-[#8B949E] bg-[#0D1117] sticky top-0 backdrop-blur-sm z-10 border-b border-[#2A2F3A]">
                  <th className="px-5 py-3">Description / Merchant</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-[#2A2F3A]">
                {transactions.map(t => {
                  const isAnomaly = (t as MockTransaction).isAnomaly;
                  const isIncome = (t as MockTransaction).type === 'income';

                  return (
                    <tr 
                      key={t.id} 
                      className={`hover:bg-[#21262D]/40 transition-colors ${
                        isAnomaly 
                          ? 'bg-[#F85149]/5' 
                          : isIncome
                          ? 'bg-[#3FB950]/5'
                          : ''
                      }`}
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${isAnomaly ? 'text-[#F85149]' : isIncome ? 'text-[#3FB950]' : 'text-[#E6EDF3]'}`}>
                            {t.merchant}
                          </span>
                          {isAnomaly && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-medium bg-[#F85149]/10 text-[#F85149] border border-[#F85149]/30">
                              OUTLIER
                            </span>
                          )}
                          {isIncome && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-medium bg-[#3FB950]/10 text-[#3FB950] border border-[#3FB950]/30">
                              INFLOW
                            </span>
                          )}
                        </div>
                        {(t as MockTransaction).notes && (
                          <div className="text-[11px] text-[#8B949E] mt-0.5">
                            {(t as MockTransaction).notes}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="bg-[#21262D] text-[#8B949E] text-xs px-2.5 py-0.5 rounded-full border border-[#2A2F3A]">
                          {t.category}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-[#8B949E] text-xs">
                        {new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}
                      </td>
                      <td className={`px-5 py-3.5 text-right font-medium text-xs ${
                        isIncome ? 'text-[#3FB950]' : isAnomaly ? 'text-[#F85149]' : 'text-[#E6EDF3]'
                      }`}>
                        {isIncome ? '+' : ''}₹{t.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 6. AI MONTHLY REPORT */}
        <div id="ai-monthly-report-section" className="bg-[#161B22] rounded-xl border border-[#2A2F3A] p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#2A2F3A]">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-[#4A9EFF]/10 border border-[#4A9EFF]/20 flex items-center justify-center text-[#4A9EFF]">
                  <FileText className="w-3.5 h-3.5" />
                </div>
                <h2 className="text-base font-semibold tracking-tight text-[#E6EDF3]">AI Monthly Report</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#4A9EFF]/10 text-[#4A9EFF] border border-[#4A9EFF]/30 font-medium">
                  Advisor Synthesis
                </span>
              </div>
              <p className="text-xs text-[#8B949E]">
                Direct portfolio summary evaluating total income, outlay, savings rate, highest category, and actionable advice
              </p>
            </div>

            <button
              id="btn-generate-monthly-report"
              type="button"
              onClick={generateMonthlyReport}
              disabled={reportLoading}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-[#4A9EFF] hover:bg-[#3b8eed] text-white rounded-lg text-xs font-medium transition-all shadow-xs disabled:opacity-50 flex-shrink-0 cursor-pointer"
            >
              {reportLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Generating Report...</span>
                </>
              ) : (
                <>
                  <FileText className="w-3.5 h-3.5" />
                  <span>{report ? 'Regenerate Monthly Report' : 'Generate Monthly Report'}</span>
                </>
              )}
            </button>
          </div>

          {/* Report Body / States */}
          {reportLoading ? (
            <div className="p-5 bg-[#0D1117] rounded-xl border border-[#2A2F3A] space-y-3 animate-pulse">
              <div className="h-3.5 bg-[#21262D] rounded w-11/12" />
              <div className="h-3.5 bg-[#21262D] rounded w-full" />
              <div className="h-3.5 bg-[#21262D] rounded w-4/5" />
              <div className="h-3.5 bg-[#21262D] rounded w-9/12" />
              <div className="flex items-center gap-2 pt-1 text-[11px] text-[#8B949E]">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4A9EFF]" />
                <span>Synthesizing monthly advisor briefing from current ledger metrics...</span>
              </div>
            </div>
          ) : reportError ? (
            <div className="p-4 rounded-xl border bg-[#F85149]/10 border-[#F85149]/30 text-[#F85149] text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#F85149] flex-shrink-0" />
                <span>{reportError}</span>
              </div>
              <button 
                onClick={generateMonthlyReport} 
                className="underline text-[#F85149] hover:text-white text-xs font-medium cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : report ? (
            <div className="p-5 bg-[#0D1117] rounded-xl border border-[#2A2F3A] space-y-3 relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#8B949E] uppercase tracking-wider">Advisor Synthesis</span>
                  <span className="text-[10px] text-[#8B949E]">• 4–6 sentence advisory note</span>
                </div>
                <button
                  id="btn-copy-monthly-report"
                  type="button"
                  onClick={handleCopyReport}
                  className="flex items-center gap-1.5 px-3 py-1 bg-[#21262D] hover:bg-[#30363D] text-[#E6EDF3] hover:text-white border border-[#2A2F3A] rounded-lg text-xs font-medium transition-colors shadow-2xs cursor-pointer"
                  title="Copy report text to clipboard"
                >
                  {reportCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#3FB950]" />
                      <span className="text-[#3FB950] font-medium">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#8B949E]" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              <div className="text-xs sm:text-sm text-[#E6EDF3] leading-relaxed pt-1 whitespace-pre-wrap">
                {report}
              </div>

              {reportHasKey === false && (
                <div className="pt-2 border-t border-[#2A2F3A] flex items-center gap-2 text-[11px] text-[#8B949E]">
                  <Info className="w-3.5 h-3.5 text-[#4A9EFF] flex-shrink-0" />
                  <span>Synthesized via deterministic heuristics. Add your <code className="text-[#4A9EFF] font-mono">GEMINI_API_KEY</code> in Settings for live model inference.</span>
                </div>
              )}
            </div>
          ) : (
            <div className="p-5 bg-[#0D1117] rounded-xl border border-dashed border-[#2A2F3A] flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
              <div>
                <h3 className="text-xs font-medium text-[#E6EDF3]">Monthly Advisor Report Ready for Synthesis</h3>
                <p className="text-xs text-[#8B949E] mt-0.5">
                  Click "Generate Monthly Report" to synthesize a personalized 4–6 sentence financial briefing analyzing your cash flows and allocations.
                </p>
              </div>
              <button
                type="button"
                onClick={generateMonthlyReport}
                className="px-3.5 py-1.5 bg-[#21262D] hover:bg-[#30363D] text-[#E6EDF3] hover:text-white border border-[#2A2F3A] rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 flex-shrink-0 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-[#4A9EFF]" />
                <span>Generate Monthly Report</span>
              </button>
            </div>
          )}
        </div>

        {/* SUBTLE DEMO NOTE IF IN ADMIN DETAIL VIEW */}
        {mockUser && (
          <div className="p-4 bg-[#161B22] rounded-xl border border-[#2A2F3A] flex items-center justify-between gap-3 text-xs text-[#8B949E]">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-[#4A9EFF] flex-shrink-0" />
              <span>Multi-client institutional telemetry preview</span>
            </div>
            {onBackToAdmin && (
              <button 
                onClick={onBackToAdmin}
                className="text-[#4A9EFF] hover:text-[#3b8eed] text-xs font-medium flex items-center gap-1 transition-colors"
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

        {/* FinAI Chat Assistant */}
        {!mockUser && isChatOpen && token && (
          <ChatAssistant token={token} onClose={() => setIsChatOpen(false)} />
        )}
      </div>
    </div>
  );
}
