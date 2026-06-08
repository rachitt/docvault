import { useEffect, useMemo, useRef, useState } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import DOMPurify from 'dompurify';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Diamond,
  GripVertical,
  Link2,
  Pencil,
  Plus,
  Square,
  UserPlus,
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

type MindmapNode = {
  id: string;
  label: string;
  parentId: string | null;
  depth: number;
  x: number;
  y: number;
  color: string;
};

type MindmapModel = {
  nodes: MindmapNode[];
};

type MindmapDragState = {
  nodeId: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  model: MindmapModel;
};

type SequenceParticipant = {
  id: string;
  label: string;
  x: number;
  y: number;
  lifelineLength: number;
  color: string;
};

type SequenceMessage = {
  from: string;
  to: string;
  label: string;
  arrow: string;
};

type SequenceModel = {
  participants: SequenceParticipant[];
  messages: SequenceMessage[];
};

type SequenceDragState = {
  participantId: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  model: SequenceModel;
};

type SequenceLifelineDragState = {
  participantId: string;
  startY: number;
  originLength: number;
  model: SequenceModel;
};

const NODE_W = 132;
const NODE_H = 54;
const DECISION_SIZE = 112;
const POS_RE = /^%%\s*dv-pos:\s*([A-Za-z][\w-]*)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/;
const NODE_RE = /([A-Za-z][\w-]*)(?:\[(.*?)\]|\{(.*?)\}|\((.*?)\))?/g;
const EDGE_RE =
  /^\s*([A-Za-z][\w-]*)(?:\[(?:.*?)\]|\{(?:.*?)\}|\((?:.*?)\))?\s*--(?:(?:\|([^|]+)\|>)|(?:>\s*\|([^|]+)\|)|>)\s*([A-Za-z][\w-]*)(?:\[(?:.*?)\]|\{(?:.*?)\}|\((?:.*?)\))?/;
const MINDMAP_POS_RE = /^%%\s*dv-mm-pos:\s*(m\d+)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/;
const MINDMAP_COLOR_RE = /^%%\s*dv-mm-color:\s*(m\d+)\s+(#[0-9a-fA-F]{6})\s*$/;
const MINDMAP_COLORS = ['#0ea5d7', '#087fb1', '#ffffff', '#f3f4f6', '#fff1d8', '#f5e9ff'] as const;
const SEQUENCE_POS_RE = /^%%\s*dv-seq-pos:\s*([A-Za-z][\w-]*)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/;
const SEQUENCE_COLOR_RE = /^%%\s*dv-seq-color:\s*([A-Za-z][\w-]*)\s+(#[0-9a-fA-F]{6})\s*$/;
const SEQUENCE_LINE_RE = /^%%\s*dv-seq-line:\s*([A-Za-z][\w-]*)\s+(\d+(?:\.\d+)?)\s*$/;
const SEQUENCE_PARTICIPANT_RE = /^\s*(?:participant|actor)\s+([A-Za-z][\w-]*)(?:\s+as\s+(.+?))?\s*;?\s*$/i;
const SEQUENCE_MESSAGE_RE = /^\s*([A-Za-z][\w-]*)\s*([-.=]*[<>x]?[-.=>]+[<>x]?)\s*([A-Za-z][\w-]*)\s*:\s*(.*?)\s*;?\s*$/;
const SEQUENCE_COLORS = ['#fbf6e8', '#f3ead3', '#ffffff', '#e8f4ff', '#eef8df', '#f5e9ff'] as const;

// A flowchart line the visual editor can fully round-trip: a single node, or a
// single `A --> B` / `A -->|label| B` edge (with our supported shapes). Anything
// richer (subgraphs, classDef/style, alt arrows like `-.->`/`==>`, chained edges,
// exotic node shapes) deliberately fails these so we fall back to read-only
// rendering instead of silently rewriting — and discarding — the user's source.
const FLOW_NODE_TOKEN = String.raw`[A-Za-z][\w-]*(?:\[[^\]]*\]|\{[^}]*\}|\([^)]*\))?`;
const FLOW_EDGE_LINE = new RegExp(`^${FLOW_NODE_TOKEN}\\s*-->(?:\\|[^|]*\\|)?\\s*${FLOW_NODE_TOKEN}\\s*;?$`);
const FLOW_NODE_LINE = new RegExp(`^${FLOW_NODE_TOKEN}\\s*;?$`);

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

// True only when every meaningful line is something the visual editor can
// serialize back without loss. Guards against the visual editor clobbering rich
// flowcharts (subgraphs, styling, alternate arrows/shapes) the model can't hold.
function flowchartFullyRepresentable(code: string): boolean {
  let sawHeader = false;
  for (const raw of code.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^(?:flowchart|graph)\s+[A-Za-z]{2}\s*;?$/i.test(line)) {
      sawHeader = true;
      continue;
    }
    if (!FLOW_EDGE_LINE.test(line) && !FLOW_NODE_LINE.test(line)) return false;
  }
  return sawHeader;
}

function cleanMindmapLabel(raw: string): string {
  return raw
    .trim()
    .replace(/^([A-Za-z][\w-]*)\(\((.*)\)\)$/, '$2')
    .replace(/^\(\((.*)\)\)$/, '$1')
    .replace(/^\((.*)\)$/, '$1')
    .trim();
}

function escapeMindmapLabel(label: string): string {
  return label.replace(/\n/g, ' ').trim() || 'Idea';
}

function mindmapNodeSize(node: Pick<MindmapNode, 'depth'>): number {
  if (node.depth === 0) return 118;
  if (node.depth === 1) return 82;
  return 62;
}

function defaultMindmapColor(depth: number): string {
  if (depth === 0) return MINDMAP_COLORS[0];
  if (depth === 1) return MINDMAP_COLORS[1];
  return MINDMAP_COLORS[2];
}

function layoutMindmapNodes(nodes: MindmapNode[], positions: Map<string, { x: number; y: number }>): MindmapNode[] {
  const root = nodes.find((node) => node.depth === 0);
  if (!root) return nodes;

  const childrenByParent = new Map<string, MindmapNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }

  const rootSize = mindmapNodeSize(root);
  const centerX = 330;
  const centerY = 230;
  const firstLevel = childrenByParent.get(root.id) ?? [];
  const firstCount = Math.max(1, firstLevel.length);
  const firstRadiusX = 220;
  const firstRadiusY = 145;
  const laidOut = nodes.map((node) => ({ ...node }));
  const byId = new Map(laidOut.map((node) => [node.id, node]));

  const rootNode = byId.get(root.id);
  if (rootNode && !positions.has(rootNode.id)) {
    rootNode.x = centerX - rootSize / 2;
    rootNode.y = centerY - rootSize / 2;
  }

  firstLevel.forEach((node, i) => {
    const current = byId.get(node.id);
    if (!current || positions.has(current.id)) return;
    const angle = -Math.PI / 2 + (i / firstCount) * Math.PI * 2;
    const size = mindmapNodeSize(current);
    current.x = centerX + Math.cos(angle) * firstRadiusX - size / 2;
    current.y = centerY + Math.sin(angle) * firstRadiusY - size / 2;
  });

  for (const parent of firstLevel) {
    const parentNode = byId.get(parent.id);
    const children = childrenByParent.get(parent.id) ?? [];
    if (!parentNode || children.length === 0) continue;
    const parentSize = mindmapNodeSize(parentNode);
    const parentCenterX = parentNode.x + parentSize / 2;
    const parentCenterY = parentNode.y + parentSize / 2;
    const angleFromRoot = Math.atan2(parentCenterY - centerY, parentCenterX - centerX);
    const spread = Math.min(Math.PI * 0.75, Math.PI * 0.28 * Math.max(1, children.length - 1));
    children.forEach((child, childIndex) => {
      const current = byId.get(child.id);
      if (!current || positions.has(current.id)) return;
      const childSize = mindmapNodeSize(current);
      const childAngle = angleFromRoot - spread / 2 + (children.length === 1 ? spread / 2 : (childIndex / (children.length - 1)) * spread);
      current.x = parentCenterX + Math.cos(childAngle) * 105 - childSize / 2;
      current.y = parentCenterY + Math.sin(childAngle) * 92 - childSize / 2;
    });
  }

  return laidOut.map((node) => {
    const pos = positions.get(node.id);
    return pos ? { ...node, x: pos.x, y: pos.y } : node;
  });
}

function orderedMindmapNodes(nodes: MindmapNode[]): MindmapNode[] {
  const childrenByParent = new Map<string | null, MindmapNode[]>();
  for (const node of nodes) {
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }

  const ordered: MindmapNode[] = [];
  const visit = (node: MindmapNode): void => {
    ordered.push(node);
    for (const child of childrenByParent.get(node.id) ?? []) visit(child);
  };

  for (const root of childrenByParent.get(null) ?? []) visit(root);
  return ordered;
}

function parseMindmap(code: string): MindmapModel | null {
  const lines = code.split('\n');
  const head = lines.find((line) => line.trim() && !line.trim().startsWith('%%'))?.trim();
  if (!/^mindmap\b/i.test(head ?? '')) return null;

  const positions = new Map<string, { x: number; y: number }>();
  const colors = new Map<string, string>();
  for (const line of lines) {
    const pos = MINDMAP_POS_RE.exec(line.trim());
    if (pos) positions.set(pos[1] as string, { x: Number(pos[2]), y: Number(pos[3]) });
    const color = MINDMAP_COLOR_RE.exec(line.trim());
    if (color) colors.set(color[1] as string, color[2] as string);
  }

  const nodes: MindmapNode[] = [];
  const parentByDepth = new Map<number, string>();
  let index = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%') || /^mindmap\b/i.test(trimmed)) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const depth = Math.max(0, Math.round(indent / 2) - 1);
    const id = `m${index++}`;
    const parentId = depth === 0 ? null : parentByDepth.get(depth - 1) ?? null;
    const pos = positions.get(id);
    nodes.push({
      id,
      label: cleanMindmapLabel(trimmed),
      parentId,
      depth,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      color: colors.get(id) ?? defaultMindmapColor(depth),
    });
    parentByDepth.set(depth, id);
  }

  return nodes.length ? { nodes: layoutMindmapNodes(nodes, positions) } : null;
}

// The mindmap model is plain text + hierarchy, so `::icon(...)` and `:::class`
// markers can't be round-tripped. Fall back to read-only rendering rather than
// dropping them when the user next edits.
function mindmapFullyRepresentable(code: string): boolean {
  for (const raw of code.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%%') || /^mindmap\b/i.test(line)) continue;
    if (line.includes('::')) return false;
  }
  return true;
}

function serializeMindmap(model: MindmapModel): string {
  const nodes = orderedMindmapNodes(model.nodes);
  const lines = ['mindmap'];
  for (const [i, node] of nodes.entries()) {
    lines.push(`%% dv-mm-pos: m${i} ${Math.round(node.x)} ${Math.round(node.y)}`);
  }
  for (const [i, node] of nodes.entries()) {
    if (node.color !== defaultMindmapColor(node.depth)) lines.push(`%% dv-mm-color: m${i} ${node.color}`);
  }
  for (const node of nodes) {
    const indent = '  '.repeat(node.depth + 1);
    const label = escapeMindmapLabel(node.label);
    lines.push(node.depth === 0 ? `${indent}root((${label}))` : `${indent}${label}`);
  }
  return lines.join('\n');
}

function serializeFlowchart(model: FlowchartModel): string {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const lines = [`flowchart ${model.direction}`];
  for (const node of model.nodes) lines.push(`%% dv-pos: ${node.id} ${Math.round(node.x)} ${Math.round(node.y)}`);
  const referenced = new Set<string>();
  for (const edge of model.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const label = edge.label ? `|${edge.label}|` : '';
    lines.push(`  ${nodeSyntax(from)} -->${label} ${nodeSyntax(to)}`);
    referenced.add(from.id);
    referenced.add(to.id);
  }
  // Emit any node not touched by an edge so isolated nodes survive the round-trip.
  for (const node of model.nodes) {
    if (!referenced.has(node.id)) lines.push(`  ${nodeSyntax(node)}`);
  }
  return lines.join('\n');
}

function cleanSequenceLabel(label: string): string {
  return label.replace(/\n/g, ' ').trim() || 'Participant';
}

function escapeSequenceMessage(label: string): string {
  return label.replace(/\n/g, ' ').trim() || 'Message';
}

function defaultSequenceColor(index: number): string {
  return index % 2 === 0 ? SEQUENCE_COLORS[0] : SEQUENCE_COLORS[1];
}

function defaultSequenceLifelineLength(messageCount: number): number {
  return Math.max(220, 120 + messageCount * 62);
}

function parseSequence(code: string): SequenceModel | null {
  const lines = code.split('\n');
  const head = lines.find((line) => line.trim() && !line.trim().startsWith('%%'))?.trim();
  if (!/^sequenceDiagram\b/i.test(head ?? '')) return null;

  const positions = new Map<string, { x: number; y: number }>();
  const colors = new Map<string, string>();
  const lifelineLengths = new Map<string, number>();
  for (const line of lines) {
    const trimmed = line.trim();
    const pos = SEQUENCE_POS_RE.exec(trimmed);
    if (pos) positions.set(pos[1] as string, { x: Number(pos[2]), y: Number(pos[3]) });
    const color = SEQUENCE_COLOR_RE.exec(trimmed);
    if (color) colors.set(color[1] as string, color[2] as string);
    const lifeline = SEQUENCE_LINE_RE.exec(trimmed);
    if (lifeline) lifelineLengths.set(lifeline[1] as string, Number(lifeline[2]));
  }

  const participants = new Map<string, Omit<SequenceParticipant, 'x' | 'y' | 'color'>>();
  const messages: SequenceMessage[] = [];

  const ensureParticipant = (id: string): void => {
    if (!participants.has(id)) participants.set(id, { id, label: id });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%') || /^sequenceDiagram\b/i.test(trimmed)) continue;

    const participant = SEQUENCE_PARTICIPANT_RE.exec(line);
    if (participant) {
      const id = participant[1] as string;
      participants.set(id, { id, label: cleanSequenceLabel(participant[2] ?? id) });
      continue;
    }

    const message = SEQUENCE_MESSAGE_RE.exec(line);
    if (message) {
      const from = message[1] as string;
      const arrow = message[2] as string;
      const to = message[3] as string;
      ensureParticipant(from);
      ensureParticipant(to);
      messages.push({ from, to, arrow, label: escapeSequenceMessage(message[4] ?? '') });
      continue;
    }

    return null;
  }

  const laidOut = [...participants.values()].map((participant, i): SequenceParticipant => {
    const pos = positions.get(participant.id);
    return {
      ...participant,
      x: pos?.x ?? 120 + i * 190,
      y: pos?.y ?? 52,
      lifelineLength: lifelineLengths.get(participant.id) ?? defaultSequenceLifelineLength(messages.length),
      color: colors.get(participant.id) ?? defaultSequenceColor(i),
    };
  });

  return laidOut.length ? { participants: laidOut, messages } : null;
}

function sequenceFullyRepresentable(code: string): boolean {
  let sawHeader = false;
  for (const raw of code.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^sequenceDiagram\b/i.test(line)) {
      sawHeader = true;
      continue;
    }
    if (SEQUENCE_PARTICIPANT_RE.test(line) || SEQUENCE_MESSAGE_RE.test(line)) continue;
    return false;
  }
  return sawHeader;
}

function serializeSequence(model: SequenceModel): string {
  const lines = ['sequenceDiagram'];
  for (const participant of model.participants) {
    lines.push(`%% dv-seq-pos: ${participant.id} ${Math.round(participant.x)} ${Math.round(participant.y)}`);
    lines.push(`%% dv-seq-line: ${participant.id} ${Math.round(participant.lifelineLength)}`);
  }
  model.participants.forEach((participant, i) => {
    if (participant.color !== defaultSequenceColor(i)) lines.push(`%% dv-seq-color: ${participant.id} ${participant.color}`);
  });
  for (const participant of model.participants) {
    lines.push(`  participant ${participant.id} as ${cleanSequenceLabel(participant.label)}`);
  }
  for (const message of model.messages) {
    lines.push(`  ${message.from}${message.arrow}${message.to}: ${escapeSequenceMessage(message.label)}`);
  }
  return lines.join('\n');
}

function nextSequenceParticipantId(participants: SequenceParticipant[]): string {
  const used = new Set(participants.map((participant) => participant.id));
  for (let i = 0; i < 26; i++) {
    const id = `P${i + 1}`;
    if (!used.has(id)) return id;
  }
  let i = participants.length + 1;
  while (used.has(`P${i}`)) i++;
  return `P${i}`;
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

function MindmapVisualEditor({
  code,
  onChange,
}: {
  code: string;
  onChange: (next: string) => void;
}): React.JSX.Element | null {
  const model = useMemo(() => parseMindmap(code), [code]);
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState<MindmapDragState | null>(null);
  const [colorNode, setColorNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (model && selectedEdge && !model.nodes.some((node) => node.id === selectedEdge && node.parentId)) {
      setSelectedEdge(null);
    }
  }, [model, selectedEdge]);

  if (!model) return null;

  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const width = Math.max(720, ...model.nodes.map((node) => node.x + mindmapNodeSize(node) + 150));
  const height = Math.max(480, ...model.nodes.map((node) => node.y + mindmapNodeSize(node) + 130));
  const scrollCanvas = (dx: number, dy: number): void => {
    canvasRef.current?.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
  };

  const commitLabel = (nodeId: string, label: string): void => {
    const next = {
      nodes: model.nodes.map((node) =>
        node.id === nodeId ? { ...node, label: escapeMindmapLabel(label) } : node,
      ),
    };
    onChange(serializeMindmap(next));
    setEditingNode(null);
  };

  const moveNode = (clientX: number, clientY: number): void => {
    if (!drag) return;
    const dx = clientX - drag.startX;
    const dy = clientY - drag.startY;
    const next = {
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
    onChange(serializeMindmap(next));
  };

  const setNodeColor = (nodeId: string, color: string): void => {
    const next = {
      nodes: model.nodes.map((node) => (node.id === nodeId ? { ...node, color } : node)),
    };
    onChange(serializeMindmap(next));
    setColorNode(null);
  };

  const addChildNode = (parent: MindmapNode): void => {
    const childCount = model.nodes.filter((node) => node.parentId === parent.id).length;
    const size = mindmapNodeSize({ depth: parent.depth + 1 });
    const parentSize = mindmapNodeSize(parent);
    const angle = childCount === 0 ? Math.PI / 2 : Math.PI / 2 + (childCount % 2 === 0 ? -1 : 1) * Math.ceil(childCount / 2) * 0.55;
    const distance = parent.depth === 0 ? 150 : 115;
    const parentCenterX = parent.x + parentSize / 2;
    const parentCenterY = parent.y + parentSize / 2;
    const newNode: MindmapNode = {
      id: `m${model.nodes.length}`,
      label: 'New idea',
      parentId: parent.id,
      depth: parent.depth + 1,
      x: Math.max(16, parentCenterX + Math.cos(angle) * distance - size / 2),
      y: Math.max(16, parentCenterY + Math.sin(angle) * distance - size / 2),
      color: defaultMindmapColor(parent.depth + 1),
    };
    onChange(serializeMindmap({ nodes: [...model.nodes, newNode] }));
  };

  const deleteSelectedEdge = (): void => {
    if (!selectedEdge) return;
    const removeIds = new Set<string>();
    const collect = (nodeId: string): void => {
      removeIds.add(nodeId);
      for (const child of model.nodes.filter((node) => node.parentId === nodeId)) collect(child.id);
    };
    collect(selectedEdge);
    setSelectedEdge(null);
    setColorNode(null);
    setEditingNode(null);
    onChange(serializeMindmap({ nodes: model.nodes.filter((node) => !removeIds.has(node.id)) }));
  };

  return (
    <div
      ref={canvasRef}
      className="dv-mindmap-editor"
      tabIndex={0}
      onPointerMove={(e) => moveNode(e.clientX, e.clientY)}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (selectedEdge && (e.key === 'Delete' || e.key === 'Backspace')) {
          e.preventDefault();
          e.stopPropagation();
          deleteSelectedEdge();
        }
      }}
    >
      <div className="dv-mindmap-scroll-controls" aria-label="Scroll mindmap">
        <button type="button" title="Scroll up" onClick={() => scrollCanvas(0, -220)}>
          <ChevronUp size={15} />
        </button>
        <button type="button" title="Scroll left" onClick={() => scrollCanvas(-260, 0)}>
          <ChevronLeft size={15} />
        </button>
        <button type="button" title="Scroll right" onClick={() => scrollCanvas(260, 0)}>
          <ChevronRight size={15} />
        </button>
        <button type="button" title="Scroll down" onClick={() => scrollCanvas(0, 220)}>
          <ChevronDown size={15} />
        </button>
      </div>
      <div className="dv-mindmap-canvas" style={{ width, height }}>
        <svg className="dv-mindmap-edges" width={width} height={height} aria-hidden="true">
          {model.nodes.map((node) => {
            if (!node.parentId) return null;
            const parent = nodeById.get(node.parentId);
            if (!parent) return null;
            const parentSize = mindmapNodeSize(parent);
            const nodeSize = mindmapNodeSize(node);
            const x1 = parent.x + parentSize / 2;
            const y1 = parent.y + parentSize / 2;
            const x2 = node.x + nodeSize / 2;
            const y2 = node.y + nodeSize / 2;
            const path = `M ${x1} ${y1} L ${x2} ${y2}`;
            return (
              <g key={`${node.parentId}-${node.id}`}>
                <path
                  className={`dv-mindmap-edge${selectedEdge === node.id ? ' dv-mindmap-edge--selected' : ''}`}
                  d={path}
                />
                <path
                  className="dv-mindmap-edge-hit"
                  d={path}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedEdge(node.id);
                    setColorNode(null);
                    setEditingNode(null);
                    canvasRef.current?.focus();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedEdge(node.id);
                    setColorNode(null);
                    setEditingNode(null);
                    canvasRef.current?.focus();
                  }}
                />
              </g>
            );
          })}
        </svg>
        {model.nodes.map((node) => {
          const size = mindmapNodeSize(node);
          return (
            <div
              key={node.id}
              className={`dv-mindmap-node dv-mindmap-node--depth-${Math.min(node.depth, 3)}`}
              style={{ left: node.x, top: node.y, width: size, height: size, background: node.color }}
            >
            <button
              type="button"
              className="dv-mindmap-drag-handle"
              title="Drag node"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                setEditingNode(null);
                setColorNode(null);
                setSelectedEdge(null);
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
              className="dv-mindmap-color-button"
              title="Change node color"
              onClick={(e) => {
                e.stopPropagation();
                setEditingNode(null);
                setSelectedEdge(null);
                setColorNode(colorNode === node.id ? null : node.id);
              }}
            >
              <span style={{ background: node.color }} />
            </button>
            {colorNode === node.id ? (
              <div className="dv-mindmap-colors" aria-label="Node colors">
                {MINDMAP_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={color === MINDMAP_COLORS[0] ? 'Default' : color}
                    className={node.color === color ? 'dv-mindmap-color--selected' : ''}
                    style={{ background: color }}
                    onClick={() => setNodeColor(node.id, color)}
                  />
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="dv-mindmap-add-node"
              title="Add child idea"
              onClick={(e) => {
                e.stopPropagation();
                setEditingNode(null);
                setColorNode(null);
                setSelectedEdge(null);
                addChildNode(node);
              }}
            >
              <Plus size={12} />
            </button>
            {editingNode === node.id ? (
              <input
                className="dv-mindmap-node-input"
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
                className="dv-mindmap-node-label"
                title="Rename mindmap node"
                onClick={() => {
                  setDraft(node.label);
                  setColorNode(null);
                  setSelectedEdge(null);
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

const SEQUENCE_NODE_W = 96;
const SEQUENCE_NODE_H = 42;
const SEQUENCE_LABEL_MIN_W = 62;
const SEQUENCE_LABEL_MAX_W = 180;

function sequenceMessageLabelWidth(label: string): number {
  return Math.min(SEQUENCE_LABEL_MAX_W, Math.max(SEQUENCE_LABEL_MIN_W, label.length * 8 + 24));
}

function SequenceVisualEditor({
  code,
  onChange,
}: {
  code: string;
  onChange: (next: string) => void;
}): React.JSX.Element | null {
  const model = useMemo(() => parseSequence(code), [code]);
  const [drag, setDrag] = useState<SequenceDragState | null>(null);
  const [lifelineDrag, setLifelineDrag] = useState<SequenceLifelineDragState | null>(null);
  const [colorParticipant, setColorParticipant] = useState<string | null>(null);
  const [selectedLifeline, setSelectedLifeline] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [editingParticipant, setEditingParticipant] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const suppressLifelineClick = useRef<string | null>(null);

  if (!model) return null;

  const participantById = new Map(model.participants.map((participant) => [participant.id, participant]));
  const maxMessageY =
    Math.max(...model.participants.map((participant) => participant.y), 52) + SEQUENCE_NODE_H + 86 + model.messages.length * 62;
  const width = Math.max(620, ...model.participants.map((participant) => participant.x + SEQUENCE_NODE_W + 120));
  const height = Math.max(
    320,
    maxMessageY + 84,
    ...model.participants.map((participant) => participant.y + SEQUENCE_NODE_H + participant.lifelineLength + 60),
  );

  const moveParticipant = (clientX: number, clientY: number): void => {
    if (!drag) return;
    const dx = clientX - drag.startX;
    const dy = clientY - drag.startY;
    const next = {
      ...drag.model,
      participants: drag.model.participants.map((participant) =>
        participant.id === drag.participantId
          ? {
              ...participant,
              x: Math.max(20, drag.originX + dx),
              y: Math.max(20, drag.originY + dy),
            }
          : participant,
      ),
    };
    onChange(serializeSequence(next));
  };

  const moveLifeline = (clientY: number): void => {
    if (!lifelineDrag) return;
    const dy = clientY - lifelineDrag.startY;
    const next = {
      ...lifelineDrag.model,
      participants: lifelineDrag.model.participants.map((participant) =>
        participant.id === lifelineDrag.participantId
          ? {
              ...participant,
              lifelineLength: Math.max(72, lifelineDrag.originLength + dy),
            }
          : participant,
      ),
    };
    onChange(serializeSequence(next));
  };

  const setParticipantColor = (participantId: string, color: string): void => {
    const next = {
      ...model,
      participants: model.participants.map((participant) =>
        participant.id === participantId ? { ...participant, color } : participant,
      ),
    };
    onChange(serializeSequence(next));
    setColorParticipant(null);
  };

  const commitParticipantLabel = (participantId: string, label: string): void => {
    const next = {
      ...model,
      participants: model.participants.map((participant) =>
        participant.id === participantId ? { ...participant, label: cleanSequenceLabel(label) } : participant,
      ),
    };
    setEditingParticipant(null);
    onChange(serializeSequence(next));
  };

  const commitMessageLabel = (messageIndex: number, label: string): void => {
    const next = {
      ...model,
      messages: model.messages.map((message, i) =>
        i === messageIndex ? { ...message, label: escapeSequenceMessage(label) } : message,
      ),
    };
    setEditingMessage(null);
    onChange(serializeSequence(next));
  };

  const scrollCanvas = (direction: -1 | 1): void => {
    canvasRef.current?.scrollBy({ left: direction * 260, behavior: 'smooth' });
  };

  const addParticipant = (): void => {
    const id = nextSequenceParticipantId(model.participants);
    const rightmost = model.participants.reduce(
      (max, participant) => Math.max(max, participant.x + SEQUENCE_NODE_W),
      100,
    );
    const newParticipant: SequenceParticipant = {
      id,
      label: 'Participant',
      x: rightmost + 94,
      y: 52,
      lifelineLength: defaultSequenceLifelineLength(model.messages.length),
      color: defaultSequenceColor(model.participants.length),
    };
    onChange(serializeSequence({ ...model, participants: [...model.participants, newParticipant] }));
    requestAnimationFrame(() => {
      canvasRef.current?.scrollTo({ left: Math.max(0, newParticipant.x - 80), behavior: 'smooth' });
    });
  };

  const deleteSelectedLifeline = (): void => {
    if (!selectedLifeline || model.participants.length <= 1) {
      setSelectedLifeline(null);
      return;
    }
    const next = {
      participants: model.participants.filter((participant) => participant.id !== selectedLifeline),
      messages: model.messages.filter(
        (message) => message.from !== selectedLifeline && message.to !== selectedLifeline,
      ),
    };
    setSelectedLifeline(null);
    setColorParticipant(null);
    setConnectFrom(null);
    setEditingParticipant(null);
    setEditingMessage(null);
    setDrag(null);
    setLifelineDrag(null);
    onChange(serializeSequence(next));
  };

  const addInteraction = (targetId: string): void => {
    if (!connectFrom || connectFrom === targetId) return;
    const next = {
      ...model,
      messages: [...model.messages, { from: connectFrom, to: targetId, arrow: '->>', label: 'Interaction' }],
    };
    setConnectFrom(null);
    setSelectedLifeline(null);
    setColorParticipant(null);
    onChange(serializeSequence(next));
  };

  return (
    <div
      ref={canvasRef}
      className="dv-sequence-editor"
      tabIndex={0}
      onPointerMove={(e) => {
        moveParticipant(e.clientX, e.clientY);
        moveLifeline(e.clientY);
      }}
      onPointerUp={() => {
        setDrag(null);
        setLifelineDrag(null);
      }}
      onPointerCancel={() => {
        setDrag(null);
        setLifelineDrag(null);
      }}
      onKeyDown={(e) => {
        if (connectFrom && e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setConnectFrom(null);
        }
        if (selectedLifeline && (e.key === 'Delete' || e.key === 'Backspace')) {
          e.preventDefault();
          e.stopPropagation();
          deleteSelectedLifeline();
        }
      }}
    >
      <div className="dv-sequence-scroll-controls">
        <button type="button" title="Add participant node" disabled={connectFrom !== null} onClick={addParticipant}>
          <UserPlus size={15} />
        </button>
        <button type="button" title="Scroll left" onClick={() => scrollCanvas(-1)}>
          <ChevronLeft size={15} />
        </button>
        <button type="button" title="Scroll right" onClick={() => scrollCanvas(1)}>
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="dv-sequence-canvas" style={{ width, height }}>
        <svg className="dv-sequence-lines" width={width} height={height} aria-hidden="true">
          <defs>
            <marker id="dv-sequence-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" />
            </marker>
          </defs>
          {model.participants.map((participant) => {
            const x = participant.x + SEQUENCE_NODE_W / 2;
            return (
              <g key={`${participant.id}-lifeline`}>
                <line
                  className={`dv-sequence-lifeline${
                    selectedLifeline === participant.id || connectFrom === participant.id ? ' dv-sequence-lifeline--selected' : ''
                  }`}
                  x1={x}
                  y1={participant.y + SEQUENCE_NODE_H}
                  x2={x}
                  y2={participant.y + SEQUENCE_NODE_H + participant.lifelineLength}
                />
                <line
                  className="dv-sequence-lifeline-hit"
                  x1={x}
                  y1={participant.y + SEQUENCE_NODE_H}
                  x2={x}
                  y2={participant.y + SEQUENCE_NODE_H + participant.lifelineLength}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (connectFrom && connectFrom !== participant.id) {
                      suppressLifelineClick.current = participant.id;
                      addInteraction(participant.id);
                      return;
                    }
                    setColorParticipant(null);
                    setConnectFrom(null);
                    setEditingParticipant(null);
                    setEditingMessage(null);
                    setSelectedLifeline(participant.id);
                    canvasRef.current?.focus();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (suppressLifelineClick.current === participant.id) {
                      suppressLifelineClick.current = null;
                      return;
                    }
                    if (connectFrom && connectFrom !== participant.id) {
                      addInteraction(participant.id);
                      return;
                    }
                    setConnectFrom(null);
                    setSelectedLifeline(participant.id);
                    canvasRef.current?.focus();
                  }}
                />
              </g>
            );
          })}
          {model.messages.map((message, i) => {
            const from = participantById.get(message.from);
            const to = participantById.get(message.to);
            if (!from || !to) return null;
            const y = Math.max(from.y, to.y) + SEQUENCE_NODE_H + 68 + i * 62;
            const x1 = from.x + SEQUENCE_NODE_W / 2;
            const x2 = to.x + SEQUENCE_NODE_W / 2;
            const labelX = (x1 + x2) / 2;
            const labelWidth = sequenceMessageLabelWidth(message.label);
            const isReturn = message.arrow.includes('--') || message.arrow.includes('-.');
            const leftToRight = x2 >= x1;
            return (
              <g key={`${message.from}-${message.to}-${i}`}>
                <line
                  className={`dv-sequence-message${isReturn ? ' dv-sequence-message--return' : ''}`}
                  x1={x1}
                  y1={y}
                  x2={x2}
                  y2={y}
                  markerEnd="url(#dv-sequence-arrow)"
                />
                <foreignObject x={labelX - labelWidth / 2} y={y - 34} width={labelWidth} height="28">
                  {editingMessage === i ? (
                    <input
                      className="dv-sequence-message-input"
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitMessageLabel(i, draft)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitMessageLabel(i, draft);
                        if (e.key === 'Escape') setEditingMessage(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="dv-sequence-message-label"
                      title="Rename interaction"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDraft(message.label);
                        setEditingParticipant(null);
                        setEditingMessage(i);
                      }}
                    >
                      {message.label}
                    </button>
                  )}
                </foreignObject>
                {message.arrow.includes('x') ? (
                  <text className="dv-sequence-stop" x={leftToRight ? x2 + 8 : x2 - 8} y={y + 4} textAnchor="middle">
                    x
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {model.participants.map((participant, i) => (
          <div
            key={participant.id}
            className={`dv-sequence-node${
              connectFrom === participant.id ? ' dv-sequence-node--connecting' : ''
            }`}
            style={{ left: participant.x, top: participant.y, width: SEQUENCE_NODE_W, minHeight: SEQUENCE_NODE_H, background: participant.color }}
          >
            <button
              type="button"
              className="dv-sequence-drag-handle"
              title="Drag participant"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                setColorParticipant(null);
                setLifelineDrag(null);
                setSelectedLifeline(null);
                setConnectFrom(null);
                setEditingParticipant(null);
                setEditingMessage(null);
                setDrag({
                  participantId: participant.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  originX: participant.x,
                  originY: participant.y,
                  model,
                });
              }}
            >
              <GripVertical size={13} />
            </button>
            <button
              type="button"
              className="dv-sequence-color-button"
              title="Change participant color"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedLifeline(null);
                setConnectFrom(null);
                setEditingParticipant(null);
                setEditingMessage(null);
                setColorParticipant(colorParticipant === participant.id ? null : participant.id);
              }}
            >
              <span style={{ background: participant.color }} />
            </button>
            {colorParticipant === participant.id ? (
              <div className="dv-sequence-colors" aria-label="Participant colors">
                {SEQUENCE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={color === defaultSequenceColor(i) ? 'Default' : color}
                    className={participant.color === color ? 'dv-sequence-color--selected' : ''}
                    style={{ background: color }}
                    onClick={() => setParticipantColor(participant.id, color)}
                  />
                ))}
              </div>
            ) : null}
            {editingParticipant === participant.id ? (
              <input
                className="dv-sequence-node-input"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitParticipantLabel(participant.id, draft)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitParticipantLabel(participant.id, draft);
                  if (e.key === 'Escape') setEditingParticipant(null);
                }}
              />
            ) : (
              <button
                type="button"
                className="dv-sequence-node-label"
                title={connectFrom ? 'Select a vertical line to connect' : 'Rename participant'}
                onClick={(e) => {
                  if (connectFrom) {
                    e.stopPropagation();
                    return;
                  }
                  setDraft(participant.label);
                  setColorParticipant(null);
                  setSelectedLifeline(null);
                  setEditingMessage(null);
                  setEditingParticipant(participant.id);
                }}
              >
                {participant.label}
              </button>
            )}
          </div>
        ))}
        {model.participants.map((participant) => (
          <div key={`${participant.id}-line-tools`}>
            <button
              type="button"
              className={`dv-sequence-lifeline-add${connectFrom === participant.id ? ' dv-sequence-lifeline-add--active' : ''}`}
              title="Add interaction from this lifeline"
              style={{
                left: participant.x + SEQUENCE_NODE_W / 2,
                top: participant.y + SEQUENCE_NODE_H + Math.min(42, participant.lifelineLength / 2),
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDrag(null);
                setColorParticipant(null);
                setSelectedLifeline(null);
                setEditingParticipant(null);
                setEditingMessage(null);
                setConnectFrom(connectFrom === participant.id ? null : participant.id);
                canvasRef.current?.focus();
              }}
            >
              <Plus size={11} />
            </button>
            <button
              type="button"
              className="dv-sequence-lifeline-handle"
              title="Drag lifeline length"
              style={{
                left: participant.x + SEQUENCE_NODE_W / 2,
                top: participant.y + SEQUENCE_NODE_H + participant.lifelineLength,
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                setDrag(null);
                setColorParticipant(null);
                setSelectedLifeline(participant.id);
                setConnectFrom(null);
                setEditingParticipant(null);
                setEditingMessage(null);
                canvasRef.current?.focus();
                setLifelineDrag({
                  participantId: participant.id,
                  startY: e.clientY,
                  originLength: participant.lifelineLength,
                  model,
                });
              }}
            />
          </div>
        ))}
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
      const supportsVisualFlowchart = parseFlowchart(code) !== null && flowchartFullyRepresentable(code);
      const supportsVisualMindmap = parseMindmap(code) !== null && mindmapFullyRepresentable(code);
      const supportsVisualSequence = parseSequence(code) !== null && sequenceFullyRepresentable(code);

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
              ) : supportsVisualMindmap ? (
                <MindmapVisualEditor
                  code={code}
                  onChange={(next) => editor.updateBlock(block, { props: { code: next } })}
                />
              ) : supportsVisualSequence ? (
                <SequenceVisualEditor
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
