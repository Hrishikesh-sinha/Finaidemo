import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Eye, EyeOff, Loader2, Shield } from 'lucide-react';

// Sign in and create account. The rules shown here mirror the server's
// (src/server/validation.ts) so people learn them before submitting; the
// server still enforces them and its message is shown if it disagrees.

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const LAST_USERNAME_KEY = 'finai_last_username';
const MAX_INCOME = 10_000_000;

type Mode = 'signin' | 'register';

interface Props {
  onSignedIn: (token: string) => void;
  onOpenAdmin: () => void;
  // Shown above the form, e.g. after a session expires.
  notice?: string | null;
}

async function requestToken(username: string, password: string): Promise<string> {
  const res = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.access_token !== 'string') {
    throw new Error(data.detail || 'Sign-in failed. Check your connection and try again.');
  }
  return data.access_token;
}

const readLastUsername = () => {
  try {
    return localStorage.getItem(LAST_USERNAME_KEY) ?? '';
  } catch {
    return '';
  }
};

export function AuthScreen({ onSignedIn, onOpenAdmin, notice }: Props) {
  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState(readLastUsername);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [income, setIncome] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const firstField = useRef<HTMLInputElement>(null);
  const ids = useId();

  // Each mode starts clean; the username carries over because people often
  // switch tabs after typing it.
  // Focus moves to the form only when the person switches tabs, not on page
  // load, where it would open a phone's keyboard over the page.
  const firstRender = useRef(true);
  useEffect(() => {
    setPassword('');
    setConfirm('');
    setError('');
    setTouched({});
    setShowPassword(false);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    firstField.current?.focus();
  }, [mode]);

  const incomeNumber = Number(income);
  const problems: Record<string, string | null> =
    mode === 'register'
      ? {
          username: USERNAME_RE.test(username) ? null : '3–32 characters: letters, numbers, dot, dash or underscore. No spaces.',
          income:
            income.trim() === ''
              ? 'Enter your monthly income.'
              : !Number.isFinite(incomeNumber) || incomeNumber <= 0
                ? 'Enter an amount greater than zero.'
                : incomeNumber > MAX_INCOME
                  ? 'Enter at most ₹1,00,00,000.'
                  : null,
          password: password.length >= 8 && password.length <= 128 ? null : 'Use at least 8 characters.',
          confirm: confirm === password ? null : 'The passwords do not match.'
        }
      : {
          username: username.trim() ? null : 'Enter your username.',
          password: password ? null : 'Enter your password.'
        };
  const firstProblem = Object.entries(problems).find(([, p]) => p)?.[0];
  const shown = (field: string) => (touched[field] ? problems[field] : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(Object.fromEntries(Object.keys(problems).map(k => [k, true])));
    if (firstProblem) {
      document.getElementById(`${ids}-${firstProblem}`)?.focus();
      return;
    }
    setBusy(true);
    setError('');
    const name = username.trim();
    try {
      if (mode === 'register') {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: name, password, monthly_income: Math.round(incomeNumber * 100) / 100 })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'The account could not be created. Try again.');
      }
      // A new account signs straight in; nobody should have to type it twice.
      const token = await requestToken(name, password);
      try {
        localStorage.setItem(LAST_USERNAME_KEY, name);
      } catch {
        // Private mode: remembering the username is a convenience only.
      }
      onSignedIn(token);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  // Point assistive tech at whichever line is visible under the field.
  const describedBy = (field: string, hint?: boolean) =>
    shown(field) ? `${ids}-${field}-error` : hint ? `${ids}-${field}-hint` : undefined;

  return (
    <div className="min-h-screen bg-canvas text-ink font-sans grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* What FinAI is for, said with the product's own equation. */}
      <section aria-label="About FinAI" className="relative px-6 pt-10 pb-10 sm:px-12 lg:px-16 lg:py-16 flex flex-col bg-side text-side-ink">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-accent rounded-md flex items-center justify-center font-bold text-white text-sm" aria-hidden="true">₹</div>
          <span className="text-base font-semibold tracking-tight text-white">FinAI</span>
        </div>

        <div className="mt-12 lg:mt-auto lg:mb-auto max-w-xl">
          <p className="auth-equation" aria-label="Income minus spent equals saved">
            {/* Each operator stays with the term after it when the line wraps. */}
            <span className="text-side-ink">Income</span>
            <span className="auth-term"><span className="auth-op" aria-hidden="true">−</span><span className="text-white">Spent</span></span>
            <span className="auth-term"><span className="auth-op" aria-hidden="true">=</span><span className="text-accent-on-side">Saved</span></span>
          </p>
          <p className="mt-6 text-[15px] leading-relaxed text-side-ink max-w-[46ch]">
            FinAI keeps track of the middle term, predicts it, and works out the easiest way to change it.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-side-ink max-w-[48ch] hidden sm:block">
            <Point>Log spending by hand, by voice, or from a photo of the receipt.</Point>
            <Point>See the next four weeks forecast, by Chronos-2 once you have 26 weeks of history.</Point>
            <Point>Set a savings goal and get the plan that asks the least of you.</Point>
          </ul>
        </div>

        <p className="mt-10 lg:mt-0 text-xs text-side-ink hidden lg:block">
          A college project (VIT, Review-3). The demo account holds synthetic data, not real financial records.
        </p>
      </section>

      {/* The form */}
      <section aria-label={mode === 'signin' ? 'Sign in' : 'Create account'} className="px-4 pb-12 sm:px-12 lg:py-16 flex items-start lg:items-center justify-center pt-8 lg:pt-16 bg-surface">
        <div className="w-full max-w-sm">
          <div role="tablist" aria-label="Account" className="grid grid-cols-2 p-1 rounded-lg bg-surface border border-line">
            {(['signin', 'register'] as Mode[]).map(m => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`py-2 text-sm rounded-md transition-colors ${mode === m ? 'bg-raised text-ink font-medium' : 'text-ink-2 hover:text-ink'}`}
              >
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <h1 className="mt-8 text-2xl font-semibold tracking-tight">
            {mode === 'signin' ? 'Welcome back' : 'Start with your income'}
          </h1>
          <p className="mt-1.5 text-sm text-ink-2">
            {mode === 'signin'
              ? 'Sign in to see where this month went.'
              : 'Your savings rate and goals are worked out from it. Everything else comes from what you log.'}
          </p>

          {notice && !error && (
            <div role="status" className="mt-6 p-3 text-sm rounded-lg border bg-caution/10 text-caution border-caution/30">{notice}</div>
          )}
          {error && (
            <div role="alert" className="mt-6 p-3 text-sm rounded-lg border bg-neg/10 text-neg border-neg/30">{error}</div>
          )}

          <form onSubmit={submit} noValidate className="mt-6 space-y-4">
            <Field
              id={`${ids}-username`}
              label="Username"
              hint={mode === 'register' ? 'Letters, numbers, dot, dash or underscore.' : undefined}
              error={shown('username')}
            >
              <input
                ref={firstField}
                id={`${ids}-username`}
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onBlur={() => setTouched(t => ({ ...t, username: true }))}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={32}
                aria-invalid={Boolean(shown('username'))}
                aria-describedby={describedBy('username', mode === 'register')}
                className="auth-input"
              />
            </Field>

            {mode === 'register' && (
              <Field id={`${ids}-income`} label="Monthly income (₹)" hint="Take-home pay for a typical month." error={shown('income')}>
                <input
                  id={`${ids}-income`}
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="any"
                  value={income}
                  onChange={e => setIncome(e.target.value)}
                  onBlur={() => setTouched(t => ({ ...t, income: true }))}
                  aria-invalid={Boolean(shown('income'))}
                  aria-describedby={describedBy('income', true)}
                  className="auth-input tabular-nums"
                />
              </Field>
            )}

            <Field
              id={`${ids}-password`}
              label="Password"
              hint={mode === 'register' ? 'At least 8 characters.' : undefined}
              error={shown('password')}
            >
              <div className="relative">
                <input
                  id={`${ids}-password`}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onBlur={() => setTouched(t => ({ ...t, password: true }))}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  maxLength={128}
                  aria-invalid={Boolean(shown('password'))}
                  aria-describedby={describedBy('password', mode === 'register')}
                  className="auth-input pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 px-3 flex items-center text-ink-2 hover:text-ink rounded-r-lg"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>

            {mode === 'register' && (
              <Field id={`${ids}-confirm`} label="Confirm password" error={shown('confirm')}>
                <input
                  id={`${ids}-confirm`}
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  onBlur={() => setTouched(t => ({ ...t, confirm: true }))}
                  autoComplete="new-password"
                  maxLength={128}
                  aria-invalid={Boolean(shown('confirm'))}
                  aria-describedby={describedBy('confirm')}
                  className="auth-input"
                />
              </Field>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full mt-2 py-2.5 rounded-lg bg-accent text-canvas text-sm font-medium hover:bg-accent-hi disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              {busy ? (mode === 'signin' ? 'Signing in' : 'Creating your account') : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-sm text-ink-2">
            {mode === 'signin' ? 'New to FinAI? ' : 'Already have an account? '}
            <button type="button" onClick={() => setMode(mode === 'signin' ? 'register' : 'signin')} className="text-accent hover:underline">
              {mode === 'signin' ? 'Create an account' : 'Sign in'}
            </button>
          </p>

          <div className="mt-10 pt-5 border-t border-line flex items-center justify-between gap-3">
            <p className="text-xs text-ink-3 lg:hidden">Demo account data is synthetic.</p>
            <button type="button" onClick={onOpenAdmin} className="ml-auto flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink">
              <Shield className="w-3.5 h-3.5" aria-hidden="true" />
              Admin sign-in
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-1.5">{label}</label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-neg">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

function Point({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-accent-on-side shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}
