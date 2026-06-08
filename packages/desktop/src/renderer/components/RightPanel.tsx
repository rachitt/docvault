import { useState } from 'react';
import { Check, LayoutTemplate, X } from 'lucide-react';
import { useStore, type RightTab } from '../store';
import { Outline } from './Outline';
import { AiAssistant } from './AiAssistant';
import { Backlinks } from './Backlinks';

const LABELS: Record<RightTab, string> = {
  outline: 'Outline',
  links: 'Backlinks',
  ai: 'AI Assistant',
};

export function RightPanel(): React.JSX.Element {
  const rightTab = useStore((s) => s.rightTab);
  const setRightTab = useStore((s) => s.setRightTab);
  const currentDoc = useStore((s) => s.currentDoc);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--dv-border)] bg-[var(--dv-sidebar)]">
      {currentDoc && !currentDoc.frontmatter.source && <SaveAsTemplateAction />}
      <div className="flex border-b border-[var(--dv-border)] text-sm">
        {(['outline', 'links', 'ai'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setRightTab(tab)}
            className={`flex-1 px-2 py-2.5 text-xs whitespace-nowrap ${
              rightTab === tab
                ? 'border-b-2 border-[var(--dv-accent)] font-medium text-neutral-900 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
            }`}
          >
            {LABELS[tab]}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rightTab === 'outline' && <Outline />}
        {rightTab === 'links' && <Backlinks />}
        {rightTab === 'ai' && <AiAssistant />}
      </div>
    </aside>
  );
}

/**
 * "Save as template" action: turns the open doc's body into a reusable template
 * under the vault's templates/ folder. Electron has no window.prompt(), so the
 * template name is collected through an inline field (mirrors Sidebar's pattern).
 */
function SaveAsTemplateAction(): React.JSX.Element {
  const currentDoc = useStore((s) => s.currentDoc);
  const saveCurrentAsTemplate = useStore((s) => s.saveCurrentAsTemplate);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const commit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await saveCurrentAsTemplate(trimmed);
      setEditing(false);
      setName('');
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => {
          setName(currentDoc?.frontmatter.title ?? '');
          setEditing(true);
        }}
        className="flex items-center gap-2 border-b border-[var(--dv-border)] px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-200/40 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <LayoutTemplate size={14} className="text-neutral-400" />
        Save as template
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 border-b border-[var(--dv-border)] px-2 py-2">
      <input
        autoFocus
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit();
          else if (e.key === 'Escape') setEditing(false);
        }}
        placeholder="Template name"
        className="min-w-0 flex-1 rounded-md border border-[var(--dv-accent)] bg-white px-2 py-1 text-xs text-neutral-800 outline-none dark:bg-neutral-900 dark:text-neutral-100"
      />
      <button
        onClick={() => void commit()}
        disabled={busy}
        title="Save"
        className="rounded p-1 text-neutral-500 hover:bg-neutral-200/60 disabled:opacity-50 dark:hover:bg-neutral-800"
      >
        <Check size={14} />
      </button>
      <button
        onClick={() => setEditing(false)}
        title="Cancel"
        className="rounded p-1 text-neutral-500 hover:bg-neutral-200/60 dark:hover:bg-neutral-800"
      >
        <X size={14} />
      </button>
    </div>
  );
}
