import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { Callout } from './Callout';
import { Mermaid } from './Mermaid';

/**
 * BlockNote schema extended with DocVault's custom blocks. The built-in
 * `codeBlock` (language label + shiki highlighting) is kept from the defaults;
 * `callout` and `mermaid` are added on top. Markdown round-tripping for the two
 * custom blocks is handled by ./transform (BlockNote's own markdown export
 * cannot represent them).
 */
export const docVaultSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    callout: Callout,
    mermaid: Mermaid,
  },
});

export type DocVaultEditor = typeof docVaultSchema.BlockNoteEditor;
