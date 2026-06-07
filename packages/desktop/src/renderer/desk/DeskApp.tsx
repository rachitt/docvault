/*
 * DeskApp — the "Desk" skeuomorphic theme wired to the REAL app.
 *
 * Composes the live functional components (Sidebar / MainPane / RightPanel /
 * CommandPalette) inside the wooden-desk chrome, and wires the shelf (Spaces
 * tabs, search, sticky note) and status bar to the live store. The `.desk`
 * class on <html> re-skins every reused component to parchment via the token
 * remap in index.css.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, Settings as Gear, HardDrive, Star, Check } from 'lucide-react';
import { Sidebar } from '../components/Sidebar';
import { MainPane } from '../components/MainPane';
import { RightPanel } from '../components/RightPanel';
import { CommandPalette } from '../components/CommandPalette';
import { useStore } from '../store';
import './desk.css';

const TAB_COLORS = ['desk-tab--green', 'desk-tab--tan', 'desk-tab--purple', 'desk-tab--blue'];

function Shelf(): React.JSX.Element {
  const products = useStore((s) => s.products);
  const docs = useStore((s) => s.docs);
  const currentDoc = useStore((s) => s.currentDoc);
  const openDoc = useStore((s) => s.openDoc);
  const newProduct = useStore((s) => s.newProduct);
  const setPalette = useStore((s) => s.setPalette);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState(() => localStorage.getItem('desk-note') ?? '');
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) addRef.current?.focus();
  }, [adding]);
  useEffect(() => {
    localStorage.setItem('desk-note', note);
  }, [note]);

  const activeSlug = currentDoc?.relPath.split('/')[1] ?? null;

  // Open a space → its most recently updated doc.
  const openSpace = (slug: string): void => {
    const inProduct = docs
      .filter((d) => d.product === slug)
      .sort((a, b) => (a.updated < b.updated ? 1 : -1));
    if (inProduct[0]) void openDoc(inProduct[0].id);
  };

  const commitProduct = (): void => {
    const trimmed = name.trim();
    if (trimmed) void newProduct(trimmed);
    setName('');
    setAdding(false);
  };

  return (
    <div className="desk-shelf">
      <div className="desk-spaces">
        <span className="desk-eyebrow">Spaces</span>
        <div className="desk-tabs">
          {products.map((p, i) => (
            <div
              key={p.slug}
              className={`desk-tab ${TAB_COLORS[i % TAB_COLORS.length]}`}
              data-active={activeSlug === p.slug}
              style={p.color ? { background: p.color } : undefined}
              onClick={() => openSpace(p.slug)}
              title={`${p.docCount} doc${p.docCount === 1 ? '' : 's'}`}
            >
              {p.title}
            </div>
          ))}
          {adding ? (
            <input
              ref={addRef}
              className="desk-space-input"
              placeholder="New space…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitProduct}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitProduct();
                else if (e.key === 'Escape') {
                  setName('');
                  setAdding(false);
                }
              }}
            />
          ) : (
            <div className="desk-tab-add" title="New space" onClick={() => setAdding(true)}>
              <Plus size={15} />
            </div>
          )}
        </div>
      </div>

      <div className="desk-search-wrap">
        <button className="desk-search" onClick={() => setPalette(true)}>
          <Search size={15} />
          <span>Find anything</span>
          <span className="kbd">⌘K</span>
        </button>
      </div>

      <div className="desk-note">
        <span className="desk-pin" />
        <div className="desk-note-title">Notes</div>
        <textarea
          rows={3}
          value={note}
          placeholder="Capture thoughts, todos, and tasks…"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <svg className="desk-shelf-pen" viewBox="0 0 200 18" aria-hidden="true">
        <rect x="2" y="6" width="150" height="7" rx="3.5" fill="#22303e" />
        <rect x="2" y="6" width="150" height="3" rx="1.5" fill="#3b4d62" />
        <polygon points="152,5 182,9.5 152,14" fill="#caa85e" />
        <rect x="176" y="7.5" width="12" height="4" rx="1" fill="#9a9a9a" />
        <circle cx="190" cy="9.5" r="2" fill="#c4c4c4" />
      </svg>
    </div>
  );
}

function DeskStatusBar(): React.JSX.Element {
  const docs = useStore((s) => s.docs);
  const config = useStore((s) => s.config);
  const setView = useStore((s) => s.setView);
  return (
    <div className="desk-statusbar">
      <span className="dot" />
      <span>Local Only</span>
      <span className="sep">·</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <HardDrive size={11} /> {config?.workspaceName ?? 'DocVault'}
      </span>
      <span className="spacer" />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Star size={11} /> {config?.starred.length ?? 0} starred
      </span>
      <span className="sep">·</span>
      <span>{docs.length} docs</span>
      <span className="sep">·</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Check size={11} /> Index: Ready
      </span>
      <Gear className="gear" size={13} onClick={() => setView('settings')} />
    </div>
  );
}

export default function DeskApp(): React.JSX.Element {
  const refresh = useStore((s) => s.refresh);
  const setPalette = useStore((s) => s.setPalette);
  const applyTheme = useStore((s) => s.applyTheme);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const config = useStore((s) => s.config);
  const docs = useStore((s) => s.docs);
  const currentDoc = useStore((s) => s.currentDoc);
  const openDoc = useStore((s) => s.openDoc);
  const didAutoOpen = useRef(false);

  // Force the desk skin on; keep it winning regardless of the OS appearance.
  useEffect(() => {
    document.documentElement.classList.add('desk');
    return () => document.documentElement.classList.remove('desk');
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.docvault.onVaultChanged(() => void refresh());
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => applyTheme();
    mql.addEventListener('change', onScheme);
    applyTheme();
    return () => {
      off();
      window.removeEventListener('keydown', onKey);
      mql.removeEventListener('change', onScheme);
    };
  }, [refresh, setPalette, applyTheme]);

  // On first load, restore focus to the most-recently-edited doc instead of the
  // empty Home list — the desk should open to where you left off.
  useEffect(() => {
    if (didAutoOpen.current || currentDoc || docs.length === 0) return;
    didAutoOpen.current = true;
    const latest = [...docs].sort((a, b) => (a.updated < b.updated ? 1 : -1))[0];
    if (latest) void openDoc(latest.id);
  }, [docs, currentDoc, openDoc]);

  const workspace = useMemo(() => config?.workspaceName ?? 'DocVault', [config]);

  return (
    <div className="desk-app">
      <div className="desk-titlebar">
        <span className="desk-title">Desk</span>
        <span className="desk-workspace">· {workspace}</span>
      </div>

      <Shelf />

      <div className="desk-surface--app">
        <Sidebar />
        <MainPane />
        <RightPanel />
      </div>

      <DeskStatusBar />

      <CommandPalette />

      {loading && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center text-sm text-neutral-400">
          Loading vault…
        </div>
      )}
      {error && !loading && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600 shadow">
          Failed to load vault: {error}
        </div>
      )}
    </div>
  );
}
