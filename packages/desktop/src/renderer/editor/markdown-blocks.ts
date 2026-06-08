/**
 * Markdown ⇄ custom-block bridge.
 *
 * The canonical split/serialize helpers now live in `@docvault/core` so the
 * editor and the exporter agree on exactly what a callout / mermaid block looks
 * like on disk. This module just re-exports them for the editor's local imports.
 */
export {
  CALLOUT_TYPES,
  restoreWikilinks,
  serializeCallout,
  serializeMermaid,
  splitMarkdownSegments,
} from '@docvault/core/markdown';
export type { CalloutType, Segment } from '@docvault/core/markdown';
