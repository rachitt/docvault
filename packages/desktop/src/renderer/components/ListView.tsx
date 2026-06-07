import { useMemo } from 'react';
import { Boxes, FileText, RotateCcw } from 'lucide-react';
import type { DocMeta } from '@docvault/core';
import { useStore, type NavView } from '../store';

/** Hours left before a trash entry is auto-purged (TTL is 24h from deletion). */
function hoursLeft(deletedAt: string): number {
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  return Math.max(0, Math.ceil((24 * 60 * 60 * 1000 - elapsed) / (60 * 60 * 1000)));
}

export function ListView({ view }: { view: NavView }): React.JSX.Element {
  const docs = useStore((s) => s.docs);
  const config = useStore((s) => s.config);
  const trash = useStore((s) => s.trash);
  const restoreTrash = useStore((s) => s.restoreTrash);
  const openDoc = useStore((s) => s.openDoc);

  const items = useMemo<DocMeta[]>(() => {
    if (!config) return [];
    const byId = new Map(docs.map((d) => [d.id, d] as const));
    switch (view) {
      case 'starred':
        return config.starred.map((id) => byId.get(id)).filter((d): d is DocMeta => !!d);
      case 'recent':
        return config.recent.map((id) => byId.get(id)).filter((d): d is DocMeta => !!d);
      case 'trash':
        return [];
      case 'templates':
        return [];
      case 'home':
      default:
        return [...docs].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 50);
    }
  }, [view, docs, config]);

  const titles: Record<NavView, string> = {
    home: 'Home',
    recent: 'Recent',
    starred: 'Starred',
    templates: 'Templates',
    trash: 'Trash',
    settings: 'Settings',
    tags: 'Tags',
    search: 'Search',
    doc: 'Document',
  };

  return (
    <div className="mx-auto max-w-3xl px-12 py-10">
      <h1 className="mb-6 text-3xl font-bold text-neutral-900">{titles[view]}</h1>
      {view === 'trash' && (
        <div>
          <p className="mb-4 text-sm text-neutral-500">
            {trash.length
              ? `${trash.length} item(s) in trash. Items are permanently deleted 24 hours after removal.`
              : 'Trash is empty.'}
          </p>
          <div className="flex flex-col gap-1">
            {trash.map((t) => (
              <div
                key={t.trashPath}
                className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 hover:border-[var(--dv-border)] hover:bg-neutral-50"
              >
                {t.kind === 'product' ? (
                  <Boxes size={16} className="shrink-0 text-neutral-400" />
                ) : (
                  <FileText size={16} className="shrink-0 text-neutral-400" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-neutral-800">{t.title}</span>
                  <span className="block text-xs text-neutral-400">
                    {t.kind} · deleted {new Date(t.deletedAt).toLocaleString()} ·{' '}
                    {hoursLeft(t.deletedAt)}h left
                  </span>
                </span>
                <button
                  onClick={() => void restoreTrash(t.trashPath)}
                  title="Restore"
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--dv-border)] bg-white px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
                >
                  <RotateCcw size={13} /> Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {view === 'templates' && (
        <p className="text-sm text-neutral-500">
          Drop reusable docs in the vault's <code>templates/</code> folder.
        </p>
      )}
      <div className="flex flex-col gap-1">
        {items.map((d) => (
          <button
            key={d.id}
            onClick={() => void openDoc(d.id)}
            className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left hover:border-[var(--dv-border)] hover:bg-neutral-50"
          >
            <FileText size={16} className="shrink-0 text-neutral-400" />
            <span className="flex-1">
              <span className="block font-medium text-neutral-800">{d.title}</span>
              <span className="block text-xs text-neutral-400">
                {d.product ?? 'source'} · {new Date(d.updated).toLocaleDateString()}
              </span>
            </span>
          </button>
        ))}
        {items.length === 0 && view !== 'trash' && view !== 'templates' && (
          <p className="text-sm text-neutral-400">Nothing here yet.</p>
        )}
      </div>
    </div>
  );
}
