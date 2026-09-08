export interface UserProfile {
  username: string;
  monthly_income: number;
  target_savings_percent: number;
}

export interface Transaction {
  id: number;
  amount: number;
  merchant: string;
  category: string;
  date: string;
}

export interface DashboardStats {
  total_spent: number;
  savings_rate: number;
  health_score: number;
  forecast_next_30_days: number;
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
