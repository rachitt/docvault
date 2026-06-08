import { useEffect, useMemo, useRef, useState } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import DOMPurify from 'dompurify';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Diamond,
  GripVertical,
  Link2,
  Pencil,
  Plus,
  Square,
  Workflow,
} from 'lucide-react';
import mermaid from 'mermaid';

let initializedTheme: 'light' | 'dark' | 'desk' | null = null;
let counter = 0;

type FlowNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  shape: 'rect' | 'decision' | 'round';
};

type FlowEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
};

type FlowchartModel = {
  direction: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
};

type FlowNodeShape = FlowNode['shape'];

type DragState = {
  nodeId: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  model: FlowchartModel;
};

const NODE_W = 132;
const NODE_H = 54;
const DECISION_SIZE = 112;
const POS_RE = /^%%\s*dv-pos:\s*([A-Za-z][\w-]*)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/;
const NODE_RE = /([A-Za-z][\w-]*)(?:\[(.*?)\]|\{(.*?)\}|\((.*?)\))?/g;
const EDGE_RE =
  /^\s*([A-Za-z][\w-]*)(?:\[(?:.*?)\]|\{(?:.*?)\}|\((?:.*?)\))?\s*--(?:(?:\|([^|]+)\|>)|(?:>\s*\|([^|]+)\|)|>)\s*([A-Za-z][\w-]*)(?:\[(?:.*?)\]|\{(?:.*?)\}|\((?:.*?)\))?/;

function escapeLabel(label: string): string {
  return label.replace(/]/g, ')').replace(/}/g, ')').replace(/\n/g, ' ').trim() || 'Step';
}

function nodeSyntax(node: FlowNode): string {
  const label = escapeLabel(node.label);
  if (node.shape === 'decision') return `${node.id}{${label}}`;
  if (node.shape === 'round') return `${node.id}(${label})`;
  return `${node.id}[${label}]`;
}

function sizeForShape(shape: FlowNodeShape): { width: number; height: number } {
  if (shape === 'decision') return { width: DECISION_SIZE, height: DECISION_SIZE };
  return { width: NODE_W, height: NODE_H };
}

function nodeSize(node: FlowNode): { width: number; height: number } {
  return sizeForShape(node.shape);
}

function edgePath(from: FlowNode, to: FlowNode): { d: string; labelX: number; labelY: number } {
  const fromSize = nodeSize(from);
  const toSize = nodeSize(to);
  const fromCenterX = from.x + fromSize.width / 2;
  const fromCenterY = from.y + fromSize.height / 2;
  const toCenterX = to.x + toSize.width / 2;
  const toCenterY = to.y + toSize.height / 2;
  const isVertical = Math.abs(toCenterY - fromCenterY) > Math.abs(toCenterX - fromCenterX);

  if (isVertical) {
    const x1 = fromCenterX;
    const y1 = toCenterY >= fromCenterY ? from.y + fromSize.height : from.y;
    const x2 = toCenterX;
    const y2 = toCenterY >= fromCenterY ? to.y : to.y + toSize.height;
    const midY = (y1 + y2) / 2;
    return {
      d: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`,
      labelX: (x1 + x2) / 2,
      labelY: midY - 8,
    };
  }

  const x1 = toCenterX >= fromCenterX ? from.x + fromSize.width : from.x;
  const y1 = fromCenterY;
  const x2 = toCenterX >= fromCenterX ? to.x : to.x + toSize.width;
  const y2 = toCenterY;
  const midX = (x1 + x2) / 2;
  return {
    d: `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
    labelX: midX,
    labelY: (y1 + y2) / 2 - 8,
  };
}

function parseFlowchart(code: string): FlowchartModel | null {
  const lines = code.split('\n');
  const head = lines.find((line) => line.trim() && !line.trim().startsWith('%%'))?.trim();
  const match = /^(?:flowchart|graph)\s+([A-Z]{2})/i.exec(head ?? '');
  if (!match) return null;

  const positions = new Map<string, { x: number; y: number }>();
  const nodes = new Map<string, Omit<FlowNode, 'x' | 'y'>>();
  const edges: FlowEdge[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(?:flowchart|graph)\s+[A-Z]{2}/i.test(trimmed)) continue;

    const pos = POS_RE.exec(trimmed);
    if (pos) {
      positions.set(pos[1] as string, { x: Number(pos[2]), y: Number(pos[3]) });
      continue;
    }

    const edge = EDGE_RE.exec(line);
    if (edge) {
      const from = edge[1] as string;
      const to = edge[4] as string;
      const label = (edge[2] ?? edge[3])?.trim();
      edges.push({ id: `${from}-${to}-${edges.length}`, from, to, ...(label ? { label } : {}) });
    }

    const nodeSource = line.replace(/--(?:\|[^|]*\|>|>\s*\|[^|]*\|)/g, '-->');
    NODE_RE.lastIndex = 0;
    for (const node of nodeSource.matchAll(NODE_RE)) {
      const id = node[1];
      if (!id || /^(flowchart|graph)$/i.test(id)) continue;
      const label = node[2] ?? node[3] ?? node[4] ?? id;
      const shape = node[3] ? 'decision' : node[4] ? 'round' : 'rect';
      if (!nodes.has(id)) nodes.set(id, { id, label, shape });
    }
  }

  const laidOut = [...nodes.values()].map((node, i): FlowNode => {
    const pos = positions.get(node.id);
    return {
      ...node,
      x: pos?.x ?? 60 + (i % 3) * 185,
      y: pos?.y ?? 70 + Math.floor(i / 3) * 120,
    };
  });

  return {
    direction: match[1] ?? 'TD',
    nodes: laidOut,
    edges,
  };
}

function serializeFlowchart(model: FlowchartModel): string {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const lines = [`flowchart ${model.direction}`];
  for (const node of model.nodes) lines.push(`%% dv-pos: ${node.id} ${Math.round(node.x)} ${Math.round(node.y)}`);
  for (const edge of model.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const label = edge.label ? `|${edge.label}|` : '';
    lines.push(`  ${nodeSyntax(from)} -->${label} ${nodeSyntax(to)}`);
  }
  if (model.edges.length === 0) {
    for (const node of model.nodes) lines.push(`  ${nodeSyntax(node)}`);
  }
  return lines.join('\n');
}

function nextNodeId(nodes: FlowNode[]): string {
  const used = new Set(nodes.map((node) => node.id));
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(65 + i);
    if (!used.has(id)) return id;
  }
  let i = nodes.length + 1;
  while (used.has(`N${i}`)) i++;
  return `N${i}`;
}

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
  // Stable id per component instance. (useId() is unsuitable: its ':' chars are
  // invalid in the DOM id / selector mermaid derives from this value.) Lazy-init
  // so the module counter advances once per instance, not on every render.
  const idRef = useRef('');
  if (!idRef.current) idRef.current = `dv-mermaid-${counter++}`;

  useEffect(() => {
    let cancelled = false;
    if (!code.trim()) {
      setSvg('');
      setError(null);
      return;
    }
    // Drop any prior error so a now-valid diagram doesn't keep showing it.
    setError(null);
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

function FlowchartVisualEditor({
  code,
  onChange,
}: {
  code: string;
  onChange: (next: string) => void;
}): React.JSX.Element | null {
  const model = useMemo(() => parseFlowchart(code), [code]);
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState<DragState | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [addMenuFor, setAddMenuFor] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollNode = useRef<string | null>(null);

  useEffect(() => {
    if (model && selectedEdge && !model.edges.some((edge) => edge.id === selectedEdge)) {
      setSelectedEdge(null);
    }
  }, [model, selectedEdge]);

  useEffect(() => {
    const nodeId = pendingScrollNode.current;
    if (!model || !nodeId) return;
    const node = model.nodes.find((item) => item.id === nodeId);
    const canvas = canvasRef.current;
    if (!node || !canvas) return;
    pendingScrollNode.current = null;
    requestAnimationFrame(() => {
      canvas.scrollTo({
        left: Math.max(0, node.x - 80),
        top: Math.max(0, node.y - 60),
        behavior: 'smooth',
      });
    });
  }, [model]);

  if (!model) return null;

  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const supportsDecisionNodes = model.nodes.some((node) => node.shape === 'decision');
  const width = Math.max(720, ...model.nodes.map((node) => node.x + nodeSize(node).width + 360));
  const height = Math.max(260, ...model.nodes.map((node) => node.y + nodeSize(node).height + 80));
  const scrollCanvas = (direction: -1 | 1): void => {
    canvasRef.current?.scrollBy({ left: direction * 280, behavior: 'smooth' });
  };

  const commitLabel = (nodeId: string, label: string): void => {
    const next = {
      ...model,
      nodes: model.nodes.map((node) => (node.id === nodeId ? { ...node, label: escapeLabel(label) } : node)),
    };
    onChange(serializeFlowchart(next));
    setEditingNode(null);
  };

  const moveNode = (clientX: number, clientY: number): void => {
    if (!drag) return;
    const dx = clientX - drag.startX;
    const dy = clientY - drag.startY;
    const next = {
      ...drag.model,
      nodes: drag.model.nodes.map((node) =>
        node.id === drag.nodeId
          ? {
              ...node,
              x: Math.max(16, drag.originX + dx),
              y: Math.max(16, drag.originY + dy),
            }
          : node,
      ),
    };
    onChange(serializeFlowchart(next));
  };

  const addNextStep = (from: FlowNode, shape: FlowNodeShape): void => {
    const id = nextNodeId(model.nodes);
    const outgoing = model.edges.filter((edge) => edge.from === from.id).length;
    const fromSize = nodeSize(from);
    const newSize = sizeForShape(shape);
    const verticalOffset = supportsDecisionNodes ? from.y + fromSize.height + 104 : from.y;
    const horizontalBranchOffset =
      from.shape === 'decision' && supportsDecisionNodes ? (outgoing % 2 === 0 ? -110 - outgoing * 12 : 110 + outgoing * 12) : 0;
    const newNode: FlowNode = {
      id,
      label: shape === 'decision' ? 'Decision?' : 'Next step',
      x: supportsDecisionNodes
        ? Math.max(16, from.x + fromSize.width / 2 - newSize.width / 2 + horizontalBranchOffset)
        : from.x + fromSize.width + 96,
      y: Math.max(16, verticalOffset),
      shape,
    };
    const next = {
      ...model,
      nodes: [...model.nodes, newNode],
      edges: [...model.edges, { id: `${from.id}-${id}-${model.edges.length}`, from: from.id, to: id }],
    };
    setAddMenuFor(null);
    pendingScrollNode.current = id;
    onChange(serializeFlowchart(next));
  };

  const connectToExistingNode = (targetId: string): void => {
    if (!connectFrom || connectFrom === targetId) return;
    const edgeExists = model.edges.some((edge) => edge.from === connectFrom && edge.to === targetId);
    setConnectFrom(null);
    if (edgeExists) return;
    const next = {
      ...model,
      edges: [...model.edges, { id: `${connectFrom}-${targetId}-${model.edges.length}`, from: connectFrom, to: targetId }],
    };
    onChange(serializeFlowchart(next));
  };

  const deleteSelectedEdge = (): void => {
    if (!selectedEdge) return;
    const edgeToDelete = model.edges.find((edge) => edge.id === selectedEdge);
    if (!edgeToDelete) {
      setSelectedEdge(null);
      return;
    }
    const remainingEdges = model.edges.filter((edge) => edge.id !== selectedEdge);
    const targetStillConnected = remainingEdges.some((edge) => edge.to === edgeToDelete.to);
    const removeNodeId = targetStillConnected ? null : edgeToDelete.to;
    const next = {
      ...model,
      nodes: removeNodeId ? model.nodes.filter((node) => node.id !== removeNodeId) : model.nodes,
      edges: removeNodeId
        ? remainingEdges.filter((edge) => edge.from !== removeNodeId && edge.to !== removeNodeId)
        : remainingEdges,
    };
    setSelectedEdge(null);
    onChange(serializeFlowchart(next));
  };

  const toggleAddMenu = (nodeId: string): void => {
    setEditingNode(null);
    setSelectedEdge(null);
    setConnectFrom(null);
    setAddMenuFor((current) => (current === nodeId ? null : nodeId));
  };

  return (
    <div
      ref={canvasRef}
      className={`dv-flow-editor${supportsDecisionNodes ? ' dv-flow-editor--vertical' : ''}`}
      tabIndex={0}
      onPointerMove={(e) => moveNode(e.clientX, e.clientY)}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (connectFrom && e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setConnectFrom(null);
        }
        if (selectedEdge && (e.key === 'Delete' || e.key === 'Backspace')) {
          e.preventDefault();
          e.stopPropagation();
          deleteSelectedEdge();
        }
      }}
    >
      <div className="dv-flow-scroll-controls">
        <button type="button" title="Scroll left" onClick={() => scrollCanvas(-1)}>
          <ChevronLeft size={15} />
        </button>
        <button type="button" title="Scroll right" onClick={() => scrollCanvas(1)}>
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="dv-flow-canvas" style={{ width, height }}>
        <svg className="dv-flow-edges" width={width} height={height} aria-hidden="true">
          <defs>
            <marker id="dv-flow-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" />
            </marker>
          </defs>
          {model.edges.map((edge) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) return null;
            const path = edgePath(from, to);
            return (
              <g key={edge.id}>
                <path
                  className={`dv-flow-edge${selectedEdge === edge.id ? ' dv-flow-edge--selected' : ''}`}
                  d={path.d}
                  markerEnd="url(#dv-flow-arrow)"
                />
                <path
                  className="dv-flow-edge-hit"
                  d={path.d}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedEdge(edge.id);
                    canvasRef.current?.focus();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedEdge(edge.id);
                    canvasRef.current?.focus();
                  }}
                />
                {edge.label ? (
                  <text className="dv-flow-edge-label" x={path.labelX} y={path.labelY} textAnchor="middle">
                    {edge.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {model.nodes.map((node) => {
          const size = nodeSize(node);
          return (
            <div
              key={node.id}
              className={`dv-flow-node dv-flow-node--${node.shape}${
                connectFrom === node.id ? ' dv-flow-node--connecting' : ''
              }${connectFrom && connectFrom !== node.id ? ' dv-flow-node--targetable' : ''}`}
              style={{ left: node.x, top: node.y, width: size.width, minHeight: size.height }}
            >
            <button
              type="button"
              className="dv-flow-drag-handle"
              title="Drag node"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                setEditingNode(null);
                setDrag({
                  nodeId: node.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  originX: node.x,
                  originY: node.y,
                  model,
                });
              }}
            >
              <GripVertical size={13} />
            </button>
            <button
              type="button"
              className="dv-flow-connect-node"
              title="Connect to existing node"
              onClick={(e) => {
                e.stopPropagation();
                setEditingNode(null);
                setSelectedEdge(null);
                setConnectFrom(connectFrom === node.id ? null : node.id);
                canvasRef.current?.focus();
              }}
            >
              <Link2 size={12} />
            </button>
            <button
              type="button"
              className="dv-flow-add-node"
              title="Add next step"
              aria-expanded={addMenuFor === node.id}
              onClick={(e) => {
                e.stopPropagation();
                if (!supportsDecisionNodes) {
                  addNextStep(node, 'rect');
                  return;
                }
                toggleAddMenu(node.id);
              }}
            >
              <Plus size={13} />
            </button>
            {addMenuFor === node.id ? (
              <div className="dv-flow-add-menu" role="menu" aria-label="Add flowchart node">
                <button type="button" role="menuitem" onClick={() => addNextStep(node, 'rect')}>
                  <Square size={13} /> Node
                </button>
                {supportsDecisionNodes ? (
                  <button type="button" role="menuitem" onClick={() => addNextStep(node, 'decision')}>
                    <Diamond size={13} /> Decision
                  </button>
                ) : null}
              </div>
            ) : null}
            {editingNode === node.id ? (
              <input
                className="dv-flow-node-input"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitLabel(node.id, draft)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitLabel(node.id, draft);
                  if (e.key === 'Escape') setEditingNode(null);
                }}
              />
            ) : (
              <button
                type="button"
                className="dv-flow-node-label"
                title={connectFrom && connectFrom !== node.id ? 'Connect here' : 'Rename node'}
                onClick={(e) => {
                  if (connectFrom && connectFrom !== node.id) {
                    e.stopPropagation();
                    connectToExistingNode(node.id);
                    return;
                  }
                  if (connectFrom === node.id) {
                    e.stopPropagation();
                    setConnectFrom(null);
                    return;
                  }
                  setDraft(node.label);
                  setEditingNode(node.id);
                }}
              >
                {node.label}
              </button>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
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
      const supportsVisualFlowchart = parseFlowchart(code) !== null;

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
            <>
              {supportsVisualFlowchart ? (
                <FlowchartVisualEditor
                  code={code}
                  onChange={(next) => editor.updateBlock(block, { props: { code: next } })}
                />
              ) : (
                <MermaidView code={code} />
              )}
            </>
          )}
        </div>
      );
    },
  },
);
