import {
  restoreWikilinks,
  serializeCallout,
  serializeMermaid,
  splitMarkdownSegments,
  type CalloutType,
} from './markdown-blocks';
import type { DocVaultEditor } from './schema';

// Block array shapes derived straight from the schema-bound editor so we don't
// fight BlockNote's deeply-generic block union types.
type InsertBlocks = Parameters<DocVaultEditor['replaceBlocks']>[1];
type EditorBlock = DocVaultEditor['document'][number];

/** Flatten parsed body blocks into a single inline-content run for a callout. */
function inlineFromBlocks(blocks: EditorBlock[]): unknown[] {
  const out: unknown[] = [];
  blocks.forEach((b, i) => {
    if (i > 0) out.push({ type: 'text', text: '\n', styles: {} });
    const content = (b as { content?: unknown }).content;
    if (Array.isArray(content)) out.push(...content);
  });
  return out;
}

/**
 * Parse on-disk markdown into blocks, materializing callout / mermaid segments
 * as their custom blocks and handing everything else to BlockNote's parser.
 */
export async function markdownToBlocks(
  editor: DocVaultEditor,
  markdown: string,
): Promise<InsertBlocks> {
  const blocks: unknown[] = [];
  for (const seg of splitMarkdownSegments(markdown)) {
    if (seg.kind === 'markdown') {
      blocks.push(...(await editor.tryParseMarkdownToBlocks(seg.text)));
    } else if (seg.kind === 'mermaid') {
      blocks.push({ type: 'mermaid', props: { code: seg.code } });
    } else {
      const bodyBlocks = seg.body ? await editor.tryParseMarkdownToBlocks(seg.body) : [];
      blocks.push({
        type: 'callout',
        props: { type: seg.calloutType },
        content: inlineFromBlocks(bodyBlocks as EditorBlock[]),
      });
    }
  }
  return blocks as InsertBlocks;
}

/**
 * Serialize blocks back to markdown. Runs of standard blocks go through
 * BlockNote's lossy markdown exporter; callout / mermaid blocks are written with
 * their canonical markdown so they survive the round-trip.
 */
export async function blocksToMarkdown(
  editor: DocVaultEditor,
  blocks: EditorBlock[],
): Promise<string> {
  const parts: string[] = [];
  let run: EditorBlock[] = [];

  const flush = async (): Promise<void> => {
    if (run.length === 0) return;
    const md = (await editor.blocksToMarkdownLossy(run as InsertBlocks)).trim();
    if (md) parts.push(md);
    run = [];
  };

  for (const b of blocks) {
    if (b.type === 'mermaid') {
      await flush();
      parts.push(serializeMermaid(((b.props as { code?: string }).code ?? '').trim()));
    } else if (b.type === 'callout') {
      await flush();
      const type = ((b.props as { type?: CalloutType }).type ?? 'info') as CalloutType;
      const body = (
        await editor.blocksToMarkdownLossy([{ type: 'paragraph', content: b.content }] as InsertBlocks)
      ).trim();
      parts.push(serializeCallout(type, body));
    } else {
      run.push(b);
    }
  }
  await flush();

  return restoreWikilinks(parts.join('\n\n')) + '\n';
}
