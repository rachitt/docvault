import { Check, HardDrive } from 'lucide-react';
import { useStore } from '../store';

export function StatusBar(): React.JSX.Element {
  const docs = useStore((s) => s.docs);
  return (
    <footer className="flex h-6 items-center gap-3 border-t border-[var(--dv-border)] bg-[var(--dv-sidebar)] px-3 text-[11px] text-neutral-500">
      <span className="flex items-center gap-1">
        <HardDrive size={12} /> Local
      </span>
      <span className="flex items-center gap-1 text-emerald-600">
        <Check size={12} /> synced
      </span>
      <div className="flex-1" />
      <span>{docs.length} docs</span>
    </footer>
  );
}
