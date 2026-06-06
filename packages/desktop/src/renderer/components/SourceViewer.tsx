import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, FileType2 } from 'lucide-react';
import type { Doc } from '@docvault/core';
import { useStore } from '../store';
import { PdfViewer } from './PdfViewer';
import { DocxViewer } from './DocxViewer';

type Mode = 'preview' | 'text';

/**
 * Viewer for imported files (pdf/docx/txt). Renders the original in-app
 * (react-pdf / docx-preview) alongside the extracted-text sidecar that powers
 * search + agents, with an "open original" escape hatch. Re-reads itself when
 * the original or its sidecar changes on disk.
 */
export function SourceViewer({ doc }: { doc: Doc }): React.JSX.Element {
  const setCurrentDoc = useStore((s) => s.setCurrentDoc);
  const source = doc.frontmatter.source!;
  const ext = source.split('.').pop()?.toLowerCase() ?? '';
  const canPreview = ext === 'pdf' || ext === 'docx';

  const [mode, setMode] = useState<Mode>(canPreview ? 'preview' : 'text');
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Load the original's bytes for preview (pdf/docx only).
  useEffect(() => {
    if (!canPreview) return;
    let cancelled = false;
    setBytes(null);
    setLoadError(null);
    window.docvault
      .readSource(source)
      .then((b) => {
        if (!cancelled) setBytes(b);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [source, canPreview, nonce]);

  // Reconcile on-disk changes to either the original or its extracted sidecar.
  const reconcile = useCallback(
    async (paths: string[]) => {
      if (!paths.includes(doc.relPath) && !paths.includes(source)) return;
      try {
        const fresh = await window.docvault.readDoc(doc.frontmatter.id);
        setCurrentDoc(fresh); // refresh extracted text
      } catch {
        return;
      }
      setNonce((n) => n + 1); // reload original bytes
    },
    [doc.relPath, doc.frontmatter.id, source, setCurrentDoc],
  );
  useEffect(() => window.docvault.onVaultChanged((paths) => void reconcile(paths)), [reconcile]);

  return (
    <div className="mx-auto max-w-3xl px-12 py-10">
      <div className="mb-4 flex items-center gap-3">
        <FileType2 className="text-neutral-400" />
        <h1 className="flex-1 text-3xl font-bold text-neutral-900 dark:text-neutral-100">
          {doc.frontmatter.title}
        </h1>
        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800">
          {ext.toUpperCase() || 'FILE'}
        </span>
      </div>

      <div className="mb-5 flex items-center gap-2">
        {canPreview && (
          <div className="flex overflow-hidden rounded-md border border-[var(--dv-border)] text-sm">
            {(['preview', 'text'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 capitalize ${
                  mode === m
                    ? 'bg-[var(--dv-accent)] text-white'
                    : 'text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                {m === 'text' ? 'Extracted text' : 'Preview'}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => void window.docvault.openOriginal(source)}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dv-border)] px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          <ExternalLink size={14} /> Open original
        </button>
      </div>

      {canPreview && mode === 'preview' ? (
        loadError ? (
          <p className="dv-mermaid-error">Could not load original: {loadError}</p>
        ) : !bytes ? (
          <p className="p-8 text-center text-sm text-neutral-400">Loading original…</p>
        ) : ext === 'pdf' ? (
          <PdfViewer data={bytes} />
        ) : (
          <DocxViewer data={bytes} />
        )
      ) : (
        <div className="rounded-lg border border-[var(--dv-border)] bg-neutral-50 p-5 dark:bg-neutral-900">
          <p className="mb-2 text-xs font-medium tracking-wide text-neutral-400 uppercase">
            Extracted text
          </p>
          <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300">
            {doc.content}
          </pre>
        </div>
      )}
    </div>
  );
}
