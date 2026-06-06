import { useEffect, useState } from 'react';
import {
  Bot,
  Check,
  Monitor,
  Moon,
  Palette,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Terminal,
} from 'lucide-react';
import type { ThemeMode, VaultConfig } from '@docvault/core';
import { useStore } from '../store';

const AI_BACKENDS: { value: VaultConfig['aiBackend']; label: string; hint: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { value: 'claude', label: 'Claude Code', hint: 'Anthropic Claude via the Claude Code CLI.', icon: Sparkles },
  { value: 'codex', label: 'Codex', hint: 'OpenAI Codex via the Codex CLI.', icon: Terminal },
];

const THEMES: { value: ThemeMode; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function Settings(): React.JSX.Element {
  const config = useStore((s) => s.config);
  const updateConfig = useStore((s) => s.updateConfig);
  const setTheme = useStore((s) => s.setTheme);

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

      <Section title="Appearance" description="Choose how DocVault looks." icon={Palette}>
        <Field label="Theme">
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map(({ value, label, icon: Icon }) => {
              const active = (config.theme ?? 'system') === value;
              return (
                <button
                  key={value}
                  onClick={() => void setTheme(value)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 transition-colors ${
                    active
                      ? 'border-[var(--dv-accent)] bg-blue-50/50'
                      : 'border-[var(--dv-border)] bg-white hover:border-neutral-300'
                  }`}
                >
                  <Icon size={18} />
                  <span className="text-xs font-medium text-neutral-700">{label}</span>
                </button>
              );
            })}
          </div>
        </Field>
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

      <Section title="Storage" description="Counts derived from this vault's config.">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Starred" value={config.starred.length} />
          <Stat label="Recent" value={config.recent.length} />
          <Stat label="In trash" value={config.trash.length} />
        </div>
      </Section>
    </div>
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
