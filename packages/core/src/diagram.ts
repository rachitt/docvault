/**
 * Mermaid diagram support: a dependency-free structural validator and a curated
 * template registry, shared by the MCP server and the desktop app.
 *
 * The MCP sidecar is headless (no DOM), so it cannot run `mermaid.render()` to
 * truly validate a diagram. This module provides a lightweight, deterministic
 * lint that catches the realistic failure classes (empty body, unrecognized
 * diagram type, unbalanced brackets/quotes) as a pre-save guardrail. The actual
 * render in the desktop app — where a DOM exists — remains the authoritative
 * validator.
 *
 * Pure module: no fs, no DOM, no other core imports. Keep it that way so it is
 * trivially unit-testable and importable from both the renderer and the server.
 */

export type DiagramType =
  | 'flowchart'
  | 'sequence'
  | 'class'
  | 'state'
  | 'er'
  | 'journey'
  | 'gantt'
  | 'pie'
  | 'mindmap'
  | 'timeline'
  | 'gitGraph'
  | 'c4'
  | 'quadrant'
  | 'unknown';

export interface DiagramIssue {
  severity: 'error' | 'warning';
  message: string;
  /** 1-based line of the source where the issue was located, when known. */
  line?: number;
}

export interface ValidateResult {
  /** False iff there is at least one `error`-severity issue. */
  ok: boolean;
  type: DiagramType;
  issues: DiagramIssue[];
}

export interface DiagramTemplate {
  /** Stable kebab id, e.g. `flowchart-basic`. */
  id: string;
  label: string;
  description: string;
  type: DiagramType;
  /** Canonical, well-styled Mermaid source (no surrounding fences). */
  source: string;
}

/**
 * Maps the leading keyword of a diagram to its type. Order matters only for
 * readability; matching is by the longest/most-specific prefix below.
 */
const TYPE_KEYWORDS: { prefix: string; type: DiagramType }[] = [
  { prefix: 'flowchart', type: 'flowchart' },
  { prefix: 'graph', type: 'flowchart' },
  { prefix: 'sequencediagram', type: 'sequence' },
  { prefix: 'classdiagram', type: 'class' },
  { prefix: 'statediagram-v2', type: 'state' },
  { prefix: 'statediagram', type: 'state' },
  { prefix: 'erdiagram', type: 'er' },
  { prefix: 'journey', type: 'journey' },
  { prefix: 'gantt', type: 'gantt' },
  { prefix: 'pie', type: 'pie' },
  { prefix: 'mindmap', type: 'mindmap' },
  { prefix: 'timeline', type: 'timeline' },
  { prefix: 'gitgraph', type: 'gitGraph' },
  { prefix: 'c4context', type: 'c4' },
  { prefix: 'c4container', type: 'c4' },
  { prefix: 'c4component', type: 'c4' },
  { prefix: 'quadrantchart', type: 'quadrant' },
];

/**
 * Strip Mermaid comments and `%%{ init }%%` directives from a single line so
 * they never affect type detection or bracket balancing.
 */
function stripDirectivesAndComments(line: string): string {
  // `%%{ ... }%%` init directive (may appear inline), then `%%` line comments.
  return line.replace(/%%\{[^]*?\}%%/g, '').replace(/%%.*$/, '');
}

/** The meaningful (non-empty, non-frontmatter, non-comment) lines of a diagram. */
function meaningfulLines(code: string): { text: string; line: number }[] {
  const raw = code.split('\n');
  const out: { text: string; line: number }[] = [];
  let inFrontmatter = false;
  for (let i = 0; i < raw.length; i++) {
    const original = raw[i] ?? '';
    const trimmed = original.trim();
    // YAML frontmatter fence (`---` … `---`) may precede the diagram body.
    if (trimmed === '---') {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;
    const stripped = stripDirectivesAndComments(original).trim();
    if (stripped.length === 0) continue;
    out.push({ text: stripped, line: i + 1 });
  }
  return out;
}

/**
 * Detect the diagram type from its first meaningful line. Handles the
 * `graph`/`flowchart` alias, leading `%%{init}%%` directives, and `---` YAML
 * frontmatter. Returns `'unknown'` when nothing matches.
 */
export function detectDiagramType(code: string): DiagramType {
  const first = meaningfulLines(code)[0];
  if (!first) return 'unknown';
  const head = first.text.toLowerCase().replace(/\s+/g, '');
  for (const { prefix, type } of TYPE_KEYWORDS) {
    if (head.startsWith(prefix)) return type;
  }
  return 'unknown';
}

const ALL_PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
// ER diagrams use `{`/`}` in crow's-foot cardinality (e.g. `||--o{`), so braces
// are not reliable brackets there — balance only `()` and `[]` for that type.
const NO_BRACE_PAIRS: Record<string, string> = { '(': ')', '[': ']' };

/**
 * Check that brackets and double quotes balance across the diagram, ignoring
 * anything inside `"…"` string labels (so `A["foo (bar)"]` is fine). Returns the
 * first imbalance as an issue, or null when balanced. `pairs` selects which
 * bracket kinds to enforce.
 */
function checkBalance(
  lines: { text: string; line: number }[],
  pairs: Record<string, string>,
): DiagramIssue | null {
  const closers = new Set(Object.values(pairs));
  const stack: { ch: string; line: number }[] = [];
  let inString = false;
  let stringLine = 0;
  for (const { text, line } of lines) {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i] as string;
      if (ch === '"') {
        if (!inString) stringLine = line;
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (pairs[ch]) {
        stack.push({ ch, line });
      } else if (closers.has(ch)) {
        const top = stack.pop();
        if (!top || pairs[top.ch] !== ch) {
          return { severity: 'error', message: `Unbalanced "${ch}"`, line };
        }
      }
    }
  }
  if (inString) {
    return { severity: 'error', message: 'Unterminated string label (")', line: stringLine };
  }
  if (stack.length > 0) {
    const top = stack[stack.length - 1] as { ch: string; line: number };
    return { severity: 'error', message: `Unclosed "${top.ch}"`, line: top.line };
  }
  return null;
}

/**
 * Per-type sanity checks that are conservative enough to stay `warning`-level —
 * they hint at likely-incomplete diagrams without ever rejecting valid syntax.
 */
function typeWarnings(type: DiagramType, lines: { text: string; line: number }[]): DiagramIssue[] {
  const body = lines.slice(1).map((l) => l.text).join('\n');
  const warn = (message: string): DiagramIssue => ({ severity: 'warning', message });
  switch (type) {
    case 'flowchart':
      return /-{2,3}>|--[-x]|-\.->|={1,2}=?>|~~~/.test(body)
        ? []
        : [warn('Flowchart has no edges (e.g. `A --> B`) — it will render as loose nodes.')];
    case 'sequence':
      return /--?>>?|--?\)/.test(body)
        ? []
        : [warn('Sequence diagram has no messages (e.g. `A->>B: hi`).')];
    case 'pie':
      return /["'][^"']+["']\s*:\s*\d/.test(body)
        ? []
        : [warn('Pie chart has no `"label" : value` slices.')];
    case 'mindmap':
      return lines.length > 1 ? [] : [warn('Mindmap has only a root node.')];
    default:
      return [];
  }
}

/**
 * Lightweight structural lint of Mermaid source. Errors: empty body,
 * unrecognized diagram type, unbalanced brackets/quotes. Warnings: per-type
 * sanity hints. `ok` is false only when an error is present.
 */
export function validateMermaid(code: string): ValidateResult {
  const lines = meaningfulLines(code);
  if (lines.length === 0) {
    return { ok: false, type: 'unknown', issues: [{ severity: 'error', message: 'Diagram is empty.' }] };
  }
  const type = detectDiagramType(code);
  const issues: DiagramIssue[] = [];
  if (type === 'unknown') {
    issues.push({
      severity: 'error',
      message: `Unrecognized diagram type "${lines[0]!.text.split(/\s/)[0]}". Start with a type keyword like flowchart, sequenceDiagram, classDiagram, mindmap, etc.`,
      line: lines[0]!.line,
    });
  }
  const balance = checkBalance(lines, type === 'er' ? NO_BRACE_PAIRS : ALL_PAIRS);
  if (balance) issues.push(balance);
  if (type !== 'unknown') issues.push(...typeWarnings(type, lines));
  return { ok: !issues.some((i) => i.severity === 'error'), type, issues };
}

/** Wrap Mermaid source in a canonical ```mermaid fenced code block. */
export function serializeMermaidFence(code: string): string {
  return '```mermaid\n' + code.replace(/\n+$/, '') + '\n```';
}

/**
 * Curated, theme-neutral diagram templates. No baked-in `%%{init theme}%%` so
 * the rendering surface controls light/dark theming. Weighted toward flowchart
 * and mindmap (concept) diagrams, the most common use cases.
 */
export const DIAGRAM_TEMPLATES: readonly DiagramTemplate[] = [
  {
    id: 'flowchart-basic',
    label: 'Flowchart',
    description: 'Two connected steps to start a workflow.',
    type: 'flowchart',
    source: `flowchart TD
%% dv-pos: A 80 80
%% dv-pos: B 300 80
  A[Start] --> B[Next step]`,
  },
  {
    id: 'flowchart-decision',
    label: 'Flowchart with decision',
    description: 'Branching flow with a yes/no decision node.',
    type: 'flowchart',
    source: `flowchart TD
%% dv-pos: A 300 40
%% dv-pos: B 310 150
%% dv-pos: C 210 310
%% dv-pos: D 420 310
  A[Start] --> B{Decision?}
  B -->|Yes| C[Yes]
  B -->|No| D[No]`,
  },
  {
    id: 'mindmap-concept',
    label: 'Mindmap (concept map)',
    description: 'Simple concept map radiating from a central idea.',
    type: 'mindmap',
    source: `mindmap
  root((Central idea))
    Branch A
    Branch B
    Branch C`,
  },
  {
    id: 'sequence-basic',
    label: 'Sequence diagram',
    description: 'Interaction over time between participants.',
    type: 'sequence',
    source: `sequenceDiagram
  participant U as User
  participant S as Service
  U->>S: Request
  S-->>U: Response`,
  },
  {
    id: 'class-basic',
    label: 'Class diagram',
    description: 'Classes with fields, methods, and relationships.',
    type: 'class',
    source: `classDiagram
  class Animal {
    +String name
    +eat()
  }
  class Dog {
    +bark()
  }
  Animal <|-- Dog`,
  },
  {
    id: 'state-basic',
    label: 'State diagram',
    description: 'States and transitions of a process or entity.',
    type: 'state',
    source: `stateDiagram-v2
  [*] --> Idle
  Idle --> Running: start
  Running --> Idle: stop
  Running --> [*]: finish`,
  },
  {
    id: 'er-basic',
    label: 'Entity-relationship diagram',
    description: 'Entities and their relationships for a data model.',
    type: 'er',
    source: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  CUSTOMER {
    string name
    string email
  }`,
  },
  {
    id: 'timeline-basic',
    label: 'Timeline',
    description: 'Chronological sequence of events by period.',
    type: 'timeline',
    source: `timeline
  title Project timeline
  2024 : Kickoff : Research
  2025 : Build : Launch
  2026 : Scale`,
  },
  {
    id: 'gantt-basic',
    label: 'Gantt chart',
    description: 'Project schedule with tasks and durations.',
    type: 'gantt',
    source: `gantt
  title Project plan
  dateFormat YYYY-MM-DD
  section Phase 1
    Research      :a1, 2025-01-01, 14d
    Design        :a2, after a1, 10d
  section Phase 2
    Build         :a3, after a2, 21d`,
  },
  {
    id: 'c4-context',
    label: 'C4 context diagram',
    description: 'System context: actors and systems at a high level.',
    type: 'c4',
    source: `C4Context
  title System context
  Person(user, "User", "Uses the product")
  System(app, "App", "The system being described")
  System_Ext(ext, "External service", "A third-party dependency")
  Rel(user, app, "Uses")
  Rel(app, ext, "Calls")`,
  },
  {
    id: 'pie-basic',
    label: 'Pie chart',
    description: 'Proportional breakdown of a whole.',
    type: 'pie',
    source: `pie title Breakdown
  "Category A" : 45
  "Category B" : 30
  "Category C" : 25`,
  },
];

/** List all diagram templates (metadata + source). */
export function listDiagramTemplates(): DiagramTemplate[] {
  return [...DIAGRAM_TEMPLATES];
}

/** Look up a single template by id, or null if there is no such template. */
export function getDiagramTemplate(id: string): DiagramTemplate | null {
  return DIAGRAM_TEMPLATES.find((t) => t.id === id) ?? null;
}
