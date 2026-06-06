import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileText, Hash, Tag } from 'lucide-react';
import { useStore } from '../store';

/**
 * Tags browser. With no tag selected it lists every tag in the vault (with doc
 * counts) from the index's `list_tags`; selecting one filters the in-memory doc
 * list to docs carrying that tag. Mirrors the ListView open/row styling.
 */
export function TagsView(): React.JSX.Element {
  const docs = useStore((s) => s.docs);
  const tagFilter = useStore((s) => s.tagFilter);
  const setTagFilter = useStore((s) => s.setTagFilter);
  const listTags = useStore((s) => s.listTags);
  const openDoc = useStore((s) => s.openDoc);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listTags().then((t) => {
      if (!cancelled) setTags(t);
    });
    return () => {
      cancelled = true;
    };
    // Re-fetch whenever the doc set changes (tags may have been added/removed).
  }, [listTags, docs]);

  const filtered = useMemo(
    () => (tagFilter ? docs.filter((d) => d.tags.includes(tagFilter)) : []),
    [docs, tagFilter],
  );

  if (tagFilter) {
    return (
      <div className="mx-auto max-w-3xl px-12 py-10">
        <button
          onClick={() => setTagFilter(null)}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          <ArrowLeft size={14} /> All tags
        </button>
        <h1 className="mb-6 flex items-center gap-2 text-3xl font-bold text-neutral-900 dark:text-neutral-100">
          <Hash size={26} className="text-neutral-400" />
          {tagFilter}
        </h1>
        <div className="flex flex-col gap-1">
          {filtered.map((d) => (
            <button
              key={d.id}
              onClick={() => void openDoc(d.id)}
              className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left hover:border-[var(--dv-border)] hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
            >
              <FileText size={16} className="shrink-0 text-neutral-400" />
              <span className="flex-1">
                <span className="block font-medium text-neutral-800 dark:text-neutral-100">{d.title}</span>
                <span className="block text-xs text-neutral-400">
                  {d.product ?? 'source'} · {new Date(d.updated).toLocaleDateString()}
                </span>
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-neutral-400">No documents tagged “{tagFilter}”.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-12 py-10">
      <h1 className="mb-6 flex items-center gap-2 text-3xl font-bold text-neutral-900 dark:text-neutral-100">
        <Tag size={24} className="text-neutral-400" /> Tags
      </h1>
      {tags.length === 0 ? (
        <p className="text-sm text-neutral-400">No tags yet. Add tags in a document's frontmatter.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map(({ tag, count }) => (
            <button
              key={tag}
              onClick={() => setTagFilter(tag)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--dv-border)] bg-white px-3 py-1.5 text-sm text-neutral-700 hover:border-[var(--dv-accent)] hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <Hash size={13} className="text-neutral-400" />
              {tag}
              <span className="rounded-full bg-neutral-100 px-1.5 text-xs text-neutral-500 dark:bg-neutral-800">
                {count}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
