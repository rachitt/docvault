import { useEffect, useState } from 'react';
import { FileText, Sparkles } from 'lucide-react';
import type { UnifiedHit } from '../../shared/ipc';
import { useStore } from '../store';

/**
 * Related-docs tab: nearest-neighbour documents for the open doc by semantic
 * similarity of their passage embeddings (via the `related_docs` MCP tool).
 * Mirrors Backlinks' structure; refreshes when the open doc changes or the vault
 * is edited. Shows the matching passage's heading breadcrumb as context.
 */
export function RelatedDocs(): React.JSX.Element {
  const currentDoc = useStore((s) => s.currentDoc);
  const docs = useStore((s) => s.docs);
  const semanticEnabled = useStore((s) => s.config?.semanticEnabled ?? true);
  const relatedDocs = useStore((s) => s.relatedDocs);
  const openDoc = useStore((s) => s.openDoc);
  const [hits, setHits] = useState<UnifiedHit[]>([]);
  const [loading, setLoading] = useState(false);

  const id = currentDoc?.frontmatter.id ?? null;

  useEffect(() => {
    if (!id || !semanticEnabled) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void relatedDocs(id)
      .then((r) => {
        if (!cancelled) setHits(r);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `docs` is a dep so external edits (watcher → refresh) re-resolve neighbours.
  }, [id, relatedDocs, semanticEnabled, docs]);

  if (!currentDoc) {
    return <p className="p-4 text-sm text-neutral-400">Open a document to see related docs.</p>;
  }

  if (!semanticEnabled) {
    return (
      <p className="p-4 text-sm text-neutral-400">
        Related docs use semantic search. Enable it in Settings to see suggestions.
      </p>
    );
  }

  return (
    <div className="p-3">
      <p className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-neutral-400 uppercase">
        {hits.length} related doc{hits.length === 1 ? '' : 's'}
      </p>
      {!loading && hits.length === 0 && (
        <p className="px-1 py-2 text-sm text-neutral-400">
          No related docs yet. This doc may still be indexing — check embedding progress in Settings.
        </p>
      )}
      <div className="flex flex-col gap-0.5">
        {hits.map((d) => (
          <button
            key={d.id}
            onClick={() => void openDoc(d.id)}
            className="flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-neutral-200/60 dark:hover:bg-neutral-800"
          >
            <Sparkles size={13} className="mt-0.5 shrink-0 text-neutral-400" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-sm text-neutral-700 dark:text-neutral-200">
                <FileText size={12} className="shrink-0 text-neutral-400" />
                <span className="truncate">{d.title}</span>
              </span>
              {d.breadcrumb && (
                <span className="block truncate text-xs text-neutral-400">{d.breadcrumb}</span>
              )}
              {!d.breadcrumb && d.product && (
                <span className="block truncate text-xs text-neutral-400">{d.product}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
