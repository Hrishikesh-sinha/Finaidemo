// Primary navigation. Each destination is a real view in Dashboard; nothing
// here leads to a page that does not exist.

export type AppView = 'overview' | 'transactions' | 'forecast' | 'planner' | 'settings';

export const APP_VIEWS: { id: AppView; label: string; short?: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'planner', label: 'Savings planner', short: 'Planner' },
  { id: 'settings', label: 'Settings' }
];

export function isAppView(v: string): v is AppView {
  return APP_VIEWS.some(x => x.id === v);
}

export function AppNav({ view, onChange }: { view: AppView; onChange: (v: AppView) => void }) {
  return (
    <nav aria-label="Main" className="sticky top-16 z-30 bg-canvas/95 backdrop-blur border-b border-line">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <ul className="flex sm:gap-1 overflow-x-auto -mb-px [scrollbar-width:none]">
          {APP_VIEWS.map(item => {
            const active = item.id === view;
            return (
              <li key={item.id} className="shrink-0">
                <a
                  href={`#${item.id}`}
                  onClick={e => {
                    e.preventDefault();
                    onChange(item.id);
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={`block px-2 sm:px-3 py-3 text-[13px] sm:text-sm border-b-2 transition-colors ${
                    active ? 'border-accent text-ink font-semibold' : 'border-transparent text-ink-2 hover:text-ink hover:border-line-strong'
                  }`}
                >
                  {item.short ? (
                    <>
                      <span className="sm:hidden">{item.short}</span>
                      <span className="hidden sm:inline">{item.label}</span>
                    </>
                  ) : (
                    item.label
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
