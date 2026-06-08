import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, FileText, Search } from 'lucide-react';
import type { UnifiedHit } from '../../shared/ipc';
import { useStore } from '../store';
import { HitSnippet } from './HitSnippet';
import { SearchModeToggle } from './SearchModeToggle';

const DEBOUNCE_MS = 200;

export function CommandPalette(): React.JSX.Element | null {
  const open = useStore((s) => s.paletteOpen);
  const setPalette = useStore((s) => s.setPalette);
  const search = useStore((s) => s.search);
  const openDoc = useStore((s) => s.openDoc);
  const openSearch = useStore((s) => s.openSearch);
  const searchMode = useStore((s) => s.searchMode);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<UnifiedHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setHits([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Debounced search: wait for a pause in typing before hitting the index, and
  // ignore results that resolve after the query has moved on.
  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void search(q).then((r) => {
        if (!cancelled) {
          setHits(r);
          setActive(0);
        }
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // searchMode is a dep so switching keyword/semantic/hybrid re-queries live.
  }, [q, search, searchMode]);

  if (!open) return null;

  const choose = (hit: UnifiedHit): void => {
    void openDoc(hit.id);
    setPalette(false);
  };

  const seeAll = (): void => {
    if (q.trim()) openSearch(q.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[12vh]"
      onClick={() => setPalette(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--dv-border)] bg-white shadow-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--dv-border)] px-4 py-3">
          <Search size={18} className="text-neutral-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPalette(false);
              if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, hits.length - 1));
              if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
              if (e.key === 'Enter') {
                if (e.shiftKey || !hits[active]) seeAll();
                else choose(hits[active]);
              }
            }}
            placeholder="Search all documents…"
            className="flex-1 bg-transparent text-base text-neutral-800 outline-none dark:text-neutral-100"
          />
        </div>
        <div className="flex items-center border-b border-[var(--dv-border)] px-4 py-2">
          <SearchModeToggle />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {hits.map((h, i) => (
            <button
              key={h.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(h)}
              className={`flex w-full items-start gap-3 px-4 py-2.5 text-left ${
                i === active ? 'bg-neutral-100 dark:bg-neutral-800' : ''
              }`}
            >
              <FileText size={16} className="mt-0.5 shrink-0 text-neutral-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-neutral-800 dark:text-neutral-100">
                  {h.title}
                </span>
                <span className="block truncate text-xs text-neutral-400">
                  <HitSnippet hit={h} />
                </span>
              </span>
            </button>
          ))}
          {q.trim() && hits.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-neutral-400">No matches</p>
          )}
        </div>
        {q.trim() && (
          <button
            onClick={seeAll}
            className="flex w-full items-center gap-2 border-t border-[var(--dv-border)] px-4 py-2.5 text-left text-sm text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            <Search size={14} />
            <span className="flex-1">
              See all results for “<span className="font-medium text-neutral-700 dark:text-neutral-200">{q.trim()}</span>”
            </span>
            <kbd className="flex items-center gap-0.5 rounded border border-[var(--dv-border)] px-1.5 py-0.5 text-[10px] text-neutral-400">
              <CornerDownLeft size={10} /> shift
            </kbd>
          </button>
        )}
      </div>
    </div>
  );
}
