import { useEffect, useRef, useState } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import DOMPurify from 'dompurify';
import { Check, Pencil, Workflow } from 'lucide-react';
import mermaid from 'mermaid';

let initializedTheme: 'light' | 'dark' | 'desk' | null = null;
let counter = 0;

/**
 * Brand-purple Mermaid theme (distinct from the blue UI accent) so diagrams read
 * as their own kind of object. Applied at render time — never written into the
 * stored markdown — so agent-authored ```mermaid blocks stay clean and pick up
 * the theme automatically. Mirrors --dv-diagram-accent in index.css. Covers the
 * common flowchart + sequence variables.
 */
const LIGHT_VARS = {
  primaryColor: '#ede9fe',
  primaryBorderColor: '#7c3aed',
  primaryTextColor: '#312e81',
  nodeTextColor: '#312e81',
  lineColor: '#8b5cf6',
  secondaryColor: '#f5f3ff',
  tertiaryColor: '#faf5ff',
  actorBkg: '#ede9fe',
  actorBorder: '#7c3aed',
  actorTextColor: '#312e81',
  signalColor: '#6d28d9',
  signalTextColor: '#312e81',
  labelBoxBkgColor: '#ede9fe',
  labelBoxBorderColor: '#7c3aed',
  labelTextColor: '#312e81',
  loopTextColor: '#312e81',
  noteBkgColor: '#fef9c3',
  noteBorderColor: '#eab308',
  noteTextColor: '#422006',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  fontSize: '14px',
} as const;

/**
 * Desk theme: quiet, sepia-toned diagrams that sit naturally on the parchment —
 * warm near-white nodes, thin muted borders, gray-brown connectors. No purple,
 * so the diagram reads like an inked figure on the page rather than a UI object.
 */
const DESK_VARS = {
  primaryColor: '#fbf6e8',
  primaryBorderColor: '#ab9a78',
  primaryTextColor: '#3a3024',
  nodeTextColor: '#3a3024',
  lineColor: '#9a8a6a',
  secondaryColor: '#f3ead3',
  tertiaryColor: '#efe6cd',
  actorBkg: '#fbf6e8',
  actorBorder: '#ab9a78',
  actorTextColor: '#3a3024',
  signalColor: '#8a7a5c',
  signalTextColor: '#3a3024',
  labelBoxBkgColor: '#f3ead3',
  labelBoxBorderColor: '#ab9a78',
  labelTextColor: '#3a3024',
  loopTextColor: '#3a3024',
  noteBkgColor: '#f4e27e',
  noteBorderColor: '#caa85e',
  noteTextColor: '#5a4a18',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  fontSize: '14px',
} as const;

const DARK_VARS = {
  darkMode: true,
  background: '#1b1b1d',
  primaryColor: '#3b2f63',
  primaryBorderColor: '#a78bfa',
  primaryTextColor: '#ede9fe',
  nodeTextColor: '#ede9fe',
  lineColor: '#a78bfa',
  secondaryColor: '#2a2440',
  tertiaryColor: '#241f38',
  actorBkg: '#3b2f63',
  actorBorder: '#a78bfa',
  actorTextColor: '#ede9fe',
  signalColor: '#c4b5fd',
  signalTextColor: '#ede9fe',
  labelBoxBkgColor: '#3b2f63',
  labelBoxBorderColor: '#a78bfa',
  labelTextColor: '#ede9fe',
  loopTextColor: '#ede9fe',
  noteBkgColor: '#3f3b1a',
  noteBorderColor: '#a3812b',
  noteTextColor: '#fef9c3',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  fontSize: '14px',
} as const;

function ensureInit(): void {
  const cls = document.documentElement.classList;
  // The desk skin wins over light/dark when present (it forces its own palette).
  const mode = cls.contains('desk') ? 'desk' : cls.contains('dark') ? 'dark' : 'light';
  // Re-initialize when the app theme flips so diagrams re-render in the right palette.
  if (initializedTheme === mode) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    // Render labels as SVG <text>, not HTML in <foreignObject>. We sanitize the
    // SVG with DOMPurify's svg-only profile before injecting it, which strips
    // foreignObject HTML — so html labels would render as empty (invisible) text.
    // SVG text survives the sanitizer and keeps the security posture intact.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    themeVariables: mode === 'desk' ? DESK_VARS : mode === 'dark' ? DARK_VARS : LIGHT_VARS,
  });
  initializedTheme = mode;
}

function MermaidView({ code }: { code: string }): React.JSX.Element {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`dv-mermaid-${counter++}`);

  useEffect(() => {
    let cancelled = false;
    if (!code.trim()) {
      setSvg('');
      setError(null);
      return;
    }
    ensureInit();
    mermaid
      .render(idRef.current, code)
      .then(({ svg }) => {
        if (!cancelled) {
          // Mermaid runs in securityLevel:'strict', but the diagram source comes
          // from vault content an agent/import can author — sanitize the SVG once
          // more before it ever reaches dangerouslySetInnerHTML.
          setSvg(DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } }));
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (!code.trim()) {
    return <p className="dv-mermaid-empty">Empty diagram — click Edit to add Mermaid source.</p>;
  }
  if (error) {
    return (
      <div className="dv-mermaid-error">
        <p className="dv-mermaid-error-title">Diagram error</p>
        <pre>{error}</pre>
      </div>
    );
  }
  return <div className="dv-mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * Mermaid diagram block. Renders the diagram from its `code` prop and lets the
 * user edit the source inline. Serialized to a ```mermaid fenced code block by
 * the editor's markdown bridge, so the diagram stays plain text on disk.
 */
export const Mermaid = createReactBlockSpec(
  {
    type: 'mermaid',
    content: 'none',
    propSchema: {
      code: { default: '' },
    },
  },
  {
    render: ({ block, editor }) => {
      const code = (block.props.code as string) ?? '';
      // eslint-disable-next-line react-hooks/rules-of-hooks -- render is a stable FC
      const [editing, setEditing] = useState(code.trim().length === 0);
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const [draft, setDraft] = useState(code);

      return (
        <div className="dv-mermaid" contentEditable={false}>
          <div className="dv-mermaid-toolbar">
            <span className="dv-mermaid-label">
              <Workflow size={13} /> Mermaid
            </span>
            {editing ? (
              <button
                type="button"
                onClick={() => {
                  editor.updateBlock(block, { props: { code: draft } });
                  setEditing(false);
                }}
                title="Done"
              >
                <Check size={14} /> Done
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraft(code);
                  setEditing(true);
                }}
                title="Edit source"
              >
                <Pencil size={14} /> Edit
              </button>
            )}
          </div>
          {editing ? (
            <textarea
              className="dv-mermaid-source"
              value={draft}
              spellCheck={false}
              autoFocus
              placeholder={'graph TD;\n  A[Start] --> B[End];'}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => editor.updateBlock(block, { props: { code: draft } })}
            />
          ) : (
            <MermaidView code={code} />
          )}
        </div>
      );
    },
  },
);
