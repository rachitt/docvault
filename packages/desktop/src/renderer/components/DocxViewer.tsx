import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';

/** Render an imported DOCX original faithfully via docx-preview. */
export function DocxViewer({ data }: { data: Uint8Array }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    el.innerHTML = '';
    // Copy into a standalone ArrayBuffer-backed Blob so docx-preview (which
    // reads the whole buffer) isn't affected by the view's offset.
    const blob = new Blob([data.slice()]);
    renderAsync(blob, el, undefined, {
      className: 'docx',
      inWrapper: true,
      ignoreWidth: false,
    }).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  return (
    <>
      {error && <p className="dv-mermaid-error">Could not render DOCX: {error}</p>}
      <div
        ref={ref}
        className="dv-docx overflow-auto rounded-lg border border-[var(--dv-border)] bg-white p-2 dark:bg-neutral-900"
      />
    </>
  );
}
