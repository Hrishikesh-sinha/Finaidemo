import { useState, useMemo, type ReactNode } from 'react';
import { 
  Users, DollarSign, TrendingUp, AlertTriangle, ShieldCheck, 
  ArrowUpDown, Search, ChevronRight, Activity, Filter, Info,
  CheckCircle2, ArrowLeft, Eye, ShieldAlert, Sparkles, LogOut
} from 'lucide-react';
import { MockUser } from '../types';
import { mockUsers, getAdminSummary } from '../data/mockSeedData';

interface Props {
  onSelectUser: (user: MockUser) => void;
  onSwitchToUserMode: () => void;
  onExitAdmin: () => void;
}

type SortOption = 'health_asc' | 'health_desc' | 'savings_desc' | 'savings_asc' | 'expenses_desc' | 'income_desc';
type FilterRisk = 'all' | 'flagged' | 'healthy';

export function AdminDashboard({ onSelectUser, onSwitchToUserMode, onExitAdmin }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('health_asc'); // Default ascending to surface users needing attention!
  const [filterRisk, setFilterRisk] = useState<FilterRisk>('all');

  const summary = useMemo(() => getAdminSummary(mockUsers), []);

  const filteredUsers = useMemo(() => {
    return mockUsers
      .filter(user => {
        // Search filter
        const matchesSearch = 
          user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
          user.spending_pattern_title.toLowerCase().includes(searchQuery.toLowerCase());

        // Risk filter
        if (filterRisk === 'flagged') {
          return matchesSearch && user.anomaly_flag.isFlagged;
        }
        if (filterRisk === 'healthy') {
          return matchesSearch && !user.anomaly_flag.isFlagged;
        }
        return matchesSearch;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'health_asc':
            return a.stats.health_score - b.stats.health_score;
          case 'health_desc':
            return b.stats.health_score - a.stats.health_score;
          case 'savings_desc':
            return b.stats.savings_rate - a.stats.savings_rate;
          case 'savings_asc':
            return a.stats.savings_rate - b.stats.savings_rate;
          case 'expenses_desc':
            return b.stats.total_spent - a.stats.total_spent;
          case 'income_desc':
            return b.monthly_income - a.monthly_income;
          default:
            return 0;
        }
      });
  }, [searchQuery, sortBy, filterRisk]);

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-8">
      {/* Admin Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[#2A2F3A]">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#4A9EFF]/10 text-[#4A9EFF] border border-[#4A9EFF]/30">
              Admin Console
            </span>
            <span className="text-xs text-[#8B949E]">Portfolio Telemetry & Audit Portal</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#E6EDF3] tracking-tight">
            Client Directory & Risk Telemetry
          </h1>
          <p className="text-xs text-[#8B949E] mt-1 max-w-2xl">
            Monitor client savings margins, heuristic allocation adherence, and statistical outlier flags across managed accounts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="admin-switch-to-user-btn"
            onClick={onSwitchToUserMode}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#21262D] hover:bg-[#30363D] text-[#E6EDF3] rounded-lg font-medium border border-[#2A2F3A] text-xs transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-[#4A9EFF]" />
            <span>Switch to Personal View</span>
          </button>
          <button
            id="admin-signout-btn"
            onClick={onExitAdmin}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#F85149]/10 hover:bg-[#F85149]/20 text-[#F85149] border border-[#F85149]/30 rounded-lg text-xs font-medium transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </div>

      {/* 1. SUMMARY ROW */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          id="summary-total-users"
          title="Monitored Portfolios"
          value={`${summary.totalUsers} Active`}
          subtext="Managed accounts"
          icon={<Users className="w-4 h-4 text-[#4A9EFF]" />}
          trend={`${summary.flaggedUsersCount} flagged for review`}
          trendType={summary.flaggedUsersCount > 0 ? 'warning' : 'neutral'}
        />
        <SummaryCard
          id="summary-combined-income"
          title="Aggregate Inflow"
          value={`₹${summary.combinedIncome.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
          subtext="Monthly client inflow"
          icon={<DollarSign className="w-4 h-4 text-[#3FB950]" />}
          trend="Avg ₹78,000 / client"
          trendType="neutral"
        />
        <SummaryCard
          id="summary-combined-expenses"
          title="Aggregate Outlay"
          value={`₹${summary.combinedExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
          subtext="Monthly expenditure"
          icon={<TrendingUp className="w-4 h-4 text-[#8B949E]" />}
          trend={`${((summary.combinedExpenses / summary.combinedIncome) * 100).toFixed(1)}% burn ratio`}
          trendType="warning"
        />
        <SummaryCard
          id="summary-avg-health"
          title="Directory Health Score"
          value={`${summary.averageHealthScore} / 100`}
          subtext={`Avg Margin: +${summary.overallSavingsRate}%`}
          icon={<Activity className="w-4 h-4 text-[#4A9EFF]" />}
          trend={summary.averageHealthScore >= 75 ? 'Optimal benchmark' : 'Attention advised'}
          trendType={summary.averageHealthScore >= 75 ? 'positive' : 'warning'}
        />
      </div>

      {/* 2. FILTER & SORT CONTROLS */}
      <div className="bg-[#161B22] p-5 rounded-xl border border-[#2A2F3A] space-y-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
              <Search className="h-3.5 w-3.5 text-[#8B949E]" />
            </div>
            <input
              id="admin-user-search-input"
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search portfolios by client name, email, or persona..."
              className="pl-9 w-full px-3 py-2 bg-[#0D1117] border border-[#2A2F3A] rounded-lg text-[#E6EDF3] placeholder-[#8B949E] focus:border-[#4A9EFF] focus:ring-1 focus:ring-[#4A9EFF] outline-none text-xs transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-[#8B949E] hover:text-[#E6EDF3]"
              >
                Clear
              </button>
            )}
          </div>

          {/* Quick Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[#8B949E] flex items-center gap-1.5 mr-1">
              <Filter className="w-3.5 h-3.5 text-[#8B949E]" /> Filter:
            </span>
            <button
              id="filter-all-users"
              onClick={() => setFilterRisk('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                filterRisk === 'all'
                  ? 'bg-[#4A9EFF] text-white border-[#4A9EFF]'
                  : 'bg-[#21262D] text-[#8B949E] hover:text-[#E6EDF3] border-[#2A2F3A]'
              }`}
            >
              All Clients ({mockUsers.length})
            </button>
            <button
              id="filter-flagged-users"
              onClick={() => setFilterRisk('flagged')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors border ${
                filterRisk === 'flagged'
                  ? 'bg-[#F85149] text-white border-[#F85149]'
                  : 'bg-[#21262D] text-[#F85149] hover:bg-[#F85149]/10 border-[#2A2F3A]'
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              Flagged Anomalies ({summary.flaggedUsersCount})
            </button>
            <button
              id="filter-healthy-users"
              onClick={() => setFilterRisk('healthy')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors border ${
                filterRisk === 'healthy'
                  ? 'bg-[#3FB950] text-white border-[#3FB950]'
                  : 'bg-[#21262D] text-[#3FB950] hover:bg-[#3FB950]/10 border-[#2A2F3A]'
              }`}
            >
              <ShieldCheck className="w-3 h-3" />
              Healthy ({mockUsers.length - summary.flaggedUsersCount})
            </button>
          </div>

          {/* Sort Controls */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#8B949E] flex items-center gap-1">
              <ArrowUpDown className="w-3 h-3 text-[#8B949E]" /> Sort:
            </span>
            <select
              id="admin-sort-select"
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortOption)}
              className="bg-[#0D1117] border border-[#2A2F3A] text-[#E6EDF3] text-xs rounded-lg px-3 py-1.5 focus:border-[#4A9EFF] outline-none cursor-pointer"
            >
              <option value="health_asc">Health Score (Lowest first - Attention)</option>
              <option value="health_desc">Health Score (Highest first)</option>
              <option value="savings_asc">Savings Margin (Lowest first)</option>
              <option value="savings_desc">Savings Margin (Highest first)</option>
              <option value="expenses_desc">Total Outlay (Highest first)</option>
              <option value="income_desc">Monthly Inflow (Highest first)</option>
            </select>
          </div>
        </div>
      </div>

      {/* 3. USER TABLE / LIST */}
      <div className="bg-[#161B22] rounded-xl border border-[#2A2F3A] overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-[#2A2F3A] flex justify-between items-center bg-[#0D1117]/60">
          <div className="flex items-center gap-2">
            <h2 className="text-xs uppercase tracking-wider text-[#8B949E] font-medium">
              Client Directory ({filteredUsers.length})
            </h2>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#21262D] text-[#8B949E] border border-[#2A2F3A]">
              Click row to inspect details
            </span>
          </div>
          <span className="text-xs text-[#8B949E] hidden sm:inline">
            Telemetry: 50/30/20 & Outlier Isolation
          </span>
        </div>

        {filteredUsers.length === 0 ? (
          <div className="text-center py-12 text-[#8B949E] text-xs">
            No client accounts match the specified criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] uppercase text-[#8B949E] border-b border-[#2A2F3A] bg-[#0D1117] tracking-wider">
                  <th className="px-6 py-3.5 font-medium">CLIENT & PERSONA</th>
                  <th className="px-6 py-3.5 font-medium text-right">MONTHLY INFLOW</th>
                  <th className="px-6 py-3.5 font-medium text-right">TOTAL OUTLAY</th>
                  <th className="px-6 py-3.5 font-medium text-center">SAVINGS MARGIN</th>
                  <th className="px-6 py-3.5 font-medium text-center">HEALTH SCORE</th>
                  <th className="px-6 py-3.5 font-medium">ANOMALY STATUS</th>
                  <th className="px-6 py-3.5 font-medium text-right">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2A2F3A] text-xs">
                {filteredUsers.map(user => {
                  const isFlagged = user.anomaly_flag.isFlagged;
                  const isCritical = user.anomaly_flag.severity === 'critical';
                  const burnRatio = (user.stats.total_spent / user.monthly_income) * 100;

                  return (
                    <tr
                      key={user.id}
                      id={`user-row-${user.id}`}
                      onClick={() => onSelectUser(user)}
                      className={`group cursor-pointer transition-colors ${
                        isCritical
                          ? 'bg-[#F85149]/5 hover:bg-[#F85149]/10'
                          : isFlagged
                          ? 'bg-amber-500/5 hover:bg-amber-500/10'
                          : 'hover:bg-[#21262D]/50'
                      }`}
                    >
                      {/* Name & Avatar */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-lg ${user.avatarColor} flex items-center justify-center text-white font-bold text-xs flex-shrink-0 shadow-xs`}>
                            {user.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <div>
                            <div className="font-medium text-[#E6EDF3] group-hover:text-[#4A9EFF] transition-colors flex items-center gap-2">
                              <span>{user.name}</span>
                              {isCritical && (
                                <span className="flex h-1.5 w-1.5 relative">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F85149] opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#F85149]"></span>
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#8B949E] mt-0.5">{user.email}</div>
                            <div className="text-[10px] text-[#8B949E] mt-1">
                              <span className="px-2 py-0.5 bg-[#0D1117] border border-[#2A2F3A] rounded-full text-[#E6EDF3]">
                                {user.spending_pattern_title}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Monthly Income */}
                      <td className="px-6 py-4 text-right text-[#E6EDF3] font-medium">
                        ₹{user.monthly_income.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>

                      {/* Total Expenses */}
                      <td className="px-6 py-4 text-right">
                        <div className="text-[#E6EDF3] font-medium">
                          ₹{user.stats.total_spent.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </div>
                        <div className="text-[10px] text-[#8B949E] mt-0.5">
                          {burnRatio.toFixed(1)}% of inflow
                        </div>
                      </td>

                      {/* Savings Rate */}
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                            user.stats.savings_rate >= 20
                              ? 'bg-[#3FB950]/10 text-[#3FB950] border-[#3FB950]/30'
                              : 'bg-[#F85149]/10 text-[#F85149] border-[#F85149]/30'
                          }`}
                        >
                          {user.stats.savings_rate > 0 ? `+${user.stats.savings_rate.toFixed(1)}%` : `${user.stats.savings_rate.toFixed(1)}%`}
                        </span>
                      </td>

                      {/* Health Score */}
                      <td className="px-6 py-4 text-center">
                        <div className="inline-flex flex-col items-center">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-sm font-semibold ${
                                user.stats.health_score >= 80
                                  ? 'text-[#3FB950]'
                                  : user.stats.health_score >= 65
                                  ? 'text-[#4A9EFF]'
                                  : 'text-[#F85149]'
                              }`}
                            >
                              {user.stats.health_score}
                            </span>
                            <span className="text-[10px] text-[#8B949E]">/ 100</span>
                          </div>
                          <div className="w-14 bg-[#21262D] rounded-full h-1 mt-1 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                user.stats.health_score >= 80
                                  ? 'bg-[#3FB950]'
                                  : user.stats.health_score >= 65
                                  ? 'bg-[#4A9EFF]'
                                  : 'bg-[#F85149]'
                              }`}
                              style={{ width: `${Math.min(100, user.stats.health_score)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Anomaly Status */}
                      <td className="px-6 py-4">
                        {isCritical ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[#F85149]/10 text-[#F85149] border border-[#F85149]/30 w-fit">
                              <ShieldAlert className="w-3 h-3 text-[#F85149]" />
                              {user.anomaly_flag.badgeText}
                            </span>
                            <p className="text-[10px] text-[#8B949E] line-clamp-1 max-w-xs mt-0.5">
                              {user.anomaly_flag.reason}
                            </p>
                          </div>
                        ) : isFlagged ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 w-fit">
                              <AlertTriangle className="w-3 h-3 text-amber-400" />
                              {user.anomaly_flag.badgeText}
                            </span>
                            <p className="text-[10px] text-[#8B949E] line-clamp-1 max-w-xs mt-0.5">
                              {user.anomaly_flag.reason}
                            </p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-[#3FB950]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#3FB950] flex-shrink-0" />
                            <span className="text-xs">Standard Variance</span>
                          </div>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectUser(user);
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-[#21262D] hover:bg-[#4A9EFF] text-[#E6EDF3] hover:text-white font-medium text-xs transition-colors border border-[#2A2F3A] hover:border-[#4A9EFF]"
                        >
                          <span>Inspect</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. SUBTLE DEMO FOOTER NOTE */}
      <div className="p-4 bg-[#161B22] rounded-xl border border-[#2A2F3A] flex items-start gap-3 text-xs text-[#8B949E]">
        <Info className="w-4 h-4 text-[#4A9EFF] flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-[#E6EDF3] font-medium">
            Multi-Tenant Portfolio Intelligence Sandbox
          </p>
          <p className="text-[11px] text-[#8B949E] leading-relaxed">
            This administration interface demonstrates multi-client oversight, dynamic heuristic scoring, and Isolation Forest ML telemetry.
          </p>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  id,
  title,
  value,
  subtext,
  icon,
  trend,
  trendType
}: {
  id: string;
  title: string;
  value: string;
  subtext: string;
  icon: ReactNode;
  trend: string;
  trendType: 'positive' | 'warning' | 'neutral';
}) {
  return (
    <div id={id} className="bg-[#161B22] p-5 rounded-xl border border-[#2A2F3A] flex flex-col justify-between hover:border-[#8B949E]/40 transition-colors shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-wider text-[#8B949E] font-medium">{title}</span>
        <div className="w-8 h-8 bg-[#0D1117] rounded-lg border border-[#2A2F3A] flex items-center justify-center">
          {icon}
        </div>
      </div>
      <div>
        <div className="text-2xl font-bold text-[#E6EDF3] tracking-tight">{value}</div>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#2A2F3A] text-xs">
          <span className="text-[#8B949E]">{subtext}</span>
          <span
            className={
              trendType === 'positive'
                ? 'text-[#3FB950] font-medium'
                : trendType === 'warning'
                ? 'text-[#F85149] font-medium'
                : 'text-[#8B949E]'
            }
          >
            {trend}
          </span>
        </div>
      </div>
    </div>
  );
}
