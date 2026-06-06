import { useEffect, useRef, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import type { SearchHit } from '@docvault/core';
import { useStore } from '../store';

export function CommandPalette(): React.JSX.Element | null {
  const open = useStore((s) => s.paletteOpen);
  const setPalette = useStore((s) => s.setPalette);
  const search = useStore((s) => s.search);
  const openDoc = useStore((s) => s.openDoc);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
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

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    let cancelled = false;
    void search(q).then((r) => {
      if (!cancelled) {
        setHits(r);
        setActive(0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [q, search]);

  if (!open) return null;

  const choose = (hit: SearchHit): void => {
    void openDoc(hit.id);
    setPalette(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[12vh]"
      onClick={() => setPalette(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--dv-border)] bg-white shadow-2xl"
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
              if (e.key === 'Enter' && hits[active]) choose(hits[active]);
            }}
            placeholder="Search all documents…"
            className="flex-1 bg-transparent text-base outline-none"
          />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {hits.map((h, i) => (
            <button
              key={h.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(h)}
              className={`flex w-full items-start gap-3 px-4 py-2.5 text-left ${
                i === active ? 'bg-neutral-100' : ''
              }`}
            >
              <FileText size={16} className="mt-0.5 shrink-0 text-neutral-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-neutral-800">{h.title}</span>
                <span className="block truncate text-xs text-neutral-400">
                  {renderSnippet(h.snippet)}
                </span>
              </span>
            </button>
          ))}
          {q.trim() && hits.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-neutral-400">No matches</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Strip the «» FTS markers for a plain-text snippet preview. */
function renderSnippet(s: string): string {
  return s.replace(/«|»/g, '');
}
