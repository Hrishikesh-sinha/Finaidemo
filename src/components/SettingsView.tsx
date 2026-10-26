import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Check, Download, Eye, EyeOff, Loader2, RotateCcw, ShieldCheck } from 'lucide-react';
import type { Transaction } from '../types';
import { DataModelsSection } from './DataModelsSection';

interface Props {
  token: string;
  username?: string;
  isAdmin?: boolean;
  income: number;
  target: number;
  // Spending in the same rolling 30-day window the overview uses.
  spentLast30: number;
  windowComplete?: boolean;
  transactions: Transaction[];
  synthetic?: boolean;
  dataSource?: 'synthetic' | 'kaggle' | 'user' | null;
  onSaved: () => void;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const PRESETS = [10, 20, 30];

// Settings. Every preview here is plain arithmetic on the figures shown, using
// the server's own formulas (savings = income - spending in the last 30 days;
// target = income x percent; 50/30/20 split of income), so what you see
// before saving is what the overview shows after.
export function SettingsView({ token, username, isAdmin, income, target, spentLast30, windowComplete, transactions, synthetic, dataSource, onSaved }: Props) {
  const [incomeText, setIncomeText] = useState(String(income));
  const [targetPct, setTargetPct] = useState(target);
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [changing, setChanging] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { setIncomeText(String(income)); }, [income]);
  useEffect(() => { setTargetPct(target); }, [target]);

  const incomeNum = Number(incomeText);
  const incomeValid = incomeText.trim() !== '' && Number.isFinite(incomeNum) && incomeNum > 0 && incomeNum <= 10_000_000;
  const targetValid = Number.isFinite(targetPct) && targetPct >= 0 && targetPct <= 90;
  const dirty = incomeNum !== income || targetPct !== target;

  // Live preview (only when the inputs are valid).
  const preview = useMemo(() => {
    if (!incomeValid || !targetValid) return null;
    const goal = (incomeNum * targetPct) / 100;
    const saved = incomeNum - spentLast30;
    return {
      goal,
      saved,
      rate: (saved / incomeNum) * 100,
      gap: goal - saved,
      split: { needs: incomeNum * 0.5, wants: incomeNum * 0.3, savings: incomeNum * 0.2 }
    };
  }, [incomeNum, incomeValid, targetPct, targetValid, spentLast30]);

  const dataSummary = useMemo(() => {
    if (transactions.length === 0) return null;
    const times = transactions.map(t => new Date(t.date).getTime()).filter(Number.isFinite);
    const total = transactions.reduce((s, t) => s + t.amount, 0);
    return { count: transactions.length, first: new Date(Math.min(...times)).toISOString(), last: new Date(Math.max(...times)).toISOString(), total };
  }, [transactions]);

  const reset = () => {
    setIncomeText(String(income));
    setTargetPct(target);
    setProfileMsg(null);
  };

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    if (!incomeValid) return setProfileMsg({ ok: false, text: 'Enter a monthly income between ₹1 and ₹1,00,00,000.' });
    if (!targetValid) return setProfileMsg({ ok: false, text: 'Choose a savings target between 0% and 90%.' });
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ monthly_income: incomeNum, target_savings_percent: targetPct })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not save. Try again.');
      setProfileMsg({ ok: true, text: 'Saved. The overview, budget and planner now use these figures.' });
      onSaved();
    } catch (err: any) {
      setProfileMsg({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  };

  // Length is the one property that reliably makes a password harder to
  // guess; the meter measures only that and says so.
  const strength = next.length === 0 ? 0 : next.length < 8 ? 1 : next.length < 12 ? 2 : next.length < 16 ? 3 : 4;
  const strengthLabel = ['', 'Too short', 'Acceptable', 'Good', 'Strong'][strength];
  const matches = confirm.length > 0 && confirm === next;

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (!current) return setPwMsg({ ok: false, text: 'Enter your current password.' });
    if (next.length < 8) return setPwMsg({ ok: false, text: 'Use at least 8 characters for the new password.' });
    if (next !== confirm) return setPwMsg({ ok: false, text: 'The new passwords do not match.' });
    setChanging(true);
    try {
      const res = await fetch('/api/profile/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: current, new_password: next })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Could not change the password.');
      setCurrent(''); setNext(''); setConfirm('');
      setPwMsg({ ok: true, text: 'Password changed. Use the new one next time you sign in.' });
    } catch (err: any) {
      setPwMsg({ ok: false, text: err.message });
    } finally {
      setChanging(false);
    }
  };

  // Export everything logged, as CSV, built in the browser from the records
  // already loaded. Quotes are doubled so merchant names with commas survive.
  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [...transactions]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(t => [new Date(t.date).toISOString().slice(0, 10), esc(t.merchant), t.category, t.amount.toFixed(2)].join(','));
    const csv = ['date,merchant,category,amount_inr', ...rows].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `finai-transactions-${username ?? 'export'}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) =>
    m ? <p role={m.ok ? 'status' : 'alert'} className={`text-sm ${m.ok ? 'text-pos' : 'text-neg'}`}>{m.text}</p> : null;
  const card = 'rounded-lg border border-line bg-surface p-6';

  return (
    <div className="space-y-6">
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6 min-w-0">
        {/* ---------------- Income and goal, with live preview ---------------- */}
        <form onSubmit={saveProfile} noValidate className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-ink">Income and goal</h2>
              <p className="mt-1 text-sm text-ink-2 max-w-[55ch]">Used for your savings rate, the 50/30/20 budget and the savings planner. Changing them never alters a transaction.</p>
            </div>
            {dirty && (
              <span id="settings-unsaved" className="text-xs px-2 py-1 rounded-md bg-accent-dim text-accent-hi">Unsaved changes</span>
            )}
          </div>

          <div className="mt-6 grid gap-8 lg:grid-cols-2">
            <div className="space-y-6">
              <div>
                <label htmlFor="set-income" className="block text-sm font-medium text-ink mb-1.5">Monthly income (₹)</label>
                <input
                  id="set-income"
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="any"
                  value={incomeText}
                  onChange={e => setIncomeText(e.target.value)}
                  aria-invalid={!incomeValid}
                  className="auth-input tabular-nums"
                />
                <p className={`mt-1.5 text-xs ${incomeValid ? 'text-ink-3' : 'text-neg'}`}>
                  {incomeValid ? 'Take-home pay for a typical month.' : 'Enter an amount between ₹1 and ₹1,00,00,000.'}
                </p>
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <label htmlFor="set-target-range" className="text-sm font-medium text-ink">Savings target</label>
                  <span className="text-sm text-ink tabular-nums">
                    <span className="font-semibold">{targetPct}%</span>
                    {preview && <span className="text-ink-2"> = {inr(preview.goal)} a month</span>}
                  </span>
                </div>
                <input
                  id="set-target-range"
                  type="range"
                  min="0"
                  max="90"
                  step="1"
                  value={targetPct}
                  onChange={e => setTargetPct(Number(e.target.value))}
                  className="mt-3 w-full accent-[var(--color-accent)]"
                  aria-valuetext={`${targetPct} percent of income`}
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {PRESETS.map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setTargetPct(p)}
                      aria-pressed={targetPct === p}
                      className={`px-3 py-1 rounded-md text-xs border ${targetPct === p ? 'border-accent text-accent-hi bg-accent-dim' : 'border-line-strong text-ink-2 hover:text-ink'}`}
                    >
                      {p}%
                    </button>
                  ))}
                  <label className="ml-auto flex items-center gap-2 text-xs text-ink-2">
                    Exact
                    <input
                      type="number"
                      min="0"
                      max="90"
                      step="1"
                      value={targetPct}
                      onChange={e => setTargetPct(Math.round(Number(e.target.value)))}
                      aria-label="Savings target, exact percent"
                      className="w-16 h-8 px-2 rounded-md bg-canvas border text-sm text-ink tabular-nums"
                    />
                  </label>
                </div>
                {!targetValid && <p className="mt-1.5 text-xs text-neg">Choose between 0% and 90%.</p>}
              </div>
            </div>

            {/* Live preview */}
            <div id="settings-preview" className="rounded-md bg-canvas border border-line p-5" aria-live="polite">
              <p className="text-xs text-ink-2">Preview with these settings, against your last 30 days</p>
              {preview ? (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-ink-2">Would be saved</p>
                      <p className={`text-2xl font-semibold tabular-nums ${preview.saved < 0 ? 'text-neg' : 'text-ink'}`}>{preview.saved < 0 ? '−' : ''}{inr(Math.abs(preview.saved))}</p>
                      <p className="text-xs text-ink-2 tabular-nums">{preview.rate.toFixed(1)}% of income</p>
                    </div>
                    <div>
                      <p className="text-xs text-ink-2">Goal</p>
                      <p className="text-2xl font-semibold tabular-nums text-ink">{inr(preview.goal)}</p>
                      <p className="text-xs text-ink-2">{targetPct}% of income</p>
                    </div>
                  </div>
                  <p className={`mt-3 flex items-center gap-1.5 text-sm ${preview.gap <= 0 ? 'text-pos' : 'text-caution'}`}>
                    {preview.gap <= 0
                      ? <><Check className="w-4 h-4" aria-hidden="true" /> Goal met with {inr(-preview.gap)} to spare</>
                      : <>Short of the goal by {inr(preview.gap)} a month</>}
                  </p>

                  <div className="mt-5">
                    <p className="text-xs text-ink-2">50/30/20 split of this income</p>
                    <div className="mt-2 flex h-2.5 rounded-full overflow-hidden" aria-hidden="true">
                      <div className="bg-ink-2" style={{ width: '50%' }} />
                      <div className="bg-line-strong" style={{ width: '30%' }} />
                      <div className="bg-pos" style={{ width: '20%' }} />
                    </div>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div><dt className="text-ink-2">Needs 50%</dt><dd className="text-ink font-medium tabular-nums">{inr(preview.split.needs)}</dd></div>
                      <div><dt className="text-ink-2">Wants 30%</dt><dd className="text-ink font-medium tabular-nums">{inr(preview.split.wants)}</dd></div>
                      <div><dt className="text-ink-2">Savings 20%</dt><dd className="text-ink font-medium tabular-nums">{inr(preview.split.savings)}</dd></div>
                    </dl>
                  </div>
                  <p className="mt-4 text-xs text-ink-3">
                    Spending in the last 30 days: {inr(spentLast30)}.
                    {windowComplete === false && ' Some recent days have no entries, so this may be understated.'}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-ink-2">Enter a valid income and target to see the preview.</p>
              )}
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-line flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving || !dirty}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hi disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Save changes
            </button>
            {dirty && (
              <button type="button" onClick={reset} className="px-3 py-2 rounded-lg text-sm text-ink-2 hover:text-ink inline-flex items-center gap-1.5">
                <RotateCcw className="w-4 h-4" aria-hidden="true" /> Reset
              </button>
            )}
            {!dirty && !profileMsg && <span className="text-xs text-ink-3">No changes to save.</span>}
            <Msg m={profileMsg} />
          </div>
        </form>

        {/* ---------------- Password ---------------- */}
        <form onSubmit={changePassword} noValidate className={card}>
          <h2 className="text-xl font-semibold text-ink">Password</h2>
          <p className="mt-1 text-sm text-ink-2">You need your current password to set a new one.</p>
          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            <div>
              <label htmlFor="pw-current" className="block text-sm font-medium text-ink mb-1.5">Current password</label>
              <input id="pw-current" type={showPw ? 'text' : 'password'} autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} className="auth-input" />
            </div>
            <div>
              <label htmlFor="pw-new" className="block text-sm font-medium text-ink mb-1.5">New password</label>
              <input id="pw-new" type={showPw ? 'text' : 'password'} autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} className="auth-input" aria-describedby="pw-strength" />
              <div className="mt-2 grid grid-cols-4 gap-1" aria-hidden="true">
                {[1, 2, 3, 4].map(i => (
                  <span key={i} className={`h-1 rounded-full ${strength >= i ? (strength === 1 ? 'bg-neg' : strength === 2 ? 'bg-caution' : 'bg-pos') : 'bg-raised'}`} />
                ))}
              </div>
              <p id="pw-strength" className="mt-1 text-xs text-ink-3">
                {next ? `${strengthLabel} (${next.length} characters). Length matters most.` : 'At least 8 characters; longer is stronger.'}
              </p>
            </div>
            <div>
              <label htmlFor="pw-confirm" className="block text-sm font-medium text-ink mb-1.5">Confirm new password</label>
              <input id="pw-confirm" type={showPw ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className="auth-input" aria-describedby="pw-match" />
              <p id="pw-match" className={`mt-1.5 text-xs ${confirm ? (matches ? 'text-pos' : 'text-neg') : 'text-ink-3'}`}>
                {confirm ? (matches ? 'Passwords match.' : 'Does not match yet.') : 'Type it again.'}
              </p>
            </div>
          </div>
          <div className="mt-6 pt-5 border-t border-line flex flex-wrap items-center gap-3">
            <button type="submit" disabled={changing} className="px-4 py-2 rounded-lg border border-line-strong bg-canvas text-sm text-ink hover:border-ink-3 disabled:opacity-60 inline-flex items-center gap-2">
              {changing && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Change password
            </button>
            <button type="button" onClick={() => setShowPw(s => !s)} aria-pressed={showPw} className="px-3 py-2 rounded-lg text-sm text-ink-2 hover:text-ink inline-flex items-center gap-1.5">
              {showPw ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
              {showPw ? 'Hide passwords' : 'Show passwords'}
            </button>
            <Msg m={pwMsg} />
          </div>
        </form>
      </div>

      {/* ---------------- Account and data ---------------- */}
      <aside className="space-y-6">
        <div className={card}>
          <h2 className="text-lg font-semibold text-ink">Account</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-ink-2">Username</dt><dd className="text-ink font-medium">{username ?? '…'}</dd></div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-2">Access</dt>
              <dd className="text-ink inline-flex items-center gap-1.5">{isAdmin ? <><ShieldCheck className="w-4 h-4 text-accent" aria-hidden="true" /> Admin</> : 'Standard'}</dd>
            </div>
            <div className="flex justify-between gap-3"><dt className="text-ink-2">Session</dt><dd className="text-ink">Ends after 24 hours</dd></div>
          </dl>
        </div>

        <div className={card}>
          <h2 className="text-lg font-semibold text-ink">Your data</h2>
          {dataSummary ? (
            <dl id="settings-data" className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-ink-2">Transactions</dt><dd className="text-ink font-medium tabular-nums">{dataSummary.count.toLocaleString('en-IN')}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-2">First entry</dt><dd className="text-ink tabular-nums">{day(dataSummary.first)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-2">Latest entry</dt><dd className="text-ink tabular-nums">{day(dataSummary.last)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-2">Total logged</dt><dd className="text-ink tabular-nums">{inr(dataSummary.total)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-2">Source</dt><dd className="text-ink">{dataSource === 'kaggle' ? 'Kaggle sample dataset' : synthetic ? 'Synthetic demo data' : 'Entered by you'}</dd></div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-ink-2">Nothing logged yet.</p>
          )}
          <button
            id="settings-export"
            type="button"
            onClick={exportCsv}
            disabled={!dataSummary}
            className="mt-5 w-full px-3 py-2 rounded-lg border border-line-strong bg-canvas text-sm text-ink hover:border-ink-3 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" aria-hidden="true" /> Download my transactions (CSV)
          </button>
          <p className="mt-2 text-xs text-ink-3">Date, merchant, category and amount for every entry. Opens in Excel or Google Sheets.</p>
        </div>
      </aside>
    </div>
    <DataModelsSection token={token} />
    </div>
  );
}
