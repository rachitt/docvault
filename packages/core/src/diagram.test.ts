import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DIAGRAM_TEMPLATES,
  detectDiagramType,
  getDiagramTemplate,
  listDiagramTemplates,
  serializeMermaidFence,
  validateMermaid,
} from './diagram.js';
import { DocVault } from './docvault.js';

describe('detectDiagramType', () => {
  it('maps each leading keyword to its type', () => {
    expect(detectDiagramType('flowchart TD\n A-->B')).toBe('flowchart');
    expect(detectDiagramType('graph LR\n A-->B')).toBe('flowchart'); // graph alias
    expect(detectDiagramType('sequenceDiagram\n A->>B: hi')).toBe('sequence');
    expect(detectDiagramType('classDiagram\n A <|-- B')).toBe('class');
    expect(detectDiagramType('stateDiagram-v2\n [*] --> A')).toBe('state');
    expect(detectDiagramType('erDiagram\n A ||--o{ B : has')).toBe('er');
    expect(detectDiagramType('mindmap\n root')).toBe('mindmap');
    expect(detectDiagramType('timeline\n title T')).toBe('timeline');
    expect(detectDiagramType('gantt\n title T')).toBe('gantt');
    expect(detectDiagramType('pie title T\n "A" : 1')).toBe('pie');
    expect(detectDiagramType('gitGraph\n commit')).toBe('gitGraph');
    expect(detectDiagramType('C4Context\n title T')).toBe('c4');
    expect(detectDiagramType('quadrantChart\n title T')).toBe('quadrant');
  });

  it('skips leading %%{init}%% directives and --- frontmatter', () => {
    expect(detectDiagramType("%%{init: {'theme':'dark'}}%%\nflowchart TD\n A-->B")).toBe('flowchart');
    expect(detectDiagramType('---\ntitle: My chart\n---\nsequenceDiagram\n A->>B: x')).toBe('sequence');
  });

  it('returns unknown for gibberish', () => {
    expect(detectDiagramType('not a real diagram')).toBe('unknown');
    expect(detectDiagramType('')).toBe('unknown');
  });
});

describe('validateMermaid', () => {
  it('flags empty diagrams as errors', () => {
    const r = validateMermaid('   \n  \n');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('flags an unrecognized diagram type as an error', () => {
    const r = validateMermaid('frobnicate TD\n A --> B');
    expect(r.ok).toBe(false);
    expect(r.type).toBe('unknown');
    expect(r.issues[0]?.severity).toBe('error');
  });

  it('detects unbalanced brackets with a line number', () => {
    const r = validateMermaid('flowchart TD\n  A[Start --> B[End]');
    expect(r.ok).toBe(false);
    const err = r.issues.find((i) => i.severity === 'error');
    expect(err).toBeDefined();
    expect(err?.line).toBe(2);
  });

  it('does NOT trip on brackets/parens inside string labels', () => {
    const r = validateMermaid('flowchart TD\n  A["foo (bar) [baz]"] --> B["end"]');
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.severity === 'error')).toBe(false);
  });

  it('does NOT trip on brackets inside %% comments', () => {
    const r = validateMermaid('flowchart TD\n  %% a stray ] bracket in a comment\n  A --> B');
    expect(r.ok).toBe(true);
  });

  it('flags an unterminated string label', () => {
    const r = validateMermaid('flowchart TD\n  A["never closed --> B');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('passes a valid flowchart with no error issues', () => {
    const r = validateMermaid('flowchart TD\n  A[Start] --> B[End]');
    expect(r.ok).toBe(true);
    expect(r.type).toBe('flowchart');
    expect(r.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('warns (but stays ok) on a flowchart with no edges', () => {
    const r = validateMermaid('flowchart TD\n  A[Lonely node]');
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.severity === 'warning')).toBe(true);
  });
});

describe('diagram templates', () => {
  it('exposes a non-empty registry with unique ids', () => {
    const all = listDiagramTemplates();
    expect(all.length).toBeGreaterThan(0);
    const ids = all.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('round-trips ids through getDiagramTemplate', () => {
    for (const t of DIAGRAM_TEMPLATES) {
      expect(getDiagramTemplate(t.id)).toEqual(t);
    }
    expect(getDiagramTemplate('does-not-exist')).toBeNull();
  });

  it('every template source passes validation with no errors', () => {
    for (const t of DIAGRAM_TEMPLATES) {
      const r = validateMermaid(t.source);
      const errors = r.issues.filter((i) => i.severity === 'error');
      expect(errors, `template ${t.id}: ${JSON.stringify(errors)}`).toHaveLength(0);
      expect(r.ok, `template ${t.id} not ok`).toBe(true);
    }
  });
});

describe('serializeMermaidFence', () => {
  it('wraps source in a mermaid fence and trims trailing newlines', () => {
    expect(serializeMermaidFence('flowchart TD\n A-->B\n\n')).toBe(
      '```mermaid\nflowchart TD\n A-->B\n```',
    );
  });
});

describe('DocVault.createDiagram', () => {
  let root: string;
  let dv: DocVault;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'docvault-diagram-'));
    dv = await DocVault.open(root);
  });

  afterEach(async () => {
    await dv.close();
    await rm(root, { recursive: true, force: true });
  });

  it('creates a new doc containing a mermaid fence', async () => {
    const doc = await dv.createDiagram({
      product: 'superchat',
      title: 'Login flow',
      code: 'flowchart TD\n  A[Start] --> B[End]',
      heading: 'Login flow',
    });
    expect(doc.relPath).toBe('docs/superchat/login-flow.md');
    expect(doc.content).toContain('## Login flow');
    expect(doc.content).toContain('```mermaid');
    expect(doc.content).toContain('A[Start] --> B[End]');
  });

  it('resolves source from a template id', async () => {
    const doc = await dv.createDiagram({
      product: 'superchat',
      title: 'Concept map',
      templateId: 'mindmap-concept',
    });
    expect(doc.content).toContain('mindmap');
    expect(doc.content).toContain('```mermaid');
  });

  it('appends a diagram to an existing doc', async () => {
    const base = await dv.createDoc({
      product: 'superchat',
      title: 'Overview',
      content: '# Overview\n\nIntro text.',
    });
    const updated = await dv.createDiagram({
      path: base.relPath,
      code: 'flowchart LR\n  A --> B',
    });
    expect(updated.content).toContain('Intro text.');
    expect(updated.content).toContain('```mermaid');
    expect(updated.content.indexOf('Intro text.')).toBeLessThan(updated.content.indexOf('```mermaid'));
  });

  it('throws on invalid mermaid before writing anything', async () => {
    await expect(
      dv.createDiagram({ product: 'superchat', title: 'Broken', code: 'flowchart TD\n A[unclosed' }),
    ).rejects.toThrow(/Invalid Mermaid/);
    expect(dv.listDocs({ product: 'superchat' })).toHaveLength(0);
  });
});
