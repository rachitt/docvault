import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';
import { assertSafeSegment, parseDoc } from './doc.js';
import type { Doc, DocVersion, DocVersionActor, DocVersionReason } from './types.js';
import type { Vault } from './vault.js';

const nowIso = (): string => new Date().toISOString();

export interface CreateVersionInput {
  relPath: string;
  reason: DocVersionReason;
  actor?: DocVersionActor;
  manual?: boolean;
}

/** Full-document snapshot storage under .docvault/versions/<doc-id>/. */
export class VersionStore {
  constructor(private readonly vault: Vault) {}

  private docDir(docId: string): string {
    return path.join(this.vault.versionsDir, assertSafeSegment(docId, 'doc id'));
  }

  private manifestPath(docId: string): string {
    return path.join(this.docDir(docId), 'manifest.json');
  }

  private versionPath(docId: string, versionId: string): string {
    return path.join(
      this.docDir(docId),
      `${assertSafeSegment(versionId, 'version id')}.md`,
    );
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw, 'utf8').digest('hex');
  }

  private normalize(value: unknown): DocVersion[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (v): v is DocVersion =>
        !!v &&
        typeof v === 'object' &&
        typeof (v as DocVersion).id === 'string' &&
        typeof (v as DocVersion).docId === 'string' &&
        typeof (v as DocVersion).relPath === 'string' &&
        typeof (v as DocVersion).title === 'string' &&
        typeof (v as DocVersion).createdAt === 'string' &&
        typeof (v as DocVersion).reason === 'string' &&
        typeof (v as DocVersion).actor === 'string' &&
        typeof (v as DocVersion).contentHash === 'string' &&
        typeof (v as DocVersion).sizeBytes === 'number' &&
        typeof (v as DocVersion).manual === 'boolean',
    );
  }

  async list(docId: string): Promise<DocVersion[]> {
    assertSafeSegment(docId, 'doc id');
    const manifest = this.manifestPath(docId);
    try {
      const raw = await readFile(manifest, 'utf8');
      const versions = this.normalize(JSON.parse(raw));
      return versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return this.reconstruct(docId);
    }
  }

  async read(docId: string, versionId: string): Promise<Doc> {
    assertSafeSegment(docId, 'doc id');
    assertSafeSegment(versionId, 'version id');
    const absPath = this.versionPath(docId, versionId);
    const raw = await readFile(absPath, 'utf8');
    return parseDoc(raw, this.vault, absPath);
  }

  async create(input: CreateVersionInput): Promise<DocVersion | null> {
    const absPath = this.vault.abs(input.relPath);
    const raw = await readFile(absPath, 'utf8');
    const doc = parseDoc(raw, this.vault, absPath);
    const docId = assertSafeSegment(doc.frontmatter.id, 'doc id');
    const contentHash = this.hash(raw);
    const versions = await this.list(docId);
    const latest = versions[0];
    if (!input.manual && latest?.contentHash === contentHash) return null;

    const version: DocVersion = {
      id: ulid(),
      docId,
      relPath: doc.relPath,
      title: doc.frontmatter.title,
      createdAt: nowIso(),
      reason: input.reason,
      actor: input.actor ?? 'core',
      contentHash,
      sizeBytes: Buffer.byteLength(raw, 'utf8'),
      manual: input.manual ?? input.reason === 'manual',
    };

    await mkdir(this.docDir(docId), { recursive: true });
    await writeFile(this.versionPath(docId, version.id), raw, 'utf8');
    await this.writeManifest(docId, [version, ...versions]);
    return version;
  }

  async delete(docId: string, versionId: string): Promise<void> {
    const versions = await this.list(docId);
    await rm(this.versionPath(docId, versionId), { force: true });
    await this.writeManifest(
      docId,
      versions.filter((v) => v.id !== versionId),
    );
  }

  private async writeManifest(docId: string, versions: DocVersion[]): Promise<void> {
    await mkdir(this.docDir(docId), { recursive: true });
    const manifest = this.manifestPath(docId);
    const tmp = `${manifest}.${process.pid}.${ulid()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(versions, null, 2), 'utf8');
      await rename(tmp, manifest);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  private async reconstruct(docId: string): Promise<DocVersion[]> {
    assertSafeSegment(docId, 'doc id');
    let entries;
    try {
      entries = await readdir(this.docDir(docId), { withFileTypes: true });
    } catch {
      return [];
    }
    const versions: DocVersion[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const id = path.basename(entry.name, '.md');
      const absPath = this.versionPath(docId, id);
      if (!existsSync(absPath)) continue;
      try {
        const raw = await readFile(absPath, 'utf8');
        const doc = parseDoc(raw, this.vault, absPath);
        versions.push({
          id,
          docId,
          relPath: doc.relPath,
          title: doc.frontmatter.title,
          createdAt: doc.frontmatter.updated,
          reason: 'manual',
          actor: 'core',
          contentHash: this.hash(raw),
          sizeBytes: Buffer.byteLength(raw, 'utf8'),
          manual: true,
        });
      } catch {
        /* skip unreadable snapshot */
      }
    }
    const sorted = versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (sorted.length > 0) await this.writeManifest(docId, sorted);
    return sorted;
  }
}
