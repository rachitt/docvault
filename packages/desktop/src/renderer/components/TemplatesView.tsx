import { useEffect } from 'react';
import { LayoutTemplate, Variable } from 'lucide-react';
import { useStore } from '../store';
import { customVariables } from '../lib/templates';

/**
 * Templates gallery. Lists the document templates from the vault's templates/
 * folder (seeded starters + anything saved via "Save as template"). Clicking a
 * card starts the from-template new-doc flow with that template pre-selected.
 * Mirrors TagsView for structure + Desk styling.
 */
export function TemplatesView(): React.JSX.Element {
  const templates = useStore((s) => s.templates);
  const loadTemplates = useStore((s) => s.loadTemplates);
  const openNewDocPicker = useStore((s) => s.openNewDocPicker);

  // Refresh on entry so newly saved templates show up without a full reload.
  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  return (
    <div className="mx-auto max-w-3xl px-12 py-10">
      <h1 className="mb-2 flex items-center gap-2 text-3xl font-bold text-neutral-900 dark:text-neutral-100">
        <LayoutTemplate size={24} className="text-neutral-400" /> Templates
      </h1>
      <p className="mb-6 text-sm text-neutral-500">
        Start a new document from a reusable template. Save any open doc as a template from its
        right-panel menu.
      </p>

      {templates.length === 0 ? (
        <p className="text-sm text-neutral-400">
          No templates yet. Drop reusable docs in the vault's <code>templates/</code> folder, or use
          “Save as template” on an open doc.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {templates.map((t) => {
            const custom = customVariables(t);
            return (
              <button
                key={t.id}
                onClick={() => openNewDocPicker({ templateId: t.id })}
                className="flex flex-col gap-2 rounded-xl border border-[var(--dv-border)] bg-white p-4 text-left hover:border-[var(--dv-accent)] hover:bg-neutral-50 dark:bg-neutral-900 dark:hover:bg-neutral-800"
              >
                <div className="flex items-center gap-2">
                  <LayoutTemplate size={18} className="shrink-0 text-[var(--dv-accent)]" />
                  <span className="truncate font-medium text-neutral-800 dark:text-neutral-100">
                    {t.title}
                  </span>
                </div>
                {t.description && (
                  <span className="line-clamp-2 text-xs text-neutral-500">{t.description}</span>
                )}
                {custom.length > 0 && (
                  <span className="mt-auto inline-flex items-center gap-1 text-[11px] text-neutral-400">
                    <Variable size={12} />
                    {custom.length} variable{custom.length === 1 ? '' : 's'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
