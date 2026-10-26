import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Camera, Plus, Search } from 'lucide-react';
import type { Transaction } from '../types';
import { categoryColor } from '../ui/theme';

const CATEGORIES = ['Bills', 'Food', 'Transport', 'Shopping', 'Entertainment'];
const PAGE_SIZE = 25;

type SortKey = 'date' | 'amount';

interface Props {
  transactions: Transaction[];
  onEdit: (t: Transaction) => void;
  onAdd: (method: 'manual' | 'ocr') => void;
  // Overview shows the latest few with a link here instead of the full tool.
  compact?: boolean;
  onShowAll?: () => void;
}

const money = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dateInput = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export function TransactionsView({ transactions, onEdit, onAdd, compact, onShowAll }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = transactions.filter(t => {
      if (q && !t.merchant.toLowerCase().includes(q)) return false;
      if (category && t.category !== category) return false;
      const d = dateInput(t.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    const sign = sort.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) =>
      sort.key === 'amount'
        ? sign * (a.amount - b.amount)
        : sign * (new Date(a.date).getTime() - new Date(b.date).getTime())
    );
    return rows;
  }, [transactions, query, category, from, to, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = compact ? filtered.slice(0, 6) : filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const total = filtered.reduce((s, t) => s + t.amount, 0);
  const filtering = Boolean(query || category || from || to);

  const toggleSort = (key: SortKey) => {
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
    setPage(0);
  };
  const reset = () => {
    setQuery('');
    setCategory('');
    setFrom('');
    setTo('');
    setPage(0);
  };

  const SortButton = ({ k, label, align }: { k: SortKey; label: string; align?: 'right' }) => (
    <button
      type="button"
      onClick={() => toggleSort(k)}
      className={`inline-flex items-center gap-1 hover:text-ink ${align === 'right' ? 'ml-auto' : ''}`}
      aria-label={`Sort by ${label}${sort.key === k ? (sort.dir === 'asc' ? ', ascending' : ', descending') : ''}`}
    >
      {label}
      {sort.key === k && (sort.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
    </button>
  );

  const field = 'h-9 px-3 rounded-md bg-surface border text-sm text-ink outline-none';

  return (
    <div>
      {!compact && (
        <div className="flex flex-wrap items-end gap-3 pb-4 border-b border-line">
          <label className="relative flex-1 min-w-[12rem]">
            <span className="sr-only">Search by merchant</span>
            <Search className="w-4 h-4 text-ink-3 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={e => { setQuery(e.target.value); setPage(0); }}
              placeholder="Search merchant"
              className={`${field} w-full pl-9`}
            />
          </label>
          <label className="text-xs text-ink-2">
            <span className="block mb-1">Category</span>
            <select value={category} onChange={e => { setCategory(e.target.value); setPage(0); }} className={field}>
              <option value="">All categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs text-ink-2">
            <span className="block mb-1">From</span>
            <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(0); }} className={field} />
          </label>
          <label className="text-xs text-ink-2">
            <span className="block mb-1">To</span>
            <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(0); }} className={field} />
          </label>
          {filtering && (
            <button type="button" onClick={reset} className="h-9 px-2 text-sm text-accent hover:underline">Clear filters</button>
          )}
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={() => onAdd('ocr')} className="h-9 px-3 rounded-md border border-line bg-surface text-sm text-ink hover:border-line-strong inline-flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-accent" aria-hidden="true" /> Scan receipt
            </button>
            <button type="button" onClick={() => onAdd('manual')} className="h-9 px-3 rounded-md bg-accent text-surface text-sm font-medium hover:bg-accent-hi inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" aria-hidden="true" /> Add transaction
            </button>
          </div>
        </div>
      )}

      {!compact && (
        <p className="py-3 text-sm text-ink-2" aria-live="polite">
          {filtered.length === transactions.length
            ? `${transactions.length} transactions`
            : `${filtered.length} of ${transactions.length} transactions`}
          {filtered.length > 0 && <> totalling <span className="text-ink font-medium tabular-nums">{money(total)}</span></>}
        </p>
      )}

      {shown.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-ink">{transactions.length === 0 ? 'No transactions yet.' : 'No transactions match these filters.'}</p>
          {transactions.length === 0 ? (
            <button type="button" onClick={() => onAdd('manual')} className="mt-3 text-sm text-accent hover:underline">Add your first transaction</button>
          ) : (
            <button type="button" onClick={reset} className="mt-3 text-sm text-accent hover:underline">Clear filters</button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop and tablet: a compact table. */}
          <table className="hidden md:table w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-2 border-b border-line">
                <th scope="col" className="py-2 pr-4 font-medium">Merchant</th>
                <th scope="col" className="py-2 pr-4 font-medium">Category</th>
                <th scope="col" className="py-2 pr-4 font-medium">{compact ? 'Date' : <SortButton k="date" label="Date" />}</th>
                <th scope="col" className="py-2 pr-4 font-medium text-right">{compact ? 'Amount' : <SortButton k="amount" label="Amount" align="right" />}</th>
                <th scope="col" className="py-2 w-14"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map(t => (
                <tr key={t.id} className="border-b border-line/70 hover:bg-raised/60">
                  <td className="py-2.5 pr-4 text-ink max-w-[22rem] truncate" title={t.merchant}>{t.merchant}</td>
                  <td className="py-2.5 pr-4">
                    <span className="inline-flex items-center gap-2 text-ink-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: categoryColor(t.category) }} aria-hidden="true" />
                      {t.category}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-ink-2 tabular-nums whitespace-nowrap">{day(t.date)}</td>
                  <td className="py-2.5 pr-4 text-right text-ink font-medium tabular-nums whitespace-nowrap">{money(t.amount)}</td>
                  <td className="py-2.5 text-right">
                    <button type="button" onClick={() => onEdit(t)} className="text-xs text-ink-2 hover:text-accent px-2 py-1 rounded" aria-label={`Edit ${t.merchant}, ${money(t.amount)}`}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Phones: one line per transaction, no sideways scrolling. */}
          <ul className="md:hidden divide-y divide-line">
            {shown.map(t => (
              <li key={t.id}>
                <button type="button" onClick={() => onEdit(t)} className="w-full py-3 flex items-center gap-3 text-left" aria-label={`Edit ${t.merchant}, ${money(t.amount)}`}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: categoryColor(t.category) }} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink truncate">{t.merchant}</span>
                    <span className="block text-xs text-ink-2">{t.category}, {day(t.date)}</span>
                  </span>
                  <span className="text-sm text-ink font-medium tabular-nums">{money(t.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {compact && transactions.length > shown.length && onShowAll && (
        <button type="button" onClick={onShowAll} className="mt-3 text-sm text-accent hover:underline">
          All {transactions.length} transactions
        </button>
      )}

      {!compact && pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between pt-4 text-sm">
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="px-3 py-1.5 rounded-md border border-line disabled:opacity-40 hover:border-line-strong">Previous</button>
          <span className="text-ink-2 tabular-nums">Page {current + 1} of {pages}</span>
          <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="px-3 py-1.5 rounded-md border border-line disabled:opacity-40 hover:border-line-strong">Next</button>
        </nav>
      )}
    </div>
  );
}
