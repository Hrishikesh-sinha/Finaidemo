import { LayoutDashboard, LineChart, LogOut, ReceiptText, Settings, Shield, Target, type LucideIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { AppView } from './AppNav';

// The app shell's navigation: a fixed indigo sidebar on wide screens, and on
// phones an indigo top bar plus a bottom tab bar. Every destination is a real
// view; account actions live at the bottom of the sidebar.

const ITEMS: { id: AppView; label: string; short: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', short: 'Overview', icon: LayoutDashboard },
  { id: 'transactions', label: 'Transactions', short: 'Transactions', icon: ReceiptText },
  { id: 'forecast', label: 'Forecast', short: 'Forecast', icon: LineChart },
  { id: 'planner', label: 'Savings planner', short: 'Planner', icon: Target },
  { id: 'settings', label: 'Settings', short: 'Settings', icon: Settings }
];

interface Props {
  view: AppView;
  onChange: (v: AppView) => void;
  username?: string;
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
  onSignOut?: () => void;
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-8 h-8 rounded-md bg-accent text-white flex items-center justify-center font-semibold" aria-hidden="true">₹</span>
      <span className="text-[17px] font-semibold tracking-tight text-white">FinAI</span>
    </div>
  );
}

export function AppSidebar({ view, onChange, username, isAdmin, onOpenAdmin, onSignOut }: Props) {
  const link = (id: AppView) => ({
    href: `#${id}`,
    onClick: (e: MouseEvent) => {
      e.preventDefault();
      onChange(id);
    },
    'aria-current': id === view ? ('page' as const) : undefined
  });

  return (
    <>
      {/* Wide screens: fixed sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-60 flex-col bg-side text-side-ink">
        <div className="px-5 h-16 flex items-center">
          <Brand />
        </div>
        <nav aria-label="Main" className="px-3 mt-4 flex-1">
          <ul className="space-y-1">
            {ITEMS.map(({ id, label, icon: Icon }) => {
              const active = id === view;
              return (
                <li key={id}>
                  <a
                    {...link(id)}
                    className={`relative flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
                      active ? 'bg-side-active text-white font-medium' : 'hover:bg-side-active/60 hover:text-white'
                    }`}
                  >
                    {/* The current item is marked by more than colour: a saffron bar and weight. */}
                    {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-accent" aria-hidden="true" />}
                    <Icon className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
                    {label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="px-3 pb-5 pt-4 border-t border-white/10 space-y-1">
          {username && (
            <div className="flex items-center gap-3 px-3 py-2">
              <span className="w-8 h-8 rounded-full bg-side-active text-white text-sm font-medium flex items-center justify-center" aria-hidden="true">
                {username.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block text-xs text-side-ink">Signed in as</span>
                <span id="nav-username" className="block text-sm text-white font-medium truncate">{username}</span>
              </span>
            </div>
          )}
          {isAdmin && onOpenAdmin && (
            <button id="user-nav-switch-to-admin" type="button" onClick={onOpenAdmin} className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm hover:bg-side-active/60 hover:text-white">
              <Shield className="w-[18px] h-[18px]" aria-hidden="true" /> Admin view
            </button>
          )}
          {onSignOut && (
            <button type="button" onClick={onSignOut} className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm hover:bg-side-active/60 hover:text-white">
              <LogOut className="w-[18px] h-[18px]" aria-hidden="true" /> Sign out
            </button>
          )}
        </div>
      </aside>

      {/* Phones and tablets: top bar */}
      <header className="lg:hidden sticky top-0 z-40 h-14 px-4 flex items-center justify-between bg-side text-side-ink">
        <Brand />
        <div className="flex items-center gap-1">
          {isAdmin && onOpenAdmin && (
            <button type="button" onClick={onOpenAdmin} className="p-2 rounded-md hover:bg-side-active" aria-label="Admin view">
              <Shield className="w-5 h-5" aria-hidden="true" />
            </button>
          )}
          {onSignOut && (
            <button type="button" onClick={onSignOut} className="flex items-center gap-1.5 px-2.5 py-2 rounded-md text-sm hover:bg-side-active">
              <LogOut className="w-4 h-4" aria-hidden="true" /> Sign out
            </button>
          )}
        </div>
      </header>

      {/* Phones and tablets: bottom tab bar */}
      <nav aria-label="Main" className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-line pb-[env(safe-area-inset-bottom)]">
        <ul className="grid grid-cols-5">
          {ITEMS.map(({ id, short, icon: Icon }) => {
            const active = id === view;
            return (
              <li key={id}>
                <a {...link(id)} className={`flex flex-col items-center gap-0.5 pt-2 pb-2 text-[11px] ${active ? 'text-accent font-semibold' : 'text-ink-2'}`}>
                  <Icon className="w-5 h-5" aria-hidden="true" />
                  {short}
                  {active && <span className="sr-only">(current)</span>}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
