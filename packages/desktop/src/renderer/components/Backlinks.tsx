import { useEffect, useState } from 'react';
import { CornerUpLeft, FileText } from 'lucide-react';
import type { DocMeta } from '@docvault/core';
import { useStore } from '../store';

/**
 * Backlinks tab: documents that link to the current doc (via [[wikilinks]] or an
 * explicit frontmatter `links` entry), surfaced through the index's
 * `get_backlinks`. Refreshes when the open doc changes or the vault is edited.
 */
export function Backlinks(): React.JSX.Element {
  const currentDoc = useStore((s) => s.currentDoc);
  const docs = useStore((s) => s.docs);
  const backlinks = useStore((s) => s.backlinks);
  const openDoc = useStore((s) => s.openDoc);
  const [links, setLinks] = useState<DocMeta[]>([]);
  const [loading, setLoading] = useState(false);

  const id = currentDoc?.frontmatter.id ?? null;

  useEffect(() => {
    if (!id) {
      setLinks([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void backlinks(id)
      .then((r) => {
        if (!cancelled) setLinks(r);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `docs` is included so external edits (watcher → refresh) re-resolve links.
  }, [id, backlinks, docs]);

  if (!currentDoc) {
    return <p className="p-4 text-sm text-neutral-400">Open a document to see what links to it.</p>;
  }

  return (
    <div className="p-3">
      <p className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-neutral-400 uppercase">
        {links.length} backlink{links.length === 1 ? '' : 's'}
      </p>
      {!loading && links.length === 0 && (
        <p className="px-1 py-2 text-sm text-neutral-400">
          No documents link here yet. Reference this doc with{' '}
          <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">[[{currentDoc.frontmatter.title}]]</code>.
        </p>
      )}
      <div className="flex flex-col gap-0.5">
        {links.map((d) => (
          <button
            key={d.id}
            onClick={() => void openDoc(d.id)}
            className="flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-neutral-200/60 dark:hover:bg-neutral-800"
          >
            <CornerUpLeft size={13} className="mt-0.5 shrink-0 text-neutral-400" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-sm text-neutral-700 dark:text-neutral-200">
                <FileText size={12} className="shrink-0 text-neutral-400" />
                <span className="truncate">{d.title}</span>
              </span>
              {d.product && <span className="block truncate text-xs text-neutral-400">{d.product}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
