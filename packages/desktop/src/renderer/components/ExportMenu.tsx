import { useEffect, useRef, useState } from 'react';
import { Download, FileCode, FileText, FileType, Loader2 } from 'lucide-react';
import type { ExportFormat } from '../../shared/ipc';
import { useStore } from '../store';

const FORMATS: { format: ExportFormat; label: string; icon: React.ReactNode }[] = [
  { format: 'pdf', label: 'PDF', icon: <FileText size={15} /> },
  { format: 'html', label: 'HTML', icon: <FileCode size={15} /> },
  { format: 'docx', label: 'Word (.docx)', icon: <FileType size={15} /> },
];

/** Export button + format dropdown for the open doc. */
export function ExportMenu({ idOrPath }: { idOrPath: string }): React.JSX.Element {
  const exportDoc = useStore((s) => s.exportDoc);
  const exporting = useStore((s) => s.exporting);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (format: ExportFormat): void => {
    setOpen(false);
    void exportDoc(idOrPath, format);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={exporting}
        title="Export"
        className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        {exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            Export as
          </div>
          {FORMATS.map((f) => (
            <button
              key={f.format}
              onClick={() => pick(f.format)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <span className="text-neutral-400">{f.icon}</span>
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
