import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocVault } from './docvault.js';
import {
  STARTER_TEMPLATES,
  extractVariables,
  parseTemplate,
  renderTemplate,
  serializeTemplate,
} from './template.js';

describe('extractVariables', () => {
  it('discovers placeholders in first-seen order, de-duplicated', () => {
    const body = 'Hi {{name}}, on {{date}} re {{name}} again. {{topic}}';
    expect(extractVariables(body)).toEqual(['name', 'date', 'topic']);
  });

  it('tolerates whitespace inside the braces', () => {
    expect(extractVariables('{{ title }} and {{author}}')).toEqual(['title', 'author']);
  });

  it('ignores non-placeholder braces and stray syntax', () => {
    expect(extractVariables('no vars here')).toEqual([]);
    expect(extractVariables('code {} and {{{}}} and { single }')).toEqual([]);
  });
});

describe('renderTemplate', () => {
  it('substitutes built-ins (title/date/author)', () => {
    const out = renderTemplate('# {{title}} by {{author}} on {{date}}', {
      title: 'Q3 Plan',
      author: 'Ada',
      date: '2026-01-02',
    });
    expect(out).toBe('# Q3 Plan by Ada on 2026-01-02');
  });

  it('defaults {{date}} to today (YYYY-MM-DD) when omitted', () => {
    const out = renderTemplate('d: {{date}}', { title: 'x' });
    expect(out).toMatch(/^d: \d{4}-\d{2}-\d{2}$/);
  });

  it('substitutes arbitrary custom vars', () => {
    const out = renderTemplate('Service {{service}} owned by {{author}}', {
      author: 'Ops',
      vars: { service: 'billing-api' },
    });
    expect(out).toBe('Service billing-api owned by Ops');
  });

  it('custom vars override built-ins of the same name', () => {
    const out = renderTemplate('{{date}}', { date: '2026-01-01', vars: { date: 'OVERRIDE' } });
    expect(out).toBe('OVERRIDE');
  });

  it('renders missing/unknown variables as blank (never leaves raw {{ }})', () => {
    const out = renderTemplate('a={{a}} b={{missing}} c={{author}}', { vars: { a: '1' } });
    expect(out).toBe('a=1 b= c=');
    expect(out).not.toContain('{{');
  });

  it('respects an explicitly-empty-string custom var', () => {
    expect(renderTemplate('[{{x}}]', { vars: { x: '' } })).toBe('[]');
  });
});

describe('parse/serialize round-trip', () => {
  it('parses frontmatter title/description and discovers body vars', () => {
    const raw = serializeTemplate({
      title: 'My Tpl',
      description: 'desc',
      body: '# {{title}}\n\nHi {{name}}',
    });
    const tpl = parseTemplate('my-tpl', raw);
    expect(tpl.title).toBe('My Tpl');
    expect(tpl.description).toBe('desc');
    expect(tpl.variables).toEqual(['title', 'name']);
    expect(tpl.body).toContain('Hi {{name}}');
  });

  it('falls back to a humanized title from the id', () => {
    const tpl = parseTemplate('meeting-notes', '# heading\nbody');
    expect(tpl.title).toBe('Meeting Notes');
  });
});

describe('starter templates', () => {
  it('has the five expected starters with unique ids and placeholders', () => {
    const ids = STARTER_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(['meeting-notes', 'prd', 'runbook', 'adr', 'spec']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of STARTER_TEMPLATES) {
      expect(extractVariables(t.body)).toContain('title');
      expect(t.body).toContain('{{date}}');
    }
  });
});

describe('DocVault templates', () => {
  let root: string;
  let dv: DocVault;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'docvault-tpl-'));
    dv = await DocVault.open(root);
  });

  afterEach(async () => {
    await dv.close();
    await rm(root, { recursive: true, force: true });
  });

  it('seeds the five starter templates and lists them with declared variables', async () => {
    const created = await dv.seedStarterTemplates();
    expect(created.sort()).toEqual(['adr', 'meeting-notes', 'prd', 'runbook', 'spec']);

    const list = await dv.listTemplates();
    expect(list.map((t) => t.id).sort()).toEqual(['adr', 'meeting-notes', 'prd', 'runbook', 'spec']);

    const meeting = list.find((t) => t.id === 'meeting-notes');
    expect(meeting?.title).toBe('Meeting Notes');
    expect(meeting?.variables).toContain('title');
    expect(meeting?.variables).toContain('attendees');
  });

  it('does not overwrite a user-edited template when seeding again', async () => {
    await dv.seedStarterTemplates();
    const tplPath = path.join(root, 'templates', 'prd.md');
    await writeFile(tplPath, '---\ntitle: My PRD\n---\n\n# {{title}} (custom)\n', 'utf8');

    const created = await dv.seedStarterTemplates();
    expect(created).not.toContain('prd');

    const after = await readFile(tplPath, 'utf8');
    expect(after).toContain('(custom)');
  });

  it('createDocFromTemplate renders placeholders, creates + indexes the doc', async () => {
    await dv.seedStarterTemplates();
    const doc = await dv.createDocFromTemplate('meeting-notes', {
      product: 'superchat',
      title: 'Weekly Sync',
      author: 'Rachit',
      date: '2026-06-08',
      vars: { attendees: 'Alice, Bob' },
      tags: ['meeting'],
    });

    expect(doc.relPath).toBe('docs/superchat/weekly-sync.md');
    expect(doc.frontmatter.title).toBe('Weekly Sync');
    expect(doc.content).toContain('# Weekly Sync');
    expect(doc.content).toContain('2026-06-08');
    expect(doc.content).toContain('Rachit');
    expect(doc.content).toContain('Alice, Bob');
    // No raw placeholders should survive into the rendered doc.
    expect(doc.content).not.toContain('{{');

    // It is indexed: findable via search and by id.
    const hits = dv.search({ query: 'attendees Alice' });
    expect(hits.some((h) => h.id === doc.frontmatter.id)).toBe(true);
    expect(dv.getMeta(doc.frontmatter.id)?.title).toBe('Weekly Sync');
  });

  it('leaves unfilled custom placeholders blank', async () => {
    await dv.seedStarterTemplates();
    const doc = await dv.createDocFromTemplate('runbook', {
      product: 'ops',
      title: 'Billing',
      // intentionally omit {{service}} and {{author}}
    });
    expect(doc.content).not.toContain('{{');
    expect(doc.content).toContain('# Billing Runbook');
  });

  it('throws on an unknown template id without creating a doc', async () => {
    await expect(
      dv.createDocFromTemplate('does-not-exist', { product: 'p', title: 'X' }),
    ).rejects.toThrow();
    expect(dv.listDocs({ product: 'p' })).toHaveLength(0);
  });

  it('rejects a path-traversal template id', async () => {
    await expect(dv.getTemplate('../secrets')).rejects.toThrow(/Invalid template id/);
  });

  it('saveAsTemplate round-trips a doc body into a reusable template', async () => {
    const doc = await dv.createDoc({
      product: 'superchat',
      title: 'Onboarding Guide',
      content: '# {{title}}\n\nWelcome {{name}} to the team on {{date}}.',
    });

    const saved = await dv.saveAsTemplate(doc.frontmatter.id, { name: 'Onboarding' });
    expect(saved.id).toBe('onboarding');
    expect(saved.variables).toEqual(['title', 'name', 'date']);

    // It now appears in listTemplates and can be re-instantiated.
    const list = await dv.listTemplates();
    expect(list.map((t) => t.id)).toContain('onboarding');

    const fromTpl = await dv.createDocFromTemplate('onboarding', {
      product: 'superchat',
      title: 'Welcome Bob',
      vars: { name: 'Bob' },
      date: '2026-06-08',
    });
    expect(fromTpl.content).toContain('Welcome Bob to the team on 2026-06-08.');
    expect(fromTpl.content).toContain('# Welcome Bob');
  });
});
