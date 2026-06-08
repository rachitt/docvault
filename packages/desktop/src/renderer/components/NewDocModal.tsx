import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileText, LayoutTemplate, Sparkles } from 'lucide-react';
import { useStore } from '../store';
import { customVariables } from '../lib/templates';

/**
 * The new-doc flow modal: pick a destination product + title, then choose to
 * start blank or instantiate a template. When a chosen template declares custom
 * {{variables}} (beyond the auto-filled title/date/author built-ins), a second
 * step collects those values before creating the doc.
 *
 * Opened via `store.openNewDocPicker(...)`; closed by setting `newDocFor` null.
 * `product` pre-selects a destination (from a per-product "+"); `templateId`
 * pre-selects a template (from the Templates gallery).
 */
export function NewDocModal(): React.JSX.Element | null {
  const init = useStore((s) => s.newDocFor);
  const products = useStore((s) => s.products);
  const templates = useStore((s) => s.templates);
  const newDoc = useStore((s) => s.newDoc);
  const createFromTemplate = useStore((s) => s.createFromTemplate);
  const close = useStore((s) => s.openNewDocPicker);

  const [title, setTitle] = useState('');
  const [product, setProduct] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  // Custom-variable values keyed by name (only used when a template is chosen).
  const [vars, setVars] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed selections from the opener each time the modal opens.
  useEffect(() => {
    if (!init) return;
    setTitle('');
    setProduct(init.product ?? '');
    setTemplateId(init.templateId ?? null);
    setVars({});
    setBusy(false);
    setError(null);
  }, [init]);

  const chosenTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );
  const needsVars = useMemo(
    () => (chosenTemplate ? customVariables(chosenTemplate) : []),
    [chosenTemplate],
  );

  if (!init) return null;

  const canSubmit = title.trim().length > 0 && product.length > 0;

  const submit = async (): Promise<void> => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (templateId) {
        await createFromTemplate({
          template_id: templateId,
          product,
          title: title.trim(),
          ...(needsVars.length ? { vars } : {}),
        });
      } else {
        await newDoc(product, title.trim());
        close(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[12vh]"
      onClick={() => close(null)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--dv-border)] bg-white shadow-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--dv-border)] px-4 py-3">
          <Sparkles size={16} className="text-[var(--dv-accent)]" />
          <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            New document
          </span>
        </div>

        <div className="flex flex-col gap-4 px-4 py-4">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-neutral-500">
            Title
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && needsVars.length === 0) void submit();
                if (e.key === 'Escape') close(null);
              }}
              placeholder="Untitled"
              className="rounded-md border border-[var(--dv-border)] bg-white px-2.5 py-1.5 text-sm text-neutral-800 outline-none focus:border-[var(--dv-accent)] dark:bg-neutral-800 dark:text-neutral-100"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-xs font-medium text-neutral-500">
            Product
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="rounded-md border border-[var(--dv-border)] bg-white px-2.5 py-1.5 text-sm text-neutral-800 outline-none focus:border-[var(--dv-accent)] dark:bg-neutral-800 dark:text-neutral-100"
            >
              <option value="" disabled>
                Choose a product…
              </option>
              {products.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-neutral-500">Start from</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setTemplateId(null);
                  setVars({});
                }}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm ${
                  templateId === null
                    ? 'border-[var(--dv-accent)] bg-neutral-50 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
                    : 'border-[var(--dv-border)] text-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                }`}
              >
                <FileText size={15} className="text-neutral-400" />
                Blank doc
              </button>
            </div>

            {templates.length > 0 && (
              <div className="mt-1 flex max-h-44 flex-col gap-1 overflow-y-auto">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTemplateId(t.id);
                      setVars({});
                    }}
                    className={`flex items-start gap-2 rounded-md border px-3 py-2 text-left text-sm ${
                      templateId === t.id
                        ? 'border-[var(--dv-accent)] bg-neutral-50 dark:bg-neutral-800'
                        : 'border-[var(--dv-border)] hover:bg-neutral-50 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <LayoutTemplate size={15} className="mt-0.5 shrink-0 text-neutral-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-neutral-800 dark:text-neutral-100">
                        {t.title}
                      </span>
                      {t.description && (
                        <span className="block truncate text-xs text-neutral-400">
                          {t.description}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Variable input: only the custom vars a chosen template declares. */}
          {needsVars.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border border-[var(--dv-border)] bg-neutral-50 p-3 dark:bg-neutral-800/50">
              <span className="text-xs font-medium text-neutral-500">
                Fill in “{chosenTemplate?.title}” variables
              </span>
              {needsVars.map((name) => (
                <label key={name} className="flex flex-col gap-1 text-[11px] text-neutral-500">
                  {name}
                  <input
                    value={vars[name] ?? ''}
                    onChange={(e) => setVars((v) => ({ ...v, [name]: e.target.value }))}
                    placeholder={`{{${name}}}`}
                    className="rounded-md border border-[var(--dv-border)] bg-white px-2.5 py-1.5 text-sm text-neutral-800 outline-none focus:border-[var(--dv-accent)] dark:bg-neutral-900 dark:text-neutral-100"
                  />
                </label>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--dv-border)] px-4 py-3">
          <button
            type="button"
            onClick={() => close(null)}
            className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
          >
            <ArrowLeft size={14} /> Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit || busy}
            onClick={() => void submit()}
            className="rounded-md bg-[var(--dv-accent)] px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Creating…' : templateId ? 'Create from template' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
