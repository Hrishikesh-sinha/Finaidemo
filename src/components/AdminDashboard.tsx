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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-line">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-xs text-ink-2">Admin view</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink tracking-tight">
            Sample users
          </h1>
          <p className="text-xs text-ink-2 mt-1 max-w-2xl">
            Four sample users with different spending patterns, so you can see how the budget rule and unusual-spending flags respond.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="admin-switch-to-user-btn"
            onClick={onSwitchToUserMode}
            className="flex items-center gap-2 px-3.5 py-2 bg-surface hover:bg-raised text-ink rounded-lg font-medium border border-line text-xs transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-accent" />
            <span>Back to my dashboard</span>
          </button>
          <button
            id="admin-signout-btn"
            onClick={onExitAdmin}
            className="flex items-center gap-2 px-3.5 py-2 bg-neg/10 hover:bg-neg/20 text-neg border border-neg/30 rounded-lg text-xs font-medium transition-colors"
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
          title="Users"
          value={`${summary.totalUsers}`}
          subtext="sample accounts"
          icon={<Users className="w-4 h-4 text-accent" />}
          trend={`${summary.flaggedUsersCount} with flagged spending`}
          trendType={summary.flaggedUsersCount > 0 ? 'warning' : 'neutral'}
        />
        <SummaryCard
          id="summary-combined-income"
          title="Combined income"
          value={`₹${summary.combinedIncome.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
          subtext="per month"
          icon={<DollarSign className="w-4 h-4 text-pos" />}
          trend={`average ₹${Math.round(summary.combinedIncome / Math.max(1, summary.totalUsers)).toLocaleString('en-IN')} per user`}
          trendType="neutral"
        />
        <SummaryCard
          id="summary-combined-expenses"
          title="Combined spending"
          value={`₹${summary.combinedExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
          subtext="per month"
          icon={<TrendingUp className="w-4 h-4 text-ink-2" />}
          trend={`${((summary.combinedExpenses / summary.combinedIncome) * 100).toFixed(1)}% of combined income`}
          trendType="warning"
        />
        <SummaryCard
          id="summary-avg-health"
          title="Average health score"
          value={`${summary.averageHealthScore} / 100`}
          subtext={`average savings rate ${summary.overallSavingsRate}%`}
          icon={<Activity className="w-4 h-4 text-accent" />}
          trend={summary.averageHealthScore >= 75 ? 'Healthy on average' : 'Below 75 on average'}
          trendType={summary.averageHealthScore >= 75 ? 'positive' : 'warning'}
        />
      </div>

      {/* 2. FILTER & SORT CONTROLS */}
      <div className="bg-sunken p-5 rounded-lg border border-line space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
              <Search className="h-3.5 w-3.5 text-ink-2" />
            </div>
            <input
              id="admin-user-search-input"
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name, email or spending pattern"
              className="pl-9 w-full px-3 py-2 bg-canvas border border-line rounded-lg text-ink placeholder-ink-2 focus:border-accent focus:ring-1 focus:ring-accent outline-none text-xs transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-ink-2 hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>

          {/* Quick Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-ink-2 flex items-center gap-1.5 mr-1">
              <Filter className="w-3.5 h-3.5 text-ink-2" /> Filter:
            </span>
            <button
              id="filter-all-users"
              onClick={() => setFilterRisk('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                filterRisk === 'all'
                  ? 'bg-accent text-canvas border-accent'
                  : 'bg-surface text-ink-2 hover:text-ink border-line'
              }`}
            >
              All users ({mockUsers.length})
            </button>
            <button
              id="filter-flagged-users"
              onClick={() => setFilterRisk('flagged')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors border ${
                filterRisk === 'flagged'
                  ? 'bg-neg text-canvas border-neg'
                  : 'bg-surface text-neg hover:bg-neg/10 border-line'
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              Flagged spending ({summary.flaggedUsersCount})
            </button>
            <button
              id="filter-healthy-users"
              onClick={() => setFilterRisk('healthy')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors border ${
                filterRisk === 'healthy'
                  ? 'bg-pos text-canvas border-pos'
                  : 'bg-surface text-pos hover:bg-pos/10 border-line'
              }`}
            >
              <ShieldCheck className="w-3 h-3" />
              Healthy ({mockUsers.length - summary.flaggedUsersCount})
            </button>
          </div>

          {/* Sort Controls */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-2 flex items-center gap-1">
              <ArrowUpDown className="w-3 h-3 text-ink-2" /> Sort:
            </span>
            <select
              id="admin-sort-select"
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortOption)}
              className="bg-canvas border border-line text-ink text-xs rounded-lg px-3 py-1.5 focus:border-accent outline-none cursor-pointer"
            >
              <option value="health_asc">Health score (lowest first)</option>
              <option value="health_desc">Health Score (Highest first)</option>
              <option value="savings_asc">Savings rate (lowest first)</option>
              <option value="savings_desc">Savings rate (highest first)</option>
              <option value="expenses_desc">Spending (highest first)</option>
              <option value="income_desc">Income (highest first)</option>
            </select>
          </div>
        </div>
      </div>

      {/* 3. USER TABLE / LIST */}
      <div className="bg-sunken rounded-lg border border-line overflow-hidden">
        <div className="px-6 py-4 border-b border-line flex justify-between items-center bg-canvas/60">
          <div className="flex items-center gap-2">
            <h2 className="text-xs text-ink-2 font-medium">
              Users ({filteredUsers.length})
            </h2>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-surface text-ink-2 border border-line">
              Select a row to open that user
            </span>
          </div>
          <span className="text-xs text-ink-2 hidden sm:inline">
            Budget rule and unusual-spending flags
          </span>
        </div>

        {filteredUsers.length === 0 ? (
          <div className="text-center py-12 text-ink-2 text-xs">
            No client accounts match the specified criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs text-ink-2 border-b border-line bg-canvas">
                  <th className="px-6 py-3.5 font-medium">User</th>
                  <th className="px-6 py-3.5 font-medium text-right">Income</th>
                  <th className="px-6 py-3.5 font-medium text-right">Spent</th>
                  <th className="px-6 py-3.5 font-medium text-center">Saved</th>
                  <th className="px-6 py-3.5 font-medium text-center">Health score</th>
                  <th className="px-6 py-3.5 font-medium">Spending flags</th>
                  <th className="px-6 py-3.5 font-medium text-right"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-xs">
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
                          ? 'bg-neg/5 hover:bg-neg/10'
                          : isFlagged
                          ? 'bg-caution/5 hover:bg-caution/10'
                          : 'hover:bg-surface/50'
                      }`}
                    >
                      {/* Name & Avatar */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-lg ${user.avatarColor} flex items-center justify-center text-white font-bold text-xs flex-shrink-0`}>
                            {user.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <div>
                            <div className="font-medium text-ink group-hover:text-accent transition-colors flex items-center gap-2">
                              <span>{user.name}</span>
                              {isCritical && (
                                <span className="flex h-1.5 w-1.5 relative">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neg opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-neg"></span>
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-ink-2 mt-0.5">{user.email}</div>
                            <div className="text-[10px] text-ink-2 mt-1">
                              <span className="px-2 py-0.5 bg-canvas border border-line rounded-full text-ink">
                                {user.spending_pattern_title}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Monthly Income */}
                      <td className="px-6 py-4 text-right text-ink font-medium">
                        ₹{user.monthly_income.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>

                      {/* Total Expenses */}
                      <td className="px-6 py-4 text-right">
                        <div className="text-ink font-medium">
                          ₹{user.stats.total_spent.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </div>
                        <div className="text-[10px] text-ink-2 mt-0.5">
                          {burnRatio.toFixed(1)}% of income
                        </div>
                      </td>

                      {/* Savings Rate */}
                      <td className="px-6 py-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                            user.stats.savings_rate >= 20
                              ? 'bg-pos/10 text-pos border-pos/30'
                              : 'bg-neg/10 text-neg border-neg/30'
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
                                  ? 'text-pos'
                                  : user.stats.health_score >= 65
                                  ? 'text-accent'
                                  : 'text-neg'
                              }`}
                            >
                              {user.stats.health_score}
                            </span>
                            <span className="text-[10px] text-ink-2">/ 100</span>
                          </div>
                          <div className="w-14 bg-surface rounded-full h-1 mt-1 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                user.stats.health_score >= 80
                                  ? 'bg-pos'
                                  : user.stats.health_score >= 65
                                  ? 'bg-accent'
                                  : 'bg-neg'
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
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-neg/10 text-neg border border-neg/30 w-fit">
                              <ShieldAlert className="w-3 h-3 text-neg" />
                              {user.anomaly_flag.badgeText}
                            </span>
                            <p className="text-[10px] text-ink-2 line-clamp-1 max-w-xs mt-0.5">
                              {user.anomaly_flag.reason}
                            </p>
                          </div>
                        ) : isFlagged ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-caution/10 text-caution border border-amber-500/30 w-fit">
                              <AlertTriangle className="w-3 h-3 text-caution" />
                              {user.anomaly_flag.badgeText}
                            </span>
                            <p className="text-[10px] text-ink-2 line-clamp-1 max-w-xs mt-0.5">
                              {user.anomaly_flag.reason}
                            </p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-pos">
                            <CheckCircle2 className="w-3.5 h-3.5 text-pos flex-shrink-0" />
                            <span className="text-xs">No flags</span>
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
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-surface hover:bg-accent text-ink hover:text-ink font-medium text-xs transition-colors border border-line hover:border-accent"
                        >
                          <span>Open</span>
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
      <div className="p-4 bg-sunken rounded-lg border border-line flex items-start gap-3 text-xs text-ink-2">
        <Info className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-ink font-medium">
            These four users are sample data for the demo.
          </p>
          <p className="text-[11px] text-ink-2 leading-relaxed">
            This administration interface demonstrates multi-client oversight and dynamic heuristic scoring.
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
    <div id={id} className="bg-sunken p-5 rounded-lg border border-line flex flex-col justify-between hover:border-ink-2/40 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] text-ink-2 font-medium">{title}</span>
        <div className="w-8 h-8 bg-canvas rounded-lg border border-line flex items-center justify-center">
          {icon}
        </div>
      </div>
      <div>
        <div className="text-2xl font-bold text-ink tracking-tight">{value}</div>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-line text-xs">
          <span className="text-ink-2">{subtext}</span>
          <span
            className={
              trendType === 'positive'
                ? 'text-pos font-medium'
                : trendType === 'warning'
                ? 'text-neg font-medium'
                : 'text-ink-2'
            }
          >
            {trend}
          </span>
        </div>
      </div>
    </div>
  );
}
