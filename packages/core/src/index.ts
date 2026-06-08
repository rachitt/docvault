export { DocVault } from './docvault.js';
export type { CreateDiagramInput, CreateDocFromTemplateInput, DocVaultOptions } from './docvault.js';
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
  TemplateStore,
  extractVariables,
  renderTemplate,
  parseTemplate,
  serializeTemplate,
  STARTER_TEMPLATES,
  BUILTIN_VARIABLES,
} from './template.js';
export type {
  Template,
  TemplateMeta,
  TemplateRenderContext,
  StarterTemplate,
  BuiltinVariable,
} from './template.js';
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
export {
  CALLOUT_TYPES,
  restoreWikilinks,
  serializeCallout,
  serializeMermaid,
  splitMarkdownSegments,
} from './markdown.js';
export type { CalloutType, Segment } from './markdown.js';
export { renderDocHtml, renderMarkdownToHtml, escapeHtml } from './export/html.js';
export type { RenderHtmlOptions, RenderedHtml } from './export/html.js';
export { importFile, isImportable } from './import/index.js';
export * from './types.js';
export type { CreateDocInput } from './doc.js';
export type { VaultChange } from './watcher.js';
export type { ImportResult, ImportableExt } from './import/index.js';
