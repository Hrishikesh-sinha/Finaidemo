/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, type FormEvent } from 'react';
import { Dashboard } from './components/Dashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthScreen } from './components/AuthScreen';
import { 
  Lock, User as UserIcon, Loader2, ShieldCheck, Users, ArrowRight, 
  Shield, Eye, EyeOff, X, LogOut, ArrowLeft, AlertTriangle 
} from 'lucide-react';
import { MockUser } from './types';
import { mockUsers } from './data/mockSeedData';

// Admin access is decided by the server: an account opens the admin view only
// if /api/profile reports is_admin, which is granted with
// `npm run admin:grant -- <username>`. No credential lives in this bundle.

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Admin Mode state (demo UX for college project)
  const [isAdminMode, setIsAdminMode] = useState<boolean>(false);
  const [adminSelectedUser, setAdminSelectedUser] = useState<MockUser | null>(null);
  const [showAdminLogin, setShowAdminLogin] = useState<boolean>(false);
  const [adminId, setAdminId] = useState<string>('');
  const [adminLoading, setAdminLoading] = useState<boolean>(false);
  const [adminPassword, setAdminPassword] = useState<string>('');
  const [showAdminPassword, setShowAdminPassword] = useState<boolean>(false);
  const [adminError, setAdminError] = useState<string>('');

  // Shown on the sign-in screen after a session ends on its own.
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  // Who is signed in, as the server reports it. The admin button depends on
  // is_admin from the server, never on anything decided in the browser.
  const [profile, setProfile] = useState<{ username: string; is_admin: boolean } | null>(null);

  useEffect(() => {
    const t = localStorage.getItem('finai_token');
    if (t) setToken(t);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!token) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    fetch('/api/profile', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled && data && typeof data.username === 'string') {
          setProfile({ username: data.username, is_admin: data.is_admin === true });
        }
      })
      .catch(() => {
        // The dashboard reports connection problems; the top bar just stays minimal.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSignedIn = (t: string) => {
    setSessionNotice(null);
    setToken(t);
    localStorage.setItem('finai_token', t);
  };

  const logout = (notice?: string) => {
    setSessionNotice(notice ?? null);
    setToken(null);
    setIsAdminMode(false);
    setAdminSelectedUser(null);
    localStorage.removeItem('finai_token');
  };

  const handleAdminLogin = async (e: FormEvent) => {
    e.preventDefault();
    setAdminLoading(true);
    setAdminError('');
    try {
      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: adminId.trim(), password: adminPassword }).toString()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Sign-in failed');

      const profileRes = await fetch('/api/profile', { headers: { Authorization: `Bearer ${data.access_token}` } });
      const profile = await profileRes.json().catch(() => ({}));
      if (!profileRes.ok || profile.is_admin !== true) {
        throw new Error('This account does not have admin access.');
      }

      setAdminPassword('');
      setShowAdminLogin(false);
      setIsAdminMode(true);
      setAdminSelectedUser(null);
    } catch (err: any) {
      setAdminError(err.message || 'Sign-in failed');
      // Keep the ID, clear the password after a failed attempt.
      setAdminPassword('');
    } finally {
      setAdminLoading(false);
    }
  };

  const handleAdminLogout = () => {
    // An admin who opened the admin view from their own dashboard goes back to it.
    if (token) {
      setIsAdminMode(false);
      setAdminSelectedUser(null);
      return;
    }
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
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  // 1. ADMIN MODE VIEW
  if (isAdminMode) {
    return (
      <div className="min-h-screen bg-canvas text-ink font-sans w-full">
        {/* Admin Navigation Bar */}
        <nav className="bg-canvas/95 backdrop-blur-md border-b border-line sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16 items-center">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center font-bold text-canvas text-sm">
                  ₹
                </div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-base font-bold tracking-tight text-ink">FinAI</h1>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-accent/10 text-accent border border-accent/30">
                    Admin view
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-surface rounded-full border border-line">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pos opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-pos"></span>
                  </span>
                  <span className="text-xs text-ink-2 font-medium">4 sample users</span>
                </div>

                <button 
                  id="nav-admin-logout"
                  onClick={handleAdminLogout}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line hover:border-neg/40 text-ink-2 hover:text-neg hover:bg-neg/5 text-xs font-medium transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Leave admin view</span>
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
  if (!token && !showAdminLogin) {
    return (
      <AuthScreen
        onSignedIn={handleSignedIn}
        notice={sessionNotice}
        onOpenAdmin={() => {
          setShowAdminLogin(true);
          setAdminError('');
          setAdminPassword('');
        }}
      />
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas text-ink px-4 py-12 font-sans">
        {showAdminLogin ? (
          /* ADMIN LOGIN FORM */
          <div className="max-w-md w-full bg-surface rounded-lg p-8 border border-line space-y-6 relative">
            {/* Top header row with close button */}
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-accent/10 text-accent border border-accent/30">
                Admin
              </span>
              <button
                id="admin-login-close-btn"
                type="button"
                onClick={() => {
                  setShowAdminLogin(false);
                  setAdminError('');
                  setAdminPassword('');
                }}
                className="text-ink-2 hover:text-ink p-1.5 rounded-md hover:bg-raised transition-colors"
                title="Close and return to user login"
                aria-label="Close admin login"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-center">
              <div className="w-12 h-12 bg-accent/10 text-accent border border-accent/20 rounded-lg mx-auto flex items-center justify-center mb-3">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h1 className="text-xl font-bold text-ink tracking-tight">Admin sign-in</h1>
              <p className="text-ink-2 mt-1 text-xs">Multi-account telemetry, anomaly audit & ML verification</p>
            </div>

            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label htmlFor="admin-id-input" className="block text-xs font-semibold text-ink-2 mb-1.5">
                  Admin ID
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <UserIcon className="h-4 w-4 text-ink-2" />
                  </div>
                  <input
                    id="admin-id-input"
                    type="text"
                    required
                    value={adminId}
                    onChange={e => setAdminId(e.target.value)}
                    className="pl-10 w-full px-4 py-2.5 bg-canvas border border-line rounded-lg text-ink placeholder-ink-2 focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all text-xs"
                    placeholder="admin account username"
                    autoComplete="username"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="admin-password-input" className="block text-xs font-semibold text-ink-2 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-ink-2" />
                  </div>
                  <input
                    id="admin-password-input"
                    type={showAdminPassword ? 'text' : 'password'}
                    required
                    value={adminPassword}
                    onChange={e => setAdminPassword(e.target.value)}
                    className="pl-10 pr-10 w-full px-4 py-2.5 bg-canvas border border-line rounded-lg text-ink placeholder-ink-2 focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all text-xs"
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                  <button
                    id="admin-password-toggle-btn"
                    type="button"
                    onClick={() => setShowAdminPassword(!showAdminPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-ink-2 hover:text-ink focus:outline-none"
                    aria-label={showAdminPassword ? 'Hide password' : 'Show password'}
                  >
                    {showAdminPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                id="admin-login-submit-btn"
                type="submit"
                disabled={adminLoading}
                className="w-full bg-accent hover:bg-accent-hi text-canvas font-medium py-2.5 rounded-lg transition-colors flex justify-center items-center text-xs disabled:opacity-50"
              >
                {adminLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Open admin view'}
              </button>

              {adminError && (
                <div id="admin-login-error" className="p-3 text-xs rounded-lg border bg-neg/10 text-neg border-neg/30 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 text-neg" />
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
                  className="text-ink-2 hover:text-ink transition-colors flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to login</span>
                </button>

              </div>
            </form>

          </div>
        ) : null}
      </div>
    );
  }

  // 3. LOGGED-IN USER VIEW: the dashboard draws its own sidebar shell.
  return (
    <Dashboard
      token={token}
      username={profile?.username}
      isAdmin={profile?.is_admin === true}
      onOpenAdmin={() => {
        setAdminSelectedUser(null);
        setIsAdminMode(true);
      }}
      onSignOut={() => logout()}
      onLogout={() => logout('Your session has ended. Sign in again to continue.')}
    />
  );
}
