import { createReactBlockSpec } from '@blocknote/react';
import { AlertTriangle, Info, Lightbulb } from 'lucide-react';
import type { CalloutType } from './markdown-blocks';

const STYLE: Record<
  CalloutType,
  { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; cls: string }
> = {
  info: { icon: Info, label: 'Info', cls: 'dv-callout-info' },
  principle: { icon: Lightbulb, label: 'Principle', cls: 'dv-callout-principle' },
  warning: { icon: AlertTriangle, label: 'Warning', cls: 'dv-callout-warning' },
};

const ORDER: CalloutType[] = ['info', 'principle', 'warning'];

/**
 * Colored callout block (info / principle / warning) with editable inline body.
 * Clicking the icon cycles the variant. Serialized to a `> [!TYPE]` blockquote
 * by the editor's markdown bridge so it round-trips through the on-disk file.
 */
export const Callout = createReactBlockSpec(
  {
    type: 'callout',
    content: 'inline',
    propSchema: {
      type: { default: 'info', values: ['info', 'principle', 'warning'] },
    },
  },
  {
    render: ({ block, editor, contentRef }) => {
      const type = (block.props.type as CalloutType) ?? 'info';
      const { icon: Icon, label, cls } = STYLE[type];
      const cycle = (): void => {
        const next = ORDER[(ORDER.indexOf(type) + 1) % ORDER.length] ?? 'info';
        editor.updateBlock(block, { props: { type: next } });
      };
      return (
        <div className={`dv-callout ${cls}`} data-callout-type={type}>
          <button
            type="button"
            className="dv-callout-icon"
            contentEditable={false}
            onClick={cycle}
            title={`${label} — click to change`}
          >
            <Icon size={18} />
          </button>
          <div className="dv-callout-body" ref={contentRef} />
        </div>
      );
    },
  },
);
