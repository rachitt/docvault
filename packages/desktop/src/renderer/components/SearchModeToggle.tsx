import { Sparkles, Type, Zap } from 'lucide-react';
import type { SearchMode } from '../../shared/ipc';
import { useStore } from '../store';

const MODES: { value: SearchMode; label: string; icon: React.ComponentType<{ size?: number }>; semantic: boolean }[] = [
  { value: 'fts', label: 'Keyword', icon: Type, semantic: false },
  { value: 'semantic', label: 'Semantic', icon: Sparkles, semantic: true },
  { value: 'hybrid', label: 'Hybrid', icon: Zap, semantic: true },
];

/**
 * Three-way search strategy toggle (keyword / semantic / hybrid), shared via the
 * store so the command palette and the full-page results view stay in sync. When
 * semantic indexing is disabled in Settings, the semantic + hybrid options are
 * shown disabled (keyword still works), so the feature's availability is obvious.
 */
export function SearchModeToggle(): React.JSX.Element {
  const searchMode = useStore((s) => s.searchMode);
  const setSearchMode = useStore((s) => s.setSearchMode);
  const semanticEnabled = useStore((s) => s.config?.semanticEnabled ?? true);

  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--dv-border)] bg-white p-0.5 dark:bg-neutral-900">
      {MODES.map(({ value, label, icon: Icon, semantic }) => {
        const disabled = semantic && !semanticEnabled;
        const active = searchMode === value && !disabled;
        return (
          <button
            key={value}
            type="button"
            disabled={disabled}
            title={disabled ? 'Enable semantic search in Settings' : `${label} search`}
            onClick={() => setSearchMode(value)}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-[var(--dv-accent)] text-white'
                : disabled
                  ? 'cursor-not-allowed text-neutral-300 dark:text-neutral-600'
                  : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
