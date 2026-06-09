import { useEffect, useMemo, useState } from 'react';
import { Clipboard, History, RotateCcw, Save } from 'lucide-react';
import type { Doc, DocVersion } from '@docvault/core';
import { useStore } from '../store';

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function reasonLabel(version: DocVersion): string {
  if (version.manual) return 'Manual';
  return version.reason[0]!.toUpperCase() + version.reason.slice(1);
}

export function VersionHistory(): React.JSX.Element {
  const currentDoc = useStore((s) => s.currentDoc);
  const listVersions = useStore((s) => s.listVersions);
  const readVersion = useStore((s) => s.readVersion);
  const saveVersion = useStore((s) => s.saveVersion);
  const restoreVersion = useStore((s) => s.restoreVersion);
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => versions.find((v) => v.id === selectedId) ?? versions[0] ?? null,
    [selectedId, versions],
  );

  const reload = async (): Promise<void> => {
    if (!currentDoc) return;
    const next = await listVersions(currentDoc.frontmatter.id);
    setVersions(next);
    setSelectedId((id) => (id && next.some((v) => v.id === id) ? id : next[0]?.id ?? null));
  };

  useEffect(() => {
    setPreview(null);
    setError(null);
    void reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the open doc changes
  }, [currentDoc?.frontmatter.id, currentDoc?.frontmatter.updated]);

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void readVersion(selected.docId, selected.id)
      .then((doc) => {
        if (!cancelled) setPreview(doc);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [readVersion, selected]);

  const saveSnapshot = async (): Promise<void> => {
    if (!currentDoc) return;
    setBusy(true);
    setError(null);
    try {
      await saveVersion(currentDoc.frontmatter.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const restoreSnapshot = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await restoreVersion(selected.docId, selected.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copySnapshot = async (): Promise<void> => {
    if (!preview) return;
    await navigator.clipboard.writeText(preview.content);
  };

  if (!currentDoc) {
    return <p className="p-4 text-sm text-neutral-400">Open a document to see history.</p>;
  }

  return (
    <div className="dv-version-history flex min-h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--dv-border)] px-3 py-2">
        <History size={15} className="dv-version-muted text-neutral-400" />
        <span className="dv-version-title min-w-0 flex-1 text-xs font-medium text-neutral-700 dark:text-neutral-200">
          {versions.length} version{versions.length === 1 ? '' : 's'}
        </span>
        <button
          onClick={() => void saveSnapshot()}
          disabled={busy}
          title="Save current version"
          className="dv-version-icon rounded p-1 text-neutral-500 hover:bg-neutral-200/60 disabled:opacity-50 dark:hover:bg-neutral-800"
        >
          <Save size={14} />
        </button>
      </div>
      {error && (
        <p className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="border-b border-[var(--dv-border)]">
        {versions.length === 0 ? (
          <p className="dv-version-muted px-3 py-4 text-sm text-neutral-400">No saved versions yet.</p>
        ) : (
          versions.map((version) => (
            <button
              key={version.id}
              onClick={() => setSelectedId(version.id)}
              className={`dv-version-row block w-full border-b border-[var(--dv-border)] px-3 py-2 text-left last:border-b-0 ${
                selected?.id === version.id
                  ? 'bg-neutral-200/50 dark:bg-neutral-800'
                  : 'hover:bg-neutral-200/30 dark:hover:bg-neutral-800/60'
              }`}
            >
              <span className="dv-version-title block truncate text-xs font-medium text-neutral-800 dark:text-neutral-100">
                {formatTime(version.createdAt)}
              </span>
              <span className="dv-version-muted mt-0.5 block truncate text-[11px] text-neutral-500">
                {reasonLabel(version)} / {version.actor}
              </span>
            </button>
          ))
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected && (
          <div className="flex items-center gap-1.5 border-b border-[var(--dv-border)] px-3 py-2">
            <button
              onClick={() => void restoreSnapshot()}
              disabled={busy}
              className="dv-version-action inline-flex items-center gap-1.5 rounded-md border border-[var(--dv-border)] px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <RotateCcw size={13} />
              Restore
            </button>
            <button
              onClick={() => void copySnapshot()}
              disabled={!preview}
              title="Copy snapshot text"
              className="dv-version-icon rounded p-1.5 text-neutral-500 hover:bg-neutral-200/60 disabled:opacity-50 dark:hover:bg-neutral-800"
            >
              <Clipboard size={14} />
            </button>
          </div>
        )}
        {preview ? (
          <pre className="dv-version-preview whitespace-pre-wrap break-words px-3 py-3 text-xs leading-5 text-neutral-700 dark:text-neutral-200">
            {preview.content}
          </pre>
        ) : selected ? (
          <p className="dv-version-muted p-4 text-sm text-neutral-400">Loading version...</p>
        ) : null}
      </div>
    </div>
  );
}
