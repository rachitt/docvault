/**
 * Document templates: markdown files living in a `templates/` folder inside the
 * vault, plus a pure `{{placeholder}}` engine. A template is just a markdown file
 * with a body containing `{{variable}}` placeholders; instantiating it renders
 * those placeholders and creates a regular doc (so it lands in the FTS index and
 * backlinks like any other doc).
 *
 * Split of concerns, mirroring the rest of core:
 *  - Pure helpers (`extractVariables`, `renderTemplate`) — no fs/DOM, trivially
 *    unit-testable, shared by the MCP server and the desktop app.
 *  - `TemplateStore` — the thin filesystem layer (list/read/save/seed) over the
 *    vault's `templates/` directory, with path-traversal guards.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';
import { assertSafeSegment, slugify } from './doc.js';
import type { Vault } from './vault.js';

/** Built-in placeholders the engine always knows how to fill. */
export const BUILTIN_VARIABLES = ['title', 'date', 'author'] as const;
export type BuiltinVariable = (typeof BUILTIN_VARIABLES)[number];

/** Metadata for a single template (no body — see {@link Template}). */
export interface TemplateMeta {
  /** Stable kebab id / filename stem (without `.md`), e.g. `meeting-notes`. */
  id: string;
  /** Human label shown in pickers. */
  title: string;
  /** Optional one-line description (from frontmatter). */
  description?: string;
  /** Every `{{variable}}` the body declares, in first-seen order. */
  variables: string[];
}

/** A template plus its raw markdown body. */
export interface Template extends TemplateMeta {
  /** Markdown body (without frontmatter), containing `{{placeholders}}`. */
  body: string;
}

/** Values supplied when rendering a template body. */
export interface TemplateRenderContext {
  /** Built-in: the new doc's title. */
  title?: string;
  /** Built-in: a date string; defaults to today's ISO date (YYYY-MM-DD). */
  date?: string;
  /** Built-in: the author name. */
  author?: string;
  /** Arbitrary user-supplied variables, keyed by name. */
  vars?: Record<string, string>;
}

// A `{{ name }}` placeholder. Names are letters/digits/underscore/hyphen, so a
// stray `{{` in prose (or `{{{}}}`) is left untouched rather than mangled.
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;

/**
 * Discover every distinct `{{variable}}` declared in a template body, in
 * first-seen order. Pure. Built-in names (title/date/author) are included if the
 * body uses them, so callers can see the full set a template expects.
 */
export function extractVariables(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(PLACEHOLDER_RE)) {
    const name = m[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Substitute `{{placeholders}}` in `body` using built-ins (title/date/author)
 * plus any user-supplied `vars`. Resolution order for a name: explicit `vars`
 * entry → built-in context value → blank.
 *
 * Documented rule for missing/unknown variables: a placeholder whose value is
 * not provided is replaced with the empty string. We deliberately do NOT leave
 * the literal `{{name}}` in the output so an unfilled template never ships raw
 * placeholder syntax into a published doc. `date` falls back to today's ISO date
 * when omitted; all other built-ins fall back to blank.
 */
export function renderTemplate(body: string, ctx: TemplateRenderContext = {}): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const builtins: Record<BuiltinVariable, string> = {
    title: ctx.title ?? '',
    date: ctx.date ?? today,
    author: ctx.author ?? '',
  };
  const vars = ctx.vars ?? {};
  return body.replace(PLACEHOLDER_RE, (_match, rawName: string) => {
    const name = rawName as string;
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name] ?? '';
    if (name in builtins) return builtins[name as BuiltinVariable];
    return '';
  });
}

/** Frontmatter we read from a template file (all optional). */
interface TemplateFrontmatter {
  title?: string;
  description?: string;
}

/** Parse a raw template markdown file into a {@link Template}. */
export function parseTemplate(id: string, raw: string): Template {
  const parsed = matter(raw);
  const fm = parsed.data as TemplateFrontmatter;
  const body = parsed.content.replace(/^\n+/, '');
  return {
    id,
    title: typeof fm.title === 'string' && fm.title.trim() ? fm.title : titleFromId(id),
    ...(typeof fm.description === 'string' && fm.description.trim()
      ? { description: fm.description }
      : {}),
    variables: extractVariables(body),
    body,
  };
}

/** Serialize a template (frontmatter + body) back to markdown for disk. */
export function serializeTemplate(tpl: Pick<Template, 'title' | 'description' | 'body'>): string {
  const data: TemplateFrontmatter = {
    title: tpl.title,
    ...(tpl.description ? { description: tpl.description } : {}),
  };
  return matter.stringify(`\n${tpl.body.trim()}\n`, data);
}

/** Humanize a kebab id into a fallback title, e.g. `meeting-notes` → `Meeting Notes`. */
function titleFromId(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** A starter template seeded on demand into a fresh vault. */
export interface StarterTemplate {
  id: string;
  title: string;
  description: string;
  body: string;
}

/**
 * The five starter templates seeded into `templates/` on demand. Each is a real
 * markdown structure using `{{placeholders}}` (built-ins + a few custom vars).
 * Seeding never overwrites a file the user has since edited.
 */
export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    id: 'meeting-notes',
    title: 'Meeting Notes',
    description: 'Agenda, attendees, decisions, and action items for a meeting.',
    body: `# {{title}}

**Date:** {{date}}
**Attendees:** {{attendees}}
**Note-taker:** {{author}}

## Agenda

-

## Discussion

-

## Decisions

-

## Action Items

- [ ] Owner — task — due date
`,
  },
  {
    id: 'prd',
    title: 'PRD (Product Requirements)',
    description: 'Problem, goals, requirements, and success metrics for a product.',
    body: `# {{title}}

**Author:** {{author}}
**Last updated:** {{date}}
**Status:** Draft

## Problem

What problem are we solving, and for whom?

## Goals

-

## Non-Goals

-

## Requirements

| # | Requirement | Priority |
|---|-------------|----------|
| 1 |             | P0       |

## Success Metrics

-

## Open Questions

-
`,
  },
  {
    id: 'runbook',
    title: 'Runbook',
    description: 'Operational steps for running, monitoring, and recovering a service.',
    body: `# {{title}} Runbook

**Service:** {{service}}
**Owner:** {{author}}
**Last reviewed:** {{date}}

## Overview

What this service does and where it runs.

## Prerequisites

- Access / credentials required:
- Tools:

## Routine Operations

1.

## Monitoring & Alerts

- Dashboards:
- Key alerts and what they mean:

## Incident Response

1. Identify the symptom.
2. Mitigate.
3. Verify recovery.

## Rollback

Steps to safely roll back a change.

## Escalation

Who to page and when.
`,
  },
  {
    id: 'adr',
    title: 'ADR (Architecture Decision Record)',
    description: 'Context, decision, and consequences for an architectural choice.',
    body: `# {{title}}

**Status:** Proposed
**Date:** {{date}}
**Deciders:** {{author}}

## Context

What is the issue motivating this decision, and what constraints apply?

## Decision

What is the change we are proposing and/or doing?

## Alternatives Considered

-

## Consequences

### Positive

-

### Negative

-
`,
  },
  {
    id: 'spec',
    title: 'Spec (Technical Specification)',
    description: 'Detailed technical design: approach, API, data model, and risks.',
    body: `# {{title}}

**Author:** {{author}}
**Last updated:** {{date}}
**Status:** Draft

## Summary

One-paragraph overview of what is being built.

## Background

Context and prior art.

## Goals

-

## Proposed Design

Describe the approach, components, and how they fit together.

## API / Interface

\`\`\`
\`\`\`

## Data Model

Describe entities, fields, and relationships.

## Rollout Plan

How this ships safely (flags, phases, migration).

## Risks & Mitigations

-

## Alternatives

-
`,
  },
];

/**
 * Filesystem layer over the vault's `templates/` directory: list/read/save
 * template files, and seed the starter set on demand. All ids are validated with
 * `assertSafeSegment` and resolved through `vault.abs()`, so a caller-supplied id
 * can never traverse out of `templates/`.
 */
export class TemplateStore {
  constructor(private readonly vault: Vault) {}

  /** Vault-relative path for a template id (with traversal guard). */
  private relPath(id: string): string {
    assertSafeSegment(id, 'template id');
    return `templates/${id}.md`;
  }

  /** List every template (metadata, no body) in `templates/`, sorted by id. */
  async list(): Promise<TemplateMeta[]> {
    let entries;
    try {
      entries = await readdir(this.vault.templatesDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const metas: TemplateMeta[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const id = entry.name.slice(0, -'.md'.length);
      // Skip anything whose stem isn't a safe id rather than throwing on a list.
      let safe = true;
      try {
        assertSafeSegment(id, 'template id');
      } catch {
        safe = false;
      }
      if (!safe) continue;
      try {
        const tpl = await this.read(id);
        const { body: _body, ...meta } = tpl;
        metas.push(meta);
      } catch {
        /* skip unreadable/malformed template file */
      }
    }
    return metas.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Read a single template (with body) by id. Throws if it does not exist. */
  async read(id: string): Promise<Template> {
    const absPath = this.vault.abs(this.relPath(id));
    const raw = await readFile(absPath, 'utf8');
    return parseTemplate(id, raw);
  }

  /** Whether a template file exists for `id`. */
  async has(id: string): Promise<boolean> {
    return existsSync(this.vault.abs(this.relPath(id)));
  }

  /**
   * Persist a template to `templates/<id>.md`. The id is derived from the given
   * name (slugified) unless `id` is supplied. Returns the saved template meta.
   */
  async save(input: {
    name: string;
    body: string;
    id?: string;
    description?: string;
  }): Promise<Template> {
    const id = assertSafeSegment(input.id ?? slugify(input.name), 'template id');
    const relPath = `templates/${id}.md`;
    const absPath = this.vault.abs(relPath);
    const tpl: Pick<Template, 'title' | 'description' | 'body'> = {
      title: input.name,
      ...(input.description ? { description: input.description } : {}),
      body: input.body,
    };
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, serializeTemplate(tpl), 'utf8');
    return { id, ...tpl, variables: extractVariables(input.body) };
  }

  /**
   * Write any starter template that is missing. Never overwrites an existing
   * file (so user edits survive). Returns the ids that were actually created.
   */
  async seedStarters(): Promise<string[]> {
    await mkdir(this.vault.templatesDir, { recursive: true });
    const created: string[] = [];
    for (const starter of STARTER_TEMPLATES) {
      if (await this.has(starter.id)) continue;
      await this.save({
        id: starter.id,
        name: starter.title,
        description: starter.description,
        body: starter.body,
      });
      created.push(starter.id);
    }
    return created;
  }
}
