import { ChevronRight, Search } from 'lucide-react';
import { useStore } from '../store';

export function TopBar(): React.JSX.Element {
  const currentDoc = useStore((s) => s.currentDoc);
  const products = useStore((s) => s.products);
  const view = useStore((s) => s.view);
  const setPalette = useStore((s) => s.setPalette);

  const productSlug = currentDoc?.relPath.split('/')[1];
  const product = products.find((p) => p.slug === productSlug);

  return (
    <header className="dv-drag flex h-11 items-center gap-2 border-b border-[var(--dv-border)] bg-white pr-3 pl-20 text-sm">
      <nav className="dv-no-drag flex min-w-0 items-center gap-1 text-neutral-500">
        <span className="shrink-0">Products</span>
        {view === 'doc' && currentDoc ? (
          <>
            <ChevronRight size={14} className="shrink-0 text-neutral-300" />
            <span className="shrink-0">{product?.title ?? productSlug}</span>
            <ChevronRight size={14} className="shrink-0 text-neutral-300" />
            <span className="truncate font-medium text-neutral-800">
              {currentDoc.frontmatter.title}
            </span>
          </>
        ) : (
          <>
            <ChevronRight size={14} className="text-neutral-300" />
            <span className="font-medium text-neutral-800 capitalize">{view}</span>
          </>
        )}
      </nav>
      <div className="flex-1" />
      <button
        onClick={() => setPalette(true)}
        className="dv-no-drag flex items-center gap-2 rounded-md border border-[var(--dv-border)] bg-neutral-50 px-3 py-1 text-neutral-400 hover:bg-neutral-100"
      >
        <Search size={14} />
        <span className="text-xs">Search workspace</span>
        <kbd className="rounded bg-neutral-200 px-1 text-[10px] text-neutral-500">⌘K</kbd>
      </button>
    </header>
  );
}
