import { ExternalLink, FileType2 } from 'lucide-react';
import type { Doc } from '@docvault/core';

/**
 * Read-only view for imported files (pdf/docx/txt). Shows the extracted text
 * sidecar (which is what powers search + agents) and a button to open the
 * original file in the OS default app.
 */
export function SourceViewer({ doc }: { doc: Doc }): React.JSX.Element {
  const source = doc.frontmatter.source!;
  const ext = source.split('.').pop()?.toUpperCase() ?? 'FILE';
  return (
    <div className="mx-auto max-w-3xl px-12 py-10">
      <div className="mb-4 flex items-center gap-3">
        <FileType2 className="text-neutral-400" />
        <h1 className="flex-1 text-3xl font-bold text-neutral-900">{doc.frontmatter.title}</h1>
        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
          {ext}
        </span>
      </div>
      <button
        onClick={() => void window.docvault.openOriginal(source)}
        className="mb-6 inline-flex items-center gap-1.5 rounded-md border border-[var(--dv-border)] px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
      >
        <ExternalLink size={14} /> Open original
      </button>
      <div className="rounded-lg border border-[var(--dv-border)] bg-neutral-50 p-5">
        <p className="mb-2 text-xs font-medium tracking-wide text-neutral-400 uppercase">
          Extracted text
        </p>
        <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed text-neutral-700">
          {doc.content}
        </pre>
      </div>
    </div>
  );
}
