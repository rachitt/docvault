import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Home,
  Import,
  Plus,
  Star,
  LayoutTemplate,
  Trash2,
  Boxes,
  Settings,
  Tag,
} from 'lucide-react';
import { useStore, type NavView } from '../store';
import type { DocMeta } from '@docvault/core';

const NAV: { key: NavView; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'recent', label: 'Recent', icon: Clock },
  { key: 'starred', label: 'Starred', icon: Star },
  { key: 'tags', label: 'Tags', icon: Tag },
  { key: 'templates', label: 'Templates', icon: LayoutTemplate },
  { key: 'trash', label: 'Trash', icon: Trash2 },
];

export function Sidebar(): React.JSX.Element {
  const products = useStore((s) => s.products);
  const docs = useStore((s) => s.docs);
  const config = useStore((s) => s.config);
  const view = useStore((s) => s.view);
  const currentDoc = useStore((s) => s.currentDoc);
  const setView = useStore((s) => s.setView);
  const openTags = useStore((s) => s.openTags);
  const openDoc = useStore((s) => s.openDoc);
  const newDoc = useStore((s) => s.newDoc);
  const newProduct = useStore((s) => s.newProduct);
  const importFile = useStore((s) => s.importFile);

  const [addingProduct, setAddingProduct] = useState(false);

  const byProduct = useMemo(() => {
    const map = new Map<string, DocMeta[]>();
    for (const d of docs) {
      if (!d.product) continue;
      const list = map.get(d.product) ?? [];
      list.push(d);
      map.set(d.product, list);
    }
    return map;
  }, [docs]);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--dv-border)] bg-[var(--dv-sidebar)] text-sm">
      <div className="flex items-center gap-2 px-3 py-3 font-semibold text-neutral-700">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-[var(--dv-accent)] text-xs text-white">
          {(config?.workspaceName ?? 'D')[0]?.toUpperCase()}
        </div>
        <span className="truncate">{config?.workspaceName ?? 'DocVault'}</span>
      </div>

      <nav className="px-2">
        {NAV.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => (key === 'tags' ? openTags(null) : setView(key))}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-neutral-600 hover:bg-neutral-200/60 ${
              view === key ? 'bg-neutral-200/80 font-medium text-neutral-900' : ''
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>

      <div className="mt-4 flex items-center justify-between px-3 py-1 text-[11px] font-semibold tracking-wide text-neutral-400 uppercase">
        <span className="flex items-center gap-1">
          <Boxes size={12} /> Products
        </span>
        <button
          title="New product"
          onClick={() => setAddingProduct(true)}
          className="rounded p-0.5 hover:bg-neutral-200"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {addingProduct && (
          <InlineInput
            placeholder="Product name"
            onCommit={(title) => {
              void newProduct(title);
              setAddingProduct(false);
            }}
            onCancel={() => setAddingProduct(false)}
          />
        )}
        {products.map((p) => (
          <ProductNode
            key={p.slug}
            slug={p.slug}
            title={p.title}
            color={p.color}
            docs={byProduct.get(p.slug) ?? []}
            currentPath={currentDoc?.relPath ?? null}
            onOpen={(d) => void openDoc(d.id)}
            onCreateDoc={(title) => void newDoc(p.slug, title)}
          />
        ))}
        {products.length === 0 && !addingProduct && (
          <p className="px-2 py-4 text-xs text-neutral-400">
            No products yet. Click + to create one.
          </p>
        )}
      </div>

      <button
        onClick={() => void importFile()}
        className="mx-2 mt-2 flex items-center justify-center gap-2 rounded-md border border-[var(--dv-border)] bg-white py-1.5 text-neutral-600 hover:bg-neutral-50"
      >
        <Import size={15} /> Import PDF / DOCX / TXT
      </button>

      <button
        onClick={() => setView('settings')}
        className={`m-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-neutral-600 hover:bg-neutral-200/60 ${
          view === 'settings' ? 'bg-neutral-200/80 font-medium text-neutral-900' : ''
        }`}
      >
        <Settings size={16} /> Settings
      </button>
    </aside>
  );
}

function ProductNode(props: {
  slug: string;
  title: string;
  color?: string;
  docs: DocMeta[];
  currentPath: string | null;
  onOpen: (d: DocMeta) => void;
  onCreateDoc: (title: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  return (
    <div className="mb-0.5">
      <div className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-neutral-200/60">
        <button onClick={() => setOpen((o) => !o)} className="text-neutral-400">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span
          className="h-3 w-3 shrink-0 rounded-sm"
          style={{ background: props.color ?? '#c7c7c4' }}
        />
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex-1 truncate text-left font-medium text-neutral-700"
        >
          {props.title}
        </button>
        <button
          onClick={() => {
            setOpen(true);
            setAdding(true);
          }}
          title="New doc"
          className="opacity-0 group-hover:opacity-100"
        >
          <Plus size={13} className="text-neutral-400" />
        </button>
      </div>
      {open && (
        <div className="ml-5 border-l border-neutral-200 pl-1">
          {adding && (
            <InlineInput
              placeholder="Doc title"
              onCommit={(title) => {
                props.onCreateDoc(title);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          )}
          {props.docs.map((d) => (
            <button
              key={d.id}
              onClick={() => props.onOpen(d)}
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-neutral-600 hover:bg-neutral-200/60 ${
                props.currentPath === d.relPath ? 'bg-neutral-200/80 text-neutral-900' : ''
              }`}
            >
              <FileText size={13} className="shrink-0 text-neutral-400" />
              <span className="truncate">{d.title}</span>
            </button>
          ))}
          {props.docs.length === 0 && !adding && (
            <p className="px-2 py-1 text-xs text-neutral-400">empty</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Inline text input for creating items. Electron does not support window.prompt(),
 * so creation flows collect their name through this in-app field instead.
 * Enter commits a non-empty value; Escape or blur cancels.
 */
function InlineInput(props: {
  placeholder: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const commit = (): void => {
    const trimmed = value.trim();
    if (trimmed) props.onCommit(trimmed);
    else props.onCancel();
  };

  return (
    <input
      ref={ref}
      value={value}
      placeholder={props.placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          props.onCancel();
        }
      }}
      className="my-1 w-full rounded-md border border-[var(--dv-accent)] bg-white px-2 py-1 text-sm text-neutral-800 outline-none"
    />
  );
}
