import { useCallback, useEffect, useRef, useState } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import { filterSuggestionItems } from '@blocknote/core';
import { AlertTriangle, Link2, RefreshCw, Star, Workflow } from 'lucide-react';
import type { Doc } from '@docvault/core';
import { listDiagramTemplates } from '@docvault/core/diagram';
import { useStore } from '../store';
import { docVaultSchema, type DocVaultEditor } from '../editor/schema';
import { blocksToMarkdown, markdownToBlocks } from '../editor/transform';

/**
 * Notion-style block editor backed by markdown. Loads the doc's markdown into
 * BlockNote on mount and serializes back (debounced) on every edit, writing
 * through the store so the file + index stay in sync. Custom callout / mermaid
 * blocks round-trip via ../editor/transform, `[[` opens a wikilink autocomplete,
 * and on-disk edits to the open doc are reconciled instead of clobbered.
 */
export function Editor({ doc }: { doc: Doc }): React.JSX.Element {
  const saveCurrent = useStore((s) => s.saveCurrent);
  const setCurrentDoc = useStore((s) => s.setCurrentDoc);
  const toggleStar = useStore((s) => s.toggleStar);
  const search = useStore((s) => s.search);
  const docs = useStore((s) => s.docs);
  const products = useStore((s) => s.products);
  const config = useStore((s) => s.config);
  const resolvedTheme = useStore((s) => s.resolvedTheme);
  const editor = useCreateBlockNote({ schema: docVaultSchema });

  const [ready, setReady] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [conflict, setConflict] = useState<Doc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Content the editor was last loaded from / last wrote — the on-disk baseline
  // used to distinguish our own saves (echoed back by the watcher) from real
  // external edits.
  const baselineRef = useRef(doc.content);
  const dirtyRef = useRef(false);
  const conflictRef = useRef<Doc | null>(null);

  const starred = config?.starred.includes(doc.frontmatter.id) ?? false;
  const productSlug = doc.relPath.split('/')[1];
  const productTitle = products.find((p) => p.slug === productSlug)?.title ?? productSlug;

  // Load (or reload) the doc into the editor. Keyed on `reloadNonce` rather than
  // `doc.content` so our own debounced saves don't reset the editor mid-typing;
  // reconciliation bumps the nonce explicitly when it wants a reload.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    (async () => {
      const blocks = await markdownToBlocks(editor, doc.content || '');
      if (cancelled) return;
      editor.replaceBlocks(editor.document, blocks);
      baselineRef.current = doc.content;
      dirtyRef.current = false;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: reload only on nonce
  }, [editor, reloadNonce]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /** Reload the editor + store from a freshly-read on-disk version. */
  const applyReload = useCallback(
    (fresh: Doc) => {
      baselineRef.current = fresh.content;
      dirtyRef.current = false;
      conflictRef.current = null;
      setConflict(null);
      setCurrentDoc(fresh);
      setReloadNonce((n) => n + 1);
    },
    [setCurrentDoc],
  );

  // Reconcile external edits to the open doc (e.g. an agent writing the file).
  const reconcile = useCallback(
    async (paths: string[]) => {
      if (!paths.includes(doc.relPath)) return;
      let fresh: Doc;
      try {
        fresh = await window.docvault.readDoc(doc.frontmatter.id);
      } catch {
        return; // deleted/renamed — the sidebar refresh handles that case
      }
      if (fresh.content === baselineRef.current) return; // our own save, or no change
      if (dirtyRef.current) {
        conflictRef.current = fresh;
        setConflict(fresh);
      } else {
        applyReload(fresh);
      }
    },
    [doc.relPath, doc.frontmatter.id, applyReload],
  );

  useEffect(() => {
    return window.docvault.onVaultChanged((paths) => void reconcile(paths));
  }, [reconcile]);

  const onChange = (): void => {
    if (!ready) return;
    dirtyRef.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      // Don't overwrite an unresolved external change.
      if (conflictRef.current) return;
      const md = await blocksToMarkdown(editor, editor.document);
      baselineRef.current = md;
      dirtyRef.current = false;
      void saveCurrent(md);
    }, 600);
  };

  /** Keep the local edits: write them over the on-disk version. */
  const keepMine = async (): Promise<void> => {
    conflictRef.current = null;
    setConflict(null);
    const md = await blocksToMarkdown(editor, editor.document);
    baselineRef.current = md;
    dirtyRef.current = false;
    void saveCurrent(md);
  };

  return (
    <div className="mx-auto max-w-3xl px-12 py-10">
      {conflict && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
          <RefreshCw size={16} className="shrink-0" />
          <span className="flex-1">This document was changed on disk while you were editing.</span>
          <button
            onClick={() => applyReload(conflict)}
            className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
          >
            Reload (discard mine)
          </button>
          <button
            onClick={() => void keepMine()}
            className="rounded-md border border-amber-400 px-2.5 py-1 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40"
          >
            Keep mine
          </button>
        </div>
      )}
      <div className="mb-1.5 text-xs tracking-wide text-neutral-500">
        {productTitle ? `${productTitle} / ${doc.frontmatter.title}` : doc.frontmatter.title}
      </div>
      <div className="mb-2 flex items-center gap-2">
        <h1 className="flex-1 text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          {doc.frontmatter.title}
        </h1>
        <button
          onClick={() => void toggleStar(doc.frontmatter.id)}
          title={starred ? 'Unstar' : 'Star'}
          className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Star size={18} className={starred ? 'fill-amber-400 text-amber-400' : 'text-neutral-400'} />
        </button>
      </div>
      <div className="mb-6 flex flex-wrap gap-1.5">
        {doc.frontmatter.tags.map((t) => (
          <span key={t} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800">
            #{t}
          </span>
        ))}
      </div>
      <BlockNoteView
        editor={editor}
        onChange={onChange}
        theme={resolvedTheme}
        slashMenu={false}
        className="bn-container"
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), ...customSlashItems(editor)], query)
          }
        />
        {/* `[` opens the wikilink picker; minQueryLength 1 means a single `[`
            stays inert and the menu only appears once the second `[` is typed. */}
        <SuggestionMenuController
          triggerCharacter="["
          minQueryLength={1}
          getItems={async (query) => wikilinkItems(editor, query, search, docs)}
        />
      </BlockNoteView>
    </div>
  );
}

/** Slash-menu entries for DocVault's custom blocks. */
function customSlashItems(editor: DocVaultEditor): DefaultReactSuggestionItem[] {
  return [
    {
      title: 'Callout',
      subtext: 'Info / principle / warning highlight',
      aliases: ['callout', 'note', 'info', 'warning', 'principle'],
      group: 'Blocks',
      icon: <AlertTriangle size={18} />,
      onItemClick: () => {
        editor.insertBlocks(
          [{ type: 'callout', props: { type: 'info' } }],
          editor.getTextCursorPosition().block,
          'after',
        );
      },
    },
    // Curated diagram templates from the shared core registry, so the slash
    // menu and the MCP tools start from the same well-styled sources.
    ...listDiagramTemplates().map(
      (t): DefaultReactSuggestionItem => ({
        title: `Diagram: ${t.label}`,
        subtext: t.description,
        aliases: ['mermaid', 'diagram', 'chart', 'flowchart', t.type, t.id],
        group: 'Diagrams',
        icon: <Workflow size={18} />,
        onItemClick: () => {
          editor.insertBlocks(
            [{ type: 'mermaid', props: { code: t.source } }],
            editor.getTextCursorPosition().block,
            'after',
          );
        },
      }),
    ),
    {
      title: 'Diagram: blank',
      subtext: 'Empty Mermaid diagram — write your own source',
      aliases: ['mermaid', 'diagram', 'chart', 'flowchart', 'blank'],
      group: 'Diagrams',
      icon: <Workflow size={18} />,
      onItemClick: () => {
        editor.insertBlocks(
          [{ type: 'mermaid', props: { code: '' } }],
          editor.getTextCursorPosition().block,
          'after',
        );
      },
    },
  ];
}

type DocLike = { id: string; title: string; product: string | null };

/**
 * Wikilink autocomplete items. The query begins with the second `[` (the first
 * is the trigger); we require it so a lone `[` in prose doesn't pop the menu.
 * Selecting a doc inserts `[[Title]]`, which core resolves to a backlink by
 * title on the next save.
 */
async function wikilinkItems(
  editor: DocVaultEditor,
  query: string,
  search: (q: string) => Promise<DocLike[]>,
  allDocs: DocLike[],
): Promise<DefaultReactSuggestionItem[]> {
  if (!query.startsWith('[')) return [];
  const term = query.slice(1).trim();
  const matches: DocLike[] = term ? await search(term) : allDocs.slice(0, 12);
  return matches.map((d) => ({
    title: d.title,
    subtext: d.product ?? undefined,
    icon: <Link2 size={18} />,
    onItemClick: () => {
      editor.insertInlineContent([{ type: 'text', text: `[[${d.title}]] `, styles: {} }]);
    },
  }));
}
