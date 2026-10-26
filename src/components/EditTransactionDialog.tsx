import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import type { Transaction } from '../types';

const CATEGORIES = ['Bills', 'Food', 'Transport', 'Shopping', 'Entertainment'];

interface Props {
  transaction: Transaction | null;
  token: string;
  onClose: () => void;
  onChanged: () => void;
}

const toDateInput = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
};

// Edit or delete one transaction. The server applies the same validation as
// for new entries and only touches the signed-in user's own records.
export function EditTransactionDialog({ transaction, token, onClose, onChanged }: Props) {
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('Food');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!transaction) return;
    setAmount(String(transaction.amount));
    setMerchant(transaction.merchant);
    setCategory(CATEGORIES.includes(transaction.category) ? transaction.category : 'Shopping');
    setDate(toDateInput(transaction.date));
    setConfirmingDelete(false);
    setError('');
    setBusy(null);
  }, [transaction]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  if (!transaction) return null;
  const url = `/api/transactions/${encodeURIComponent(String(transaction.id))}`;

  const send = async (method: 'PUT' | 'DELETE', body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `Request failed (HTTP ${res.status})`);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const changes: Record<string, unknown> = {};
    const amt = Number(amount);
    if (amt !== transaction.amount) changes.amount = amt;
    if (merchant.trim() !== transaction.merchant) changes.merchant = merchant;
    if (category !== transaction.category) changes.category = category;
    if (date && date !== toDateInput(transaction.date)) changes.date = date;
    if (Object.keys(changes).length === 0) return onClose();

    setBusy('save');
    setError('');
    try {
      await send('PUT', changes);
      onChanged();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    setError('');
    try {
      await send('DELETE');
      onChanged();
      onClose();
    } catch (err: any) {
      setError(err.message);
      setConfirmingDelete(false);
    } finally {
      setBusy(null);
    }
  };

  const field = 'w-full px-3 py-2 bg-canvas border border-line rounded-lg text-ink text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-canvas/70" role="dialog" aria-modal="true" aria-labelledby="edit-tx-title">
      <div className="bg-surface border border-line rounded-lg w-full max-w-md">
        <div className="px-5 py-4 flex items-center justify-between border-b border-line">
          <h2 id="edit-tx-title" className="text-base font-semibold text-ink">Edit transaction</h2>
          <button onClick={onClose} disabled={!!busy} className="p-1.5 rounded-md text-ink-2 hover:text-ink hover:bg-raised" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={save} className="p-5 space-y-4">
          {error && (
            <div role="alert" className="p-3 text-xs rounded-lg border bg-neg/10 text-neg border-neg/30">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-amount" className="block text-xs font-medium text-ink-2 mb-1.5">Amount (₹)</label>
              <input id="edit-amount" type="number" step="0.01" min="0.01" required value={amount}
                onChange={e => setAmount(e.target.value)} className={`${field} tabular-nums`} />
            </div>
            <div>
              <label htmlFor="edit-date" className="block text-xs font-medium text-ink-2 mb-1.5">Date</label>
              <input id="edit-date" type="date" required value={date} onChange={e => setDate(e.target.value)} className={field} />
            </div>
          </div>
          <div>
            <label htmlFor="edit-merchant" className="block text-xs font-medium text-ink-2 mb-1.5">Merchant</label>
            <input id="edit-merchant" type="text" required maxLength={100} value={merchant}
              onChange={e => setMerchant(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="edit-category" className="block text-xs font-medium text-ink-2 mb-1.5">Category</label>
            <select id="edit-category" value={category} onChange={e => setCategory(e.target.value)} className={field}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-2">Delete permanently?</span>
                <button type="button" onClick={remove} disabled={!!busy}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-neg text-canvas disabled:opacity-50">
                  {busy === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Delete'}
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)} disabled={!!busy}
                  className="px-3 py-1.5 rounded-lg text-xs text-ink-2 hover:text-ink">Keep</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmingDelete(true)} disabled={!!busy}
                className="flex items-center gap-1.5 text-xs text-neg hover:underline">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} disabled={!!busy} className="px-3 py-2 rounded-lg text-xs text-ink-2 hover:text-ink">
                Cancel
              </button>
              <button type="submit" disabled={!!busy}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-accent text-canvas hover:bg-accent-hi disabled:opacity-50">
                {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
