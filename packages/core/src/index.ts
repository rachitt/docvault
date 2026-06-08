export { DocVault } from './docvault.js';
export type { CreateDiagramInput, DocVaultOptions } from './docvault.js';
export { chunkMarkdown } from './chunk.js';
export type { Chunk, ChunkOptions } from './chunk.js';
export {
  TransformersEmbedder,
  cosineSimilarity,
  vectorToBlob,
  blobToVector,
  EMBED_DIM,
  EMBED_MODEL,
} from './embed.js';
export type { Embedder } from './embed.js';
export {
  validateMermaid,
  detectDiagramType,
  serializeMermaidFence,
  listDiagramTemplates,
  getDiagramTemplate,
  DIAGRAM_TEMPLATES,
} from './diagram.js';
export type {
  DiagramType,
  DiagramIssue,
  ValidateResult,
  DiagramTemplate,
} from './diagram.js';
export { Vault } from './vault.js';
export { DocStore, assertSafeSegment, parseDoc, serializeDoc, slugify } from './doc.js';
export { Indexer, toFtsMatch } from './indexer.js';
export type { StoredChunk, SemanticHit, HybridHit } from './indexer.js';
export { VaultWatcher } from './watcher.js';
export { extractWikilinks } from './links.js';
export { importFile, isImportable } from './import/index.js';
export * from './types.js';
export type { CreateDocInput } from './doc.js';
export type { VaultChange } from './watcher.js';
export type { ImportResult, ImportableExt } from './import/index.js';
