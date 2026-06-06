import { useEffect, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
// Bundle the pdf.js worker as an asset URL so it loads under Electron's file://
// origin without a network fetch.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

/** Render an imported PDF original with page navigation + zoom. */
export function PdfViewer({ data }: { data: Uint8Array }): React.JSX.Element {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.1);
  const [error, setError] = useState<string | null>(null);

  // react-pdf keeps a reference to the buffer; pass a fresh object identity only
  // when the bytes change so it doesn't reload on every render.
  const [file, setFile] = useState<{ data: Uint8Array }>({ data });
  useEffect(() => {
    setFile({ data });
    setPage(1);
  }, [data]);

  if (error) {
    return <p className="dv-mermaid-error">Could not render PDF: {error}</p>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm text-neutral-500">
        <button
          className="rounded p-1 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          {numPages ? `${page} / ${numPages}` : '…'}
        </span>
        <button
          className="rounded p-1 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
          disabled={page >= numPages}
          onClick={() => setPage((p) => Math.min(numPages, p + 1))}
        >
          <ChevronRight size={16} />
        </button>
        <span className="mx-1 h-4 w-px bg-[var(--dv-border)]" />
        <button
          className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={() => setScale((s) => Math.max(0.5, +(s - 0.15).toFixed(2)))}
        >
          <ZoomOut size={16} />
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button
          className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          onClick={() => setScale((s) => Math.min(3, +(s + 0.15).toFixed(2)))}
        >
          <ZoomIn size={16} />
        </button>
      </div>
      <div className="flex justify-center overflow-auto rounded-lg border border-[var(--dv-border)] bg-neutral-100 p-4 dark:bg-neutral-900">
        <Document
          file={file}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={(e) => setError(e.message)}
          loading={<p className="p-8 text-sm text-neutral-400">Loading PDF…</p>}
        >
          <Page pageNumber={page} scale={scale} renderTextLayer renderAnnotationLayer />
        </Document>
      </div>
    </div>
  );
}
