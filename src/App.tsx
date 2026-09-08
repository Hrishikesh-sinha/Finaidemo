/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, type FormEvent } from 'react';
import { Dashboard } from './components/Dashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { 
  Lock, User as UserIcon, Loader2, ShieldCheck, Users, ArrowRight, 
  Shield, Eye, EyeOff, X, LogOut, ArrowLeft, AlertTriangle 
} from 'lucide-react';
import { MockUser } from './types';
import { mockUsers } from './data/mockSeedData';

// Hardcoded demo credentials for presentation purposes only. In production this would be handled by a real authentication backend (e.g. Firebase Auth) with hashed passwords, not plaintext.
const DEMO_ADMIN_CREDENTIALS = {
  id: 'admin',
  password: 'finai@admin123'
};

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Admin Mode state (demo UX for college project)
  const [isAdminMode, setIsAdminMode] = useState<boolean>(false);
  const [adminSelectedUser, setAdminSelectedUser] = useState<MockUser | null>(null);
  const [showAdminLogin, setShowAdminLogin] = useState<boolean>(false);
  const [adminId, setAdminId] = useState<string>('admin');
  const [adminPassword, setAdminPassword] = useState<string>('');
  const [showAdminPassword, setShowAdminPassword] = useState<boolean>(false);
  const [adminError, setAdminError] = useState<string>('');

  // Auth state
  const [username, setUsername] = useState('demo_user');
  const [password, setPassword] = useState('password123');
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem('finai_token');
    if (t) setToken(t);
    setLoading(false);
  }, []);

  const handleAuth = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    setAuthLoading(true);
    setError('');

    try {
      if (isRegistering) {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, monthly_income: 50000.0 })
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || 'Registration failed');
        }
        setIsRegistering(false);
        setError('Registration successful. Please login.');
      } else {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);

        const res = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData.toString()
        });
        if (!res.ok) throw new Error('Invalid credentials');
        
        const data = await res.json();
        setToken(data.access_token);
        localStorage.setItem('finai_token', data.access_token);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication error');
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => {
    setToken(null);
    setIsAdminMode(false);
    setAdminSelectedUser(null);
    localStorage.removeItem('finai_token');
  };

  const handleAdminLogin = (e: FormEvent) => {
    e.preventDefault();
    if (
      adminId.trim() === DEMO_ADMIN_CREDENTIALS.id &&
      adminPassword === DEMO_ADMIN_CREDENTIALS.password
    ) {
      setAdminError('');
      setAdminPassword('');
      setShowAdminLogin(false);
      setIsAdminMode(true);
      setAdminSelectedUser(null);
    } else {
      setAdminError('Incorrect ID or password');
      // Do not clear the ID field, only the password field, after a failed attempt
      setAdminPassword('');
    }
  };

  const handleAdminLogout = () => {
    setIsAdminMode(false);
    setAdminSelectedUser(null);
    setShowAdminLogin(false);
    setAdminPassword('');
    setAdminError('');
    setToken(null);
    localStorage.removeItem('finai_token');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0D1117]">
        <Loader2 className="w-8 h-8 animate-spin text-[#4A9EFF]" />
      </div>
    );
  }

  // 1. ADMIN MODE VIEW
  if (isAdminMode) {
    return (
      <div className="min-h-screen bg-[#0D1117] text-[#E6EDF3] overflow-y-auto font-sans w-full">
        {/* Admin Navigation Bar */}
        <nav className="bg-[#0D1117]/95 backdrop-blur-md border-b border-[#2A2F3A] sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16 items-center">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-[#4A9EFF] rounded-lg flex items-center justify-center font-bold text-white text-sm shadow-xs">
                  F
                </div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-base font-bold tracking-tight text-[#E6EDF3]">FinAI</h1>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#4A9EFF]/10 text-[#4A9EFF] border border-[#4A9EFF]/30">
                    Admin Telemetry
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-[#161B22] rounded-full border border-[#2A2F3A]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3FB950] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#3FB950]"></span>
                  </span>
                  <span className="text-xs text-[#8B949E] font-medium">Mock Seed Cohort (4 Accounts)</span>
                </div>

                <button 
                  id="nav-admin-logout"
                  onClick={handleAdminLogout}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2A2F3A] hover:border-[#F85149]/40 text-[#8B949E] hover:text-[#F85149] hover:bg-[#F85149]/5 text-xs font-medium transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Exit Admin</span>
                </button>
              </div>
            </div>
          </div>
        </nav>

        {/* Admin Content: either cohort table or mock user detail */}
        {adminSelectedUser ? (
          <Dashboard 
            mockUser={adminSelectedUser}
            onBackToAdmin={() => setAdminSelectedUser(null)}
            onSelectUser={setAdminSelectedUser}
            allMockUsers={mockUsers}
          />
        ) : (
          <AdminDashboard 
            onSelectUser={setAdminSelectedUser}
            onSwitchToUserMode={() => {
              setIsAdminMode(false);
            }}
            onExitAdmin={handleAdminLogout}
          />
        )}
      </div>
    );
  }

  // 2. LOGIN SCREEN (WHEN NOT LOGGED IN AS USER OR ADMIN)
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0D1117] text-[#E6EDF3] px-4 py-12 font-sans">
        {showAdminLogin ? (
          /* ADMIN LOGIN FORM */
          <div className="max-w-md w-full bg-[#161B22] rounded-xl p-8 border border-[#2A2F3A] space-y-6 relative">
            {/* Top header row with close button */}
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#4A9EFF]/10 text-[#4A9EFF] border border-[#4A9EFF]/30">
                Institutional Access
              </span>
              <button
                id="admin-login-close-btn"
                type="button"
                onClick={() => {
                  setShowAdminLogin(false);
                  setAdminError('');
                  setAdminPassword('');
                }}
                className="text-[#8B949E] hover:text-[#E6EDF3] p-1.5 rounded-md hover:bg-[#21262D] transition-colors"
                title="Close and return to user login"
                aria-label="Close admin login"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-center">
              <div className="w-12 h-12 bg-[#4A9EFF]/10 text-[#4A9EFF] border border-[#4A9EFF]/20 rounded-xl mx-auto flex items-center justify-center mb-3">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h1 className="text-xl font-bold text-[#E6EDF3] tracking-tight">Admin Portal</h1>
              <p className="text-[#8B949E] mt-1 text-xs">Multi-account telemetry, anomaly audit & ML verification</p>
            </div>

            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label htmlFor="admin-id-input" className="block text-xs uppercase tracking-wider font-semibold text-[#8B949E] mb-1.5">
                  Admin ID
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <UserIcon className="h-4 w-4 text-[#8B949E]" />
                  </div>
                  <input
                    id="admin-id-input"
                    type="text"
                    required
                    value={adminId}
                    onChange={e => setAdminId(e.target.value)}
                    className="pl-10 w-full px-4 py-2.5 bg-[#0D1117] border border-[#2A2F3A] rounded-lg text-[#E6EDF3] placeholder-[#8B949E] focus:border-[#4A9EFF] focus:ring-1 focus:ring-[#4A9EFF] outline-none transition-all text-xs"
                    placeholder="admin"
                    autoComplete="username"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="admin-password-input" className="block text-xs uppercase tracking-wider font-semibold text-[#8B949E] mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-[#8B949E]" />
                  </div>
                  <input
                    id="admin-password-input"
                    type={showAdminPassword ? 'text' : 'password'}
                    required
                    value={adminPassword}
                    onChange={e => setAdminPassword(e.target.value)}
                    className="pl-10 pr-10 w-full px-4 py-2.5 bg-[#0D1117] border border-[#2A2F3A] rounded-lg text-[#E6EDF3] placeholder-[#8B949E] focus:border-[#4A9EFF] focus:ring-1 focus:ring-[#4A9EFF] outline-none transition-all text-xs"
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                  <button
                    id="admin-password-toggle-btn"
                    type="button"
                    onClick={() => setShowAdminPassword(!showAdminPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#8B949E] hover:text-[#E6EDF3] focus:outline-none"
                    aria-label={showAdminPassword ? 'Hide password' : 'Show password'}
                  >
                    {showAdminPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                id="admin-login-submit-btn"
                type="submit"
                className="w-full bg-[#4A9EFF] hover:bg-[#3b8eed] text-white font-medium py-2.5 rounded-lg transition-colors flex justify-center items-center text-xs tracking-wide shadow-xs"
              >
                Authorize & Open Telemetry
              </button>

              {adminError && (
                <div id="admin-login-error" className="p-3 text-xs rounded-lg border bg-[#F85149]/10 text-[#F85149] border-[#F85149]/30 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 text-[#F85149]" />
                  <span>{adminError}</span>
                </div>
              )}

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  id="admin-back-btn"
                  type="button"
                  onClick={() => {
                    setShowAdminLogin(false);
                    setAdminError('');
                    setAdminPassword('');
                  }}
                  className="text-[#8B949E] hover:text-[#E6EDF3] transition-colors flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to login</span>
                </button>

                <button
                  id="admin-autofill-btn"
                  type="button"
                  onClick={() => {
                    setAdminId('admin');
                    setAdminPassword('finai@admin123');
                    setAdminError('');
                  }}
                  className="text-[#4A9EFF] hover:underline transition-colors text-xs font-medium"
                  title="Autofill credentials for presentation"
                >
                  Autofill credentials
                </button>
              </div>
            </form>

            {/* Presentation Note */}
            <div className="p-3.5 bg-[#0D1117] rounded-lg border border-[#2A2F3A] text-xs text-[#8B949E] space-y-1">
              <div className="text-[#E6EDF3] font-medium text-[11px] uppercase tracking-wider">Demo Credentials</div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#8B949E]">Admin ID:</span>
                <span className="text-[#E6EDF3] font-medium">admin</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[#8B949E]">Password:</span>
                <span className="text-[#4A9EFF] font-medium">finai@admin123</span>
              </div>
            </div>
          </div>
        ) : (
          /* USER LOGIN / REGISTRATION CARD */
          <div className="max-w-md w-full bg-[#161B22] rounded-xl p-8 border border-[#2A2F3A] space-y-6">
            {/* Header */}
            <div className="text-center">
              <div className="w-12 h-12 bg-[#4A9EFF] rounded-xl mx-auto flex items-center justify-center mb-3 font-bold text-white text-lg shadow-xs">
                F
              </div>
              <div className="flex items-center justify-center gap-2">
                <h1 className="text-2xl font-bold text-[#E6EDF3] tracking-tight">FinAI</h1>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#3FB950]/10 text-[#3FB950] border border-[#3FB950]/30">
                  Portfolio Suite
                </span>
              </div>
              <p className="text-[#8B949E] mt-1 text-xs">Zero-cost intelligence & algorithmic portfolio governance</p>
            </div>

            {/* Quick Continue with demo_user */}
            <button
              id="continue-as-user-btn"
              type="button"
              onClick={() => handleAuth()}
              disabled={authLoading}
              className="w-full bg-[#21262D] hover:bg-[#30363D] border border-[#2A2F3A] text-[#E6EDF3] font-medium py-2.5 px-3 rounded-lg transition-colors flex justify-center items-center gap-2 text-xs"
            >
              {authLoading ? <Loader2 className="w-4 h-4 animate-spin text-[#4A9EFF]" /> : (
                <>
                  <UserIcon className="w-3.5 h-3.5 text-[#4A9EFF]" />
                  <span>Continue with demo_user</span>
                </>
              )}
            </button>

            {/* User credentials form */}
            <form onSubmit={handleAuth} className="space-y-4">
              {error && (
                <div className={`p-3 text-xs rounded-lg border ${error.includes('successful') ? 'bg-[#3FB950]/10 text-[#3FB950] border-[#3FB950]/30' : 'bg-[#F85149]/10 text-[#F85149] border-[#F85149]/30'}`}>
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs uppercase tracking-wider font-semibold text-[#8B949E] mb-1.5">Username</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <UserIcon className="h-4 w-4 text-[#8B949E]" />
                  </div>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="pl-10 w-full px-4 py-2.5 bg-[#0D1117] border border-[#2A2F3A] rounded-lg text-[#E6EDF3] placeholder-[#8B949E] focus:border-[#4A9EFF] focus:ring-1 focus:ring-[#4A9EFF] outline-none transition-all text-xs"
                    placeholder="demo_user"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider font-semibold text-[#8B949E] mb-1.5">Password</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-[#8B949E]" />
                  </div>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="pl-10 w-full px-4 py-2.5 bg-[#0D1117] border border-[#2A2F3A] rounded-lg text-[#E6EDF3] placeholder-[#8B949E] focus:border-[#4A9EFF] focus:ring-1 focus:ring-[#4A9EFF] outline-none transition-all text-xs"
                    placeholder="password123"
                  />
                </div>
              </div>

              <button 
                type="submit" 
                disabled={authLoading}
                className="w-full bg-[#4A9EFF] hover:bg-[#3b8eed] text-white font-medium py-2.5 rounded-lg transition-colors flex justify-center items-center text-xs tracking-wide shadow-xs"
              >
                {authLoading ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : (isRegistering ? 'CREATE ACCOUNT' : 'LOGIN TO USER ACCOUNT')}
              </button>

              <div className="flex items-center justify-between text-xs pt-1">
                <button 
                  type="button"
                  onClick={() => { setIsRegistering(!isRegistering); setError(''); }}
                  className="text-[#8B949E] hover:text-[#E6EDF3] transition-colors"
                >
                  {isRegistering ? '← Back to Login' : 'Need an account? Register'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUsername('demo_user');
                    setPassword('password123');
                  }}
                  className="text-[#8B949E] hover:text-[#E6EDF3]"
                >
                  Reset demo credentials
                </button>
              </div>
            </form>

            {/* Small Admin Login Link/Button on Main Entry Screen */}
            <div className="pt-4 border-t border-[#2A2F3A] flex items-center justify-between">
              <span className="text-xs text-[#8B949E]">Presentation Administrator?</span>
              <button
                id="admin-login-link-btn"
                type="button"
                onClick={() => {
                  setShowAdminLogin(true);
                  setAdminError('');
                  setAdminPassword('');
                }}
                className="flex items-center gap-1.5 text-xs font-medium text-[#E6EDF3] hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-[#2A2F3A] hover:border-[#8B949E]/50 bg-[#21262D]"
              >
                <Shield className="w-3.5 h-3.5 text-[#4A9EFF]" />
                <span>Admin Login</span>
              </button>
            </div>

            <div className="pt-1 text-center text-[11px] text-[#8B949E]">
              FinAI • Institutional Portfolio Suite
            </div>
          </div>
        )}
      </div>
    );
  }

  // 3. LOGGED-IN USER VIEW
  return (
    <div className="min-h-screen bg-[#0D1117] text-[#E6EDF3] overflow-y-auto font-sans w-full">
      <nav className="bg-[#0D1117]/95 backdrop-blur-md border-b border-[#2A2F3A] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-[#4A9EFF] rounded-lg flex items-center justify-center font-bold text-white text-sm shadow-xs">
                F
              </div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-[#E6EDF3]">
                  FinAI
                </h1>
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#3FB950]/10 border border-[#3FB950]/30 text-[#3FB950] text-[11px] font-medium">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3FB950] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#3FB950]"></span>
                  </span>
                  <span>ML Engine Active</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Seamless switch to Admin view from User view via Admin Login */}
              <button
                id="user-nav-switch-to-admin"
                onClick={() => {
                  setToken(null);
                  localStorage.removeItem('finai_token');
                  setShowAdminLogin(true);
                  setAdminError('');
                  setAdminPassword('');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#21262D] hover:bg-[#30363D] text-[#E6EDF3] border border-[#2A2F3A] rounded-lg text-xs font-medium transition-colors"
              >
                <Shield className="w-3.5 h-3.5 text-[#4A9EFF]" />
                <span>Admin Login</span>
              </button>

              <button 
                id="user-nav-signout"
                onClick={logout}
                className="text-xs text-[#8B949E] hover:text-[#E6EDF3] transition-colors font-medium px-2 py-1"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>
      
      <Dashboard token={token} />
    </div>
  );
}
