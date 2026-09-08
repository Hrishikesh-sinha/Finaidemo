// Mock data for demoing the admin view. In production this would come from a real multi-user database.

import { MockUser, MockTransaction, AdminSummary } from '../types';

/**
 * Computes financial health score (0-100) using FinAI's exact local ML/heuristic formula:
 * 1. Savings rate component (0-30 pts): max points if savings rate >= 20%
 * 2. Expense-to-income ratio (0-25 pts): 25 pts if <= 70%, scaled down if > 70%
 * 3. Budget discipline (0-25 pts): 25 pts if total expenses <= monthly income
 * 4. Spending stability (0-20 pts): 20 pts minus (5 pts per detected outlier anomaly)
 */
export function calculateHealthScore(income: number, totalSpent: number, anomaliesCount: number): number {
  const safeIncome = Math.max(income, 1.0);
  const savingsRate = ((safeIncome - totalSpent) / safeIncome) * 100;

  // 1. Savings rate (up to 30 pts)
  const savingsScore = savingsRate > 0 ? Math.min(30, Math.max(0, (savingsRate / 20.0) * 30)) : 0;

  // 2. Expense-to-income ratio <= 70% (up to 25 pts)
  const expenseRatio = totalSpent / safeIncome;
  let expenseScore = 0;
  if (expenseRatio <= 0.7) {
    expenseScore = 25;
  } else {
    expenseScore = Math.max(0, 25 - ((expenseRatio - 0.7) / 0.3) * 25);
  }

  // 3. Budget limit discipline (up to 25 pts)
  const budgetScore = totalSpent <= safeIncome ? 25 : 0;

  // 4. Spending stability (up to 20 pts)
  const stabilityScore = Math.max(0, 20 - (anomaliesCount * 5));

  return Math.round(savingsScore + expenseScore + budgetScore + stabilityScore);
}

// User 1: Priya Sharma - Overspends consistently on Shopping & Lifestyle
const priyaTransactions: MockTransaction[] = [
  { id: 101, amount: 65000.0, merchant: 'TechCorp Solutions Payroll', category: 'Income', date: '2026-08-01', type: 'income', notes: 'Monthly Salary Credit' },
  { id: 102, amount: 14000.0, merchant: 'Prestige Lakeside Apartments', category: 'Bills', date: '2026-08-02', type: 'expense', notes: 'Monthly rent' },
  { id: 103, amount: 12500.0, merchant: 'Zara & Massimo Dutti Mall', category: 'Shopping', date: '2026-08-08', type: 'expense', notes: 'Autumn wardrobe haul' },
  { id: 104, amount: 3200.0, merchant: 'Uber Premier City Rides', category: 'Transport', date: '2026-08-11', type: 'expense', notes: 'Airport & office commutes' },
  { id: 105, amount: 8400.0, merchant: 'Myntra Luxe & Nykaa', category: 'Shopping', date: '2026-08-15', type: 'expense', notes: 'Cosmetics & footwear' },
  { id: 106, amount: 4800.0, merchant: 'Olive Beach & Toast & Tonic', category: 'Food', date: '2026-08-19', type: 'expense', notes: 'Weekend brunch & fine dining' },
  { id: 107, amount: 2600.0, merchant: 'Electricity & Gas Utility', category: 'Bills', date: '2026-08-22', type: 'expense', notes: 'Utility bills' },
  { id: 108, amount: 9100.0, merchant: 'Amazon India Great Sale', category: 'Shopping', date: '2026-08-25', type: 'expense', notes: 'Home decor & accessories' },
  { id: 109, amount: 3600.0, merchant: 'PVR Director\'s Cut & Drinks', category: 'Entertainment', date: '2026-08-28', type: 'expense', notes: 'Movie premiere' }
];

// User 2: Rahul Verma - Disciplined saver, frugal tech lead with >65% savings rate
const rahulTransactions: MockTransaction[] = [
  { id: 201, amount: 95000.0, merchant: 'Razorpay Systems Salary', category: 'Income', date: '2026-08-01', type: 'income', notes: 'Monthly Salary Credit' },
  { id: 202, amount: 12000.0, merchant: 'Greenwood Society Rent', category: 'Bills', date: '2026-08-02', type: 'expense', notes: 'Shared apartment rent' },
  { id: 203, amount: 1800.0, merchant: 'Namma Metro Transit Pass', category: 'Transport', date: '2026-08-04', type: 'expense', notes: 'Monthly smart card recharge' },
  { id: 204, amount: 6400.0, merchant: 'Nature\'s Basket & Supermarket', category: 'Food', date: '2026-08-07', type: 'expense', notes: 'Whole weekly groceries' },
  { id: 205, amount: 1600.0, merchant: 'Airtel Xstream Fiber', category: 'Bills', date: '2026-08-10', type: 'expense', notes: 'High-speed broadband' },
  { id: 206, amount: 2800.0, merchant: 'O\'Reilly Media & AWS Lab', category: 'Shopping', date: '2026-08-14', type: 'expense', notes: 'Technical learning materials' },
  { id: 207, amount: 1500.0, merchant: 'Playo Badminton Court', category: 'Entertainment', date: '2026-08-18', type: 'expense', notes: 'Weekend fitness session' },
  { id: 208, amount: 2400.0, merchant: 'Third Wave Coffee Roasters', category: 'Food', date: '2026-08-23', type: 'expense', notes: 'Coffee meetings' },
  { id: 209, amount: 3000.0, merchant: 'Zerodha Annual Demat Fee', category: 'Bills', date: '2026-08-27', type: 'expense', notes: 'Investment account maintenance' }
];

// User 3: Ananya Iyer - Steady, balanced spending aligned with 50/30/20 heuristic
const ananyaTransactions: MockTransaction[] = [
  { id: 301, amount: 72000.0, merchant: 'Deloitte Consulting Salary', category: 'Income', date: '2026-08-01', type: 'income', notes: 'Monthly Salary Credit' },
  { id: 302, amount: 16000.0, merchant: 'Indiranagar Residency Rent', category: 'Bills', date: '2026-08-02', type: 'expense', notes: 'Studio flat rent' },
  { id: 303, amount: 2200.0, merchant: 'BESCOM Power & Water', category: 'Bills', date: '2026-08-05', type: 'expense', notes: 'Monthly utility billing' },
  { id: 304, amount: 6800.0, merchant: 'BigBasket Fresh & Pantry', category: 'Food', date: '2026-08-09', type: 'expense', notes: 'Organic groceries' },
  { id: 305, amount: 3400.0, merchant: 'Uber & Auto Rides', category: 'Transport', date: '2026-08-13', type: 'expense', notes: 'Client visit travels' },
  { id: 306, amount: 4500.0, merchant: 'FabIndia Ethnic Wear', category: 'Shopping', date: '2026-08-16', type: 'expense', notes: 'Festive apparel' },
  { id: 307, amount: 3200.0, merchant: 'Cult.fit Studio Pass', category: 'Entertainment', date: '2026-08-20', type: 'expense', notes: 'Monthly yoga & gym' },
  { id: 308, amount: 4200.0, merchant: 'The Rameshwaram Cafe & Dinner', category: 'Food', date: '2026-08-24', type: 'expense', notes: 'Dining with colleagues' },
  { id: 309, amount: 1500.0, merchant: 'BookMyShow & Spotify Premium', category: 'Entertainment', date: '2026-08-27', type: 'expense', notes: 'Music streaming & theatre' }
];

// User 4: Karthik Reddy - Steady baseline with an unusual one-off large expense outlier
const karthikTransactions: MockTransaction[] = [
  { id: 401, amount: 80000.0, merchant: 'Flipkart Internet Pvt Ltd', category: 'Income', date: '2026-08-01', type: 'income', notes: 'Monthly Salary Credit' },
  { id: 402, amount: 14000.0, merchant: 'Sobha Dream Acres Rent', category: 'Bills', date: '2026-08-02', type: 'expense', notes: 'Monthly apartment rent' },
  { id: 403, amount: 2100.0, merchant: 'Electricity & Gas Board', category: 'Bills', date: '2026-08-04', type: 'expense', notes: 'Regular utilities' },
  { id: 404, amount: 5600.0, merchant: 'Blinkit & Local Kirana', category: 'Food', date: '2026-08-07', type: 'expense', notes: 'Groceries' },
  { id: 405, amount: 2400.0, merchant: 'Indian Oil Petrol Station', category: 'Transport', date: '2026-08-11', type: 'expense', notes: 'Scooter fuel & service' },
  { 
    id: 406, 
    amount: 42000.0, 
    merchant: 'Imagine Apple Store (MacBook Air)', 
    category: 'Shopping', 
    date: '2026-08-17', 
    type: 'expense', 
    isAnomaly: true, 
    anomalyReason: 'Isolation Forest flagged: Amount exceeds user 30-day baseline by 3.4 standard deviations.',
    notes: 'Sudden hardware replacement for work' 
  },
  { id: 407, amount: 2800.0, merchant: 'Comedy Club & Brewpub', category: 'Entertainment', date: '2026-08-21', type: 'expense', notes: 'Weekend standup comedy' },
  { id: 408, amount: 3100.0, merchant: 'Swiggy Gourmet Deliveries', category: 'Food', date: '2026-08-25', type: 'expense', notes: 'Dinners' },
  { id: 409, amount: 2000.0, merchant: 'JioFiber Broadband Ultra', category: 'Bills', date: '2026-08-28', type: 'expense', notes: 'Work from home internet' }
];

function buildMockUser(
  id: string,
  name: string,
  username: string,
  email: string,
  avatarColor: string,
  monthlyIncome: number,
  patternTitle: string,
  patternDesc: string,
  transactions: MockTransaction[],
  anomalySeverity: 'critical' | 'warning' | 'normal',
  anomalyBadge: string,
  anomalyReason: string
): MockUser {
  const expenseTxs = transactions.filter(t => t.type !== 'income');
  const totalSpent = expenseTxs.reduce((sum, t) => sum + t.amount, 0);
  const savingsRate = Math.max(-100, Number((((monthlyIncome - totalSpent) / monthlyIncome) * 100).toFixed(1)));
  const anomalies = expenseTxs.filter(t => t.isAnomaly);
  const healthScore = calculateHealthScore(monthlyIncome, totalSpent, anomalies.length);

  // Category breakdown
  const catTotals = expenseTxs.reduce((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + t.amount;
    return acc;
  }, {} as Record<string, number>);

  // Smart budget heuristic
  const smartBudget = {
    'Needs (Bills, Food)': Math.round(monthlyIncome * 0.5),
    'Wants (Entertainment, Shopping)': Math.round(monthlyIncome * 0.3),
    'Savings Target': Math.round(monthlyIncome * 0.2),
  };

  // Forecast next 30 days: simple linear/rolling projection
  const forecastNext30Days = Math.round(totalSpent * 0.98);

  return {
    id,
    name,
    username,
    email,
    avatarColor,
    monthly_income: monthlyIncome,
    target_savings_percent: 20.0,
    spending_pattern_title: patternTitle,
    spending_pattern_description: patternDesc,
    transactions,
    stats: {
      total_spent: totalSpent,
      savings_rate: savingsRate,
      health_score: healthScore,
      forecast_next_30_days: forecastNext30Days,
      smart_budget: smartBudget,
      anomalies: anomalies.map(a => ({
        id: a.id,
        amount: a.amount,
        merchant: a.merchant,
        category: a.category,
        date: a.date
      }))
    },
    anomaly_flag: {
      isFlagged: anomalySeverity !== 'normal',
      severity: anomalySeverity,
      badgeText: anomalyBadge,
      reason: anomalyReason
    }
  };
}

export const mockUsers: MockUser[] = [
  buildMockUser(
    'user-01',
    'Priya Sharma',
    'priya_s',
    'priya.sharma@example.in',
    'bg-rose-500/20 text-rose-300 border border-rose-500/30',
    65000.0,
    'Chronic Shopping Overspender',
    'Consistently channels over 50% of total expenses into retail, fashion, and luxury shopping, severely depressing her savings margin.',
    priyaTransactions,
    'critical',
    'High Spend Alert',
    'High Spend Alert: Total expenses consume 89.5% of income. Shopping alone totaled ₹30,000 against a ₹19,500 wants budget.'
  ),
  buildMockUser(
    'user-02',
    'Rahul Verma',
    'rahul_v',
    'rahul.verma@example.in',
    'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    95000.0,
    'Disciplined High-Saver',
    'Demonstrates consistent cost control across utilities and transit with low discretionary burn, sustaining a 66.8% savings velocity.',
    rahulTransactions,
    'normal',
    'Healthy Saver',
    'Disciplined Saver: Consistent 66.8% savings rate with zero budget overruns and zero spending anomalies.'
  ),
  buildMockUser(
    'user-03',
    'Ananya Iyer',
    'ananya_i',
    'ananya.iyer@example.in',
    'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
    72000.0,
    'Balanced 50/30/20 Follower',
    'Maintains steady, predictable outlays matching standard personal finance heuristics with healthy emergency buffer accumulation.',
    ananyaTransactions,
    'normal',
    'Balanced Flow',
    'Steady & Predictable: Healthy 41.9% savings rate with balanced outlays across living essentials and leisure.'
  ),
  buildMockUser(
    'user-04',
    'Karthik Reddy',
    'karthik_r',
    'karthik.reddy@example.in',
    'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    80000.0,
    'Outlier Hardware Spike',
    'Habitually maintains a moderate ₹32k baseline, but recorded an isolated ₹42k MacBook Air transaction that tripped the ML anomaly detector.',
    karthikTransactions,
    'warning',
    'Outlier Flagged',
    'Isolation Forest Anomaly: ₹42,000 Apple Store purchase triggered a 3.4σ deviation warning, docking monthly savings to 7.5%.'
  )
];

/**
 * Calculates aggregated portfolio totals across all mock users
 */
export function getAdminSummary(users: MockUser[]): AdminSummary {
  const totalUsers = users.length;
  const combinedIncome = users.reduce((sum, u) => sum + u.monthly_income, 0);
  const combinedExpenses = users.reduce((sum, u) => sum + u.stats.total_spent, 0);
  const overallSavingsRate = combinedIncome > 0 
    ? Number((((combinedIncome - combinedExpenses) / combinedIncome) * 100).toFixed(1))
    : 0;
  const averageHealthScore = totalUsers > 0
    ? Math.round(users.reduce((sum, u) => sum + u.stats.health_score, 0) / totalUsers)
    : 0;
  const flaggedUsersCount = users.filter(u => u.anomaly_flag.isFlagged).length;

  return {
    totalUsers,
    combinedIncome,
    combinedExpenses,
    overallSavingsRate,
    averageHealthScore,
    flaggedUsersCount
  };
}
