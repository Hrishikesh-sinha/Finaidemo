export interface UserProfile {
  username: string;
  monthly_income: number;
  target_savings_percent: number;
}

export interface Transaction {
  id: number | string;
  // On flagged transactions: the person's saved verdict, if any.
  review?: 'expected' | 'dismissed' | null;
  amount: number;
  merchant: string;
  category: string;
  date: string;
}

// The rolling window the 30-day figures cover, and how much of it has
// anything logged. Absent for the admin view's sample users.
export interface ReportingWindow {
  window_days: number;
  window_start: string;
  window_end: string;
  data_through: string | null;
  days_since_last_entry: number | null;
  unlogged_days_in_window: number;
  complete: boolean;
}

export interface DashboardStats {
  reporting?: ReportingWindow;
  // The forecast covers the weeks after this date (the latest transaction).
  forecast_starts_after?: string | null;
  category_breakdown?: Record<string, number>;
  total_spent: number;
  savings_rate: number;
  health_score: number;
  forecast_next_30_days: number;
  // Which method actually produced forecast_next_30_days, plus why, so the UI
  // can name it. Optional because mock/admin fixtures do not set them.
  forecast_model?: string;
  forecast_reason?: string | null;
  forecast_lower_30_days?: number | null;
  forecast_upper_30_days?: number | null;
  forecast_weeks_of_history?: number;
  // Weekly series behind the forecast: recent history, and the service's
  // forecast with its range (null when the service was unreachable).
  forecast_weekly?: {
    week_starts: string[];
    history: number[];
    forecast: number[] | null;
    lower: number[] | null;
    upper: number[] | null;
  };
  // Set when the account's transactions come from the synthetic demo seed.
  synthetic_demo_data?: boolean;
  data_source?: 'synthetic' | 'kaggle' | 'user' | null;
  data_import?: { dataset: string; url: string; original_first: string; original_last: string; shift_weeks: number } | null;
  // The user's own profile figures, so the dashboard does not back-calculate them.
  monthly_income?: number;
  target_savings_percent?: number;
  smart_budget: Record<string, number>;
  anomalies: Transaction[];
}

export interface MockTransaction extends Transaction {
  type?: 'expense' | 'income';
  isAnomaly?: boolean;
  anomalyReason?: string;
  notes?: string;
}

export interface MockUser {
  id: string;
  name: string;
  username: string;
  email: string;
  avatarColor: string;
  monthly_income: number;
  target_savings_percent: number;
  spending_pattern_title: string;
  spending_pattern_description: string;
  transactions: MockTransaction[];
  stats: DashboardStats;
  anomaly_flag: {
    isFlagged: boolean;
    severity: 'critical' | 'warning' | 'normal';
    badgeText: string;
    reason: string;
  };
}

export interface AdminSummary {
  totalUsers: number;
  combinedIncome: number;
  combinedExpenses: number;
  overallSavingsRate: number;
  averageHealthScore: number;
  flaggedUsersCount: number;
}
