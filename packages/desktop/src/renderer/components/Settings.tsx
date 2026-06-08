import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  Palette,
  SlidersHorizontal,
  Sparkles,
  Terminal,
} from 'lucide-react';
import type { VaultConfig } from '@docvault/core';
import type { EmbeddingStatus } from '../../shared/ipc';
import { useStore } from '../store';

const AI_BACKENDS: { value: VaultConfig['aiBackend']; label: string; hint: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { value: 'claude', label: 'Claude Code', hint: 'Anthropic Claude via the Claude Code CLI.', icon: Sparkles },
  { value: 'codex', label: 'Codex', hint: 'OpenAI Codex via the Codex CLI.', icon: Terminal },
];

export function Settings(): React.JSX.Element {
  const config = useStore((s) => s.config);
  const trash = useStore((s) => s.trash);
  const updateConfig = useStore((s) => s.updateConfig);

  // Local mirror of the workspace name so typing feels immediate; we persist on blur.
  const [name, setName] = useState(config?.workspaceName ?? '');
  useEffect(() => {
    setName(config?.workspaceName ?? '');
  }, [config?.workspaceName]);

  if (!config) {
    return <div className="flex h-full items-center justify-center text-neutral-400">Loading settings…</div>;
  }

  const commitName = (): void => {
    const next = name.trim();
    if (next && next !== config.workspaceName) void updateConfig({ workspaceName: next });
    else setName(config.workspaceName);
  };

  return (
    <div className="mx-auto max-w-3xl px-12 py-10">
      <div className="mb-8 flex items-center gap-3">
        <SlidersHorizontal size={26} className="text-neutral-500" />
        <h1 className="text-3xl font-bold text-neutral-900">Settings</h1>
      </div>

      <Section title="Workspace" description="How this vault is identified across the app.">
        <Field label="Workspace name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            placeholder="My Workspace"
            className="w-full rounded-lg border border-[var(--dv-border)] bg-white px-3 py-2 text-sm text-neutral-800 outline-none focus:border-[var(--dv-accent)]"
          />
        </Field>
      </Section>

      <Section title="Appearance" description="How DocVault looks." icon={Palette}>
        <p className="text-sm text-neutral-500">
          DocVault uses the <span className="font-medium text-neutral-700">Desk</span> theme — a
          warm, always-light parchment workspace.
        </p>
      </Section>

      <Section
        title="AI assistant"
        description="Which agent backend powers the assistant panel."
        icon={Bot}
      >
        <Field label="Backend">
          <div className="grid grid-cols-2 gap-2">
            {AI_BACKENDS.map(({ value, label, hint, icon: Icon }) => {
              const active = config.aiBackend === value;
              return (
                <button
                  key={value}
                  onClick={() => void updateConfig({ aiBackend: value })}
                  className={`flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? 'border-[var(--dv-accent)] bg-blue-50/50'
                      : 'border-[var(--dv-border)] bg-white hover:border-neutral-300'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                    <Icon size={15} />
                    {label}
                    {active && <Check size={14} className="ml-auto text-[var(--dv-accent)]" />}
                  </span>
                  <span className="text-xs text-neutral-500">{hint}</span>
                </button>
              );
            })}
          </div>
        </Field>

        <Toggle
          label="Stream responses"
          description="Render the assistant's output token-by-token as it arrives."
          checked={config.aiStreaming}
          onChange={(v) => void updateConfig({ aiStreaming: v })}
        />
      </Section>

      <SemanticSection semanticEnabled={config.semanticEnabled} />

      <Section title="Storage" description="Counts derived from this vault's config.">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Starred" value={config.starred.length} />
          <Stat label="Recent" value={config.recent.length} />
          <Stat label="In trash" value={trash.length} />
        </div>
      </Section>
    </div>
  );
}

/**
 * Semantic-search section: a toggle that enables/disables semantic indexing
 * (persisted in config), plus a live embedding/backfill progress indicator.
 *
 * Progress is surfaced by polling `embeddingStatus()` every second while work is
 * pending (the simpler, robust option vs. a dedicated main→renderer event
 * channel — backfill is bounded and the status query is cheap). Enabling the
 * toggle kicks off a backfill so existing docs become searchable. `error`
 * surfaces a failed first-run model download (e.g. offline).
 */
function SemanticSection({ semanticEnabled }: { semanticEnabled: boolean }): React.JSX.Element {
  const updateConfig = useStore((s) => s.updateConfig);
  const embeddingStatus = useStore((s) => s.embeddingStatus);
  const backfillEmbeddings = useStore((s) => s.backfillEmbeddings);
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  const poll = useCallback(async () => {
    try {
      setStatus(await embeddingStatus());
    } catch {
      /* status is best-effort; ignore transient IPC errors */
    }
  }, [embeddingStatus]);

  // Poll while semantic is on: every 1s if there's pending/in-flight work,
  // otherwise a slower idle refresh so a fresh error still surfaces.
  useEffect(() => {
    if (!semanticEnabled) {
      setStatus(null);
      return;
    }
    void poll();
    const busy = backfilling || (!!status && (status.pending > 0 || status.inFlight > 0));
    const interval = setInterval(() => void poll(), busy ? 1000 : 5000);
    return () => clearInterval(interval);
  }, [semanticEnabled, poll, backfilling, status]);

  const onToggle = async (on: boolean): Promise<void> => {
    await updateConfig({ semanticEnabled: on });
    if (on) {
      // Backfill embeddings for docs indexed before semantic was enabled.
      setBackfilling(true);
      try {
        setStatus(await backfillEmbeddings());
      } catch {
        await poll();
      } finally {
        setBackfilling(false);
      }
    }
  };

  const done = status ? status.total - status.pending : 0;
  const pct = status && status.total > 0 ? Math.round((done / status.total) * 100) : 100;
  const inProgress = backfilling || (!!status && (status.pending > 0 || status.inFlight > 0));

  return (
    <Section
      title="Semantic search"
      description="Meaning-based search and related-docs, powered by a local on-device embedding model."
      icon={Sparkles}
    >
      <Toggle
        label="Enable semantic search"
        description="Adds Semantic and Hybrid search modes plus the Related-docs panel. The first run downloads a small embedding model."
        checked={semanticEnabled}
        onChange={(v) => void onToggle(v)}
      />

      {semanticEnabled && (
        <div className="rounded-lg border border-[var(--dv-border)] bg-white px-3 py-2.5">
          {status?.error ? (
            <div className="flex items-start gap-2 text-sm text-amber-700">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                Embedding failed: {status.error}. Check your connection — the model downloads on
                first use.
              </span>
            </div>
          ) : (
            <>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-medium text-neutral-700">
                  {inProgress ? 'Indexing documents…' : 'Documents indexed'}
                </span>
                <span className="text-xs text-neutral-500">
                  {status ? `${done} / ${status.total}` : '…'}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                <div
                  className="h-full rounded-full bg-[var(--dv-accent)] transition-[width] duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

function Section(props: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="mb-8 border-t border-[var(--dv-border)] pt-6 first-of-type:border-t-0 first-of-type:pt-0">
      <h2 className="text-sm font-semibold tracking-wide text-neutral-800 uppercase">{props.title}</h2>
      {props.description && <p className="mt-1 mb-4 text-xs text-neutral-500">{props.description}</p>}
      <div className="flex flex-col gap-4">{props.children}</div>
    </section>
  );
}

function Field(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-neutral-700">{props.label}</span>
      {props.children}
    </label>
  );
}

function Toggle(props: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      onClick={() => props.onChange(!props.checked)}
      className="flex items-center justify-between gap-4 text-left"
    >
      <span>
        <span className="block text-sm font-medium text-neutral-700">{props.label}</span>
        {props.description && <span className="block text-xs text-neutral-500">{props.description}</span>}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          props.checked ? 'bg-[var(--dv-accent)]' : 'bg-neutral-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            props.checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}

function Stat(props: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-[var(--dv-border)] bg-white px-3 py-2.5">
      <div className="text-xl font-semibold text-neutral-800">{props.value}</div>
      <div className="text-xs text-neutral-500">{props.label}</div>
    </div>
  );
}
