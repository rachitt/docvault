import { useEffect, useRef, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import type { UnifiedHit } from '../../shared/ipc';
import { useStore } from '../store';
import { HitSnippet } from './HitSnippet';
import { SearchModeToggle } from './SearchModeToggle';

const DEBOUNCE_MS = 200;

/**
 * Full-page search results. Seeded from the command palette (`openSearch`) but
 * editable in place, with the same debounced FTS query and keyboard navigation
 * (↑/↓ to move, ↵ to open) as the palette, plus more snippet context per hit.
 */
export function SearchResults(): React.JSX.Element {
  const seed = useStore((s) => s.searchQuery);
  const search = useStore((s) => s.search);
  const openDoc = useStore((s) => s.openDoc);
  const searchMode = useStore((s) => s.searchMode);
  const [q, setQ] = useState(seed);
  const [hits, setHits] = useState<UnifiedHit[]>([]);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed and refocus whenever the view is (re)opened with a new query.
  useEffect(() => {
    setQ(seed);
    inputRef.current?.focus();
  }, [seed]);

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      setSearched(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void search(q).then((r) => {
        if (!cancelled) {
          setHits(r);
          setActive(0);
          setSearched(true);
        }
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // searchMode is a dep so flipping keyword/semantic/hybrid re-runs the query.
  }, [q, search, searchMode]);

  return (
    <div className="mx-auto max-w-3xl px-12 py-10">
      <h1 className="mb-4 text-3xl font-bold text-neutral-900 dark:text-neutral-100">Search</h1>
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--dv-border)] bg-white px-3 py-2 dark:bg-neutral-900">
        <Search size={18} className="text-neutral-400" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            }
            if (e.key === 'Enter' && hits[active]) void openDoc(hits[active].id);
          }}
          placeholder="Search all documents…"
          className="flex-1 bg-transparent text-base text-neutral-800 outline-none dark:text-neutral-100"
        />
      </div>
      <div className="mb-6">
        <SearchModeToggle />
      </div>

      <div className="flex flex-col gap-1">
        {hits.map((h, i) => (
          <button
            key={h.id}
            onMouseEnter={() => setActive(i)}
            onClick={() => void openDoc(h.id)}
            className={`flex items-start gap-3 rounded-lg border px-3 py-3 text-left ${
              i === active
                ? 'border-[var(--dv-border)] bg-neutral-50 dark:bg-neutral-800'
                : 'border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-800/60'
            }`}
          >
            <FileText size={16} className="mt-0.5 shrink-0 text-neutral-400" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-neutral-800 dark:text-neutral-100">{h.title}</span>
              <span className="mt-0.5 block text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
                <HitSnippet hit={h} />
              </span>
              <span className="mt-1 block text-xs text-neutral-400">
                {h.product ?? 'source'}
                {h.tags.length > 0 && ` · ${h.tags.map((t) => `#${t}`).join(' ')}`}
              </span>
            </span>
          </button>
        ))}
        {searched && hits.length === 0 && (
          <p className="text-sm text-neutral-400">No matches for “{q.trim()}”.</p>
        )}
        {!q.trim() && (
          <p className="text-sm text-neutral-400">Type to search across every document in the vault.</p>
        )}
      </div>
    </div>
  );
}
