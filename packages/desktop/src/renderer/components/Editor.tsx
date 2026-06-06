import { useEffect, useRef, useState } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { Star } from 'lucide-react';
import type { Doc } from '@docvault/core';
import { useStore } from '../store';

/**
 * Notion-style block editor backed by markdown. Loads the doc's markdown into
 * BlockNote on mount and serializes back to markdown (debounced) on every edit,
 * writing through the store so the file + index stay in sync.
 */
export function Editor({ doc }: { doc: Doc }): React.JSX.Element {
  const saveCurrent = useStore((s) => s.saveCurrent);
  const toggleStar = useStore((s) => s.toggleStar);
  const config = useStore((s) => s.config);
  const resolvedTheme = useStore((s) => s.resolvedTheme);
  const editor = useCreateBlockNote();
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const starred = config?.starred.includes(doc.frontmatter.id) ?? false;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const blocks = await editor.tryParseMarkdownToBlocks(doc.content || '');
      if (cancelled) return;
      editor.replaceBlocks(editor.document, blocks);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [editor, doc.content]);

  // Cancel any pending debounced save when the editor unmounts (e.g. switching
  // docs) so a stale timer can't fire against an old doc after teardown.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onChange = (): void => {
    if (!ready) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const md = await editor.blocksToMarkdownLossy(editor.document);
      void saveCurrent(md);
    }, 600);
  };

  return (
    <div className="mx-auto max-w-3xl px-12 py-10">
      <div className="mb-2 flex items-center gap-2">
        <h1 className="flex-1 text-4xl font-bold tracking-tight text-neutral-900">
          {doc.frontmatter.title}
        </h1>
        <button
          onClick={() => void toggleStar(doc.frontmatter.id)}
          title={starred ? 'Unstar' : 'Star'}
          className="rounded p-1 hover:bg-neutral-100"
        >
          <Star
            size={18}
            className={starred ? 'fill-amber-400 text-amber-400' : 'text-neutral-400'}
          />
        </button>
      </div>
      <div className="mb-6 flex flex-wrap gap-1.5">
        {doc.frontmatter.tags.map((t) => (
          <span key={t} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
            #{t}
          </span>
        ))}
      </div>
      <BlockNoteView editor={editor} onChange={onChange} theme={resolvedTheme} className="bn-container" />
    </div>
  );
}
