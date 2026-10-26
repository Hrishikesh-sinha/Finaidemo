import { useEffect, useState } from 'react';

export interface StorySection {
  id: string;
  label: string;
}

/**
 * The four steps of the page, as a rail rather than a row of tabs: the page
 * argues observe -> predict -> simulate -> explain in order, so the nav shows
 * how far through that argument the reader is, not just where they can jump.
 *
 * Sits under the app's sticky top bar (64px). Highlights the section whose top
 * is nearest the top of the screen, and jumps to a section when clicked.
 */
export function SectionNav({ sections }: { sections: StorySection[] }) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const elements = sections
      .map(s => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // A band across the upper part of the screen, below both sticky bars.
      { rootMargin: '-120px 0px -55% 0px', threshold: 0 }
    );
    elements.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    setActive(id);
  };

  const activeIndex = Math.max(0, sections.findIndex(s => s.id === active));

  return (
    <nav
      aria-label="Dashboard sections"
      className="sticky top-16 z-30 bg-canvas/90 backdrop-blur-md border-b border-line"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <ol className="flex items-center gap-0 overflow-x-auto py-2.5">
          {sections.map((s, i) => {
            const isActive = i === activeIndex;
            const isPast = i < activeIndex;
            return (
              <li key={s.id} className="flex items-center shrink-0">
                {i > 0 && (
                  <span
                    className={`w-5 sm:w-8 h-px mx-1 ${isPast || isActive ? 'bg-accent/50' : 'bg-line'}`}
                    aria-hidden="true"
                  />
                )}
                <button
                  type="button"
                  onClick={() => go(s.id)}
                  aria-current={isActive ? 'step' : undefined}
                  className={`flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full text-xs transition-colors ${
                    isActive ? 'bg-raised text-ink font-medium' : 'text-ink-3 hover:text-ink-2'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-micro shrink-0 ${
                      isActive
                        ? 'bg-accent text-canvas font-semibold'
                        : isPast
                        ? 'bg-accent-dim text-accent'
                        : 'bg-raised text-ink-3'
                    }`}
                  >
                    {i + 1}
                  </span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
