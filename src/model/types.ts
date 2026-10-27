// ---------------------------------------------------------------------------
// Diagram data model
// ---------------------------------------------------------------------------

export type NodeType =
  | 'block'
  | 'rounded'
  | 'circle'
  | 'diamond'
  | 'gain'
  | 'sum'
  | 'junction'
  | 'text'
  | 'image';

export const NODE_TYPES: NodeType[] = [
  'block',
  'rounded',
  'circle',
  'diamond',
  'gain',
  'sum',
  'junction',
  'text',
  'image',
];

export type Side = 'left' | 'right' | 'top' | 'bottom';
export const SIDES: Side[] = ['left', 'right', 'top', 'bottom'];

export type ArrowKind = 'triangle' | 'open' | 'none' | 'dot' | 'both';
export const ARROW_KINDS: ArrowKind[] = ['triangle', 'open', 'none', 'dot', 'both'];

export type DashKind = 'solid' | 'dashed' | 'dotted';
/** Where a node's label sits: inside the shape, or beside it (captions of images). */
export type LabelPos = 'center' | 'top' | 'bottom' | 'left' | 'right';
export const LABEL_POSITIONS: LabelPos[] = ['center', 'top', 'bottom', 'left', 'right'];
export type RouteKind = 'auto' | 'straight';
export type SumStyle = 'plain' | 'cross' | 'sigma';

export interface Point {
  x: number;
  y: number;
}

export interface DNode {
  id: string;
  type: NodeType;
  label: string;
  x: number; // center
  y: number; // center
  w?: number;
  h?: number;
  fill?: string;
  stroke?: string;
  color?: string; // text color
  fontSize?: number;
  strokeWidth?: number;
  radius?: number; // corner radius (block)
  flip?: boolean; // gain pointing left
  sumStyle?: SumStyle;
  /** junction: draw no dot (lines simply branch). false forces the dot even if the global style hides it */
  hidden?: boolean;
  /** outline dash pattern (e.g. group boxes) */
  dash?: DashKind;
  /** image: asset name (see Diagram.assets) or a URL / data URL */
  src?: string;
  /** label placement (`caption bottom`); images default to bottom, everything else to center */
  labelPos?: LabelPos;
  /** manual label shift from its default position (`offset (dx, dy)`), set by dragging the label */
  labelOffset?: Point;
}

/** Embedded images: name -> data URL (`asset name "data:image/png;base64,..."`). */
export type Assets = Record<string, string>;

/** Resolve an image node's `src` to something an <image href> can load. */
export function resolveSrc(src: string | undefined, assets: Assets): string | undefined {
  if (!src) return undefined;
  return assets[src] ?? src;
}

/** Images are embedded as data URLs; anything else cannot be exported reliably. */
export function isDataUrl(s: string): boolean {
  return /^data:image\//i.test(s);
}

export interface DEdge {
  id: string; // e1, e2, ... (by order of appearance)
  from: string;
  to: string;
  fromSide?: Side;
  toSide?: Side;
  label?: string;
  labelOffset?: Point;
  sign?: string;
  waypoints: Point[];
  route: RouteKind;
  arrow?: ArrowKind;
  width?: number;
  color?: string;
  dash?: DashKind;
  fontSize?: number;
}

/** Per-node-type default appearance (style { circle: size (60, 60) fill #eef }) */
export interface TypeDefaults {
  w?: number;
  h?: number;
  fill?: string;
  stroke?: string;
  color?: string;
  fontSize?: number;
  strokeWidth?: number;
  radius?: number;
  sumStyle?: SumStyle;
  dash?: DashKind;
  labelPos?: LabelPos;
}

export const TYPE_DEFAULT_KEYS: (keyof TypeDefaults)[] = ['w', 'h', 'fill', 'stroke', 'color', 'fontSize', 'strokeWidth', 'radius', 'sumStyle', 'dash', 'labelPos'];

export interface DStyle {
  defaults: Partial<Record<NodeType, TypeDefaults>>;
  font: string;
  fontSize: number;
  lineWidth: number;
  lineColor: string;
  arrow: ArrowKind;
  arrowSize: number;
  blockFill: string;
  blockStroke: string;
  blockWidth: number;
  blockHeight: number;
  textColor: string;
  cornerRadius: number;
  sumRadius: number;
  junctionRadius: number;
  junctionStyle: 'dot' | 'none';
  background: string; // 'transparent' or color
  grid: number;
  padding: number;
}

export interface Diagram {
  style: DStyle;
  nodes: DNode[];
  edges: DEdge[];
  assets: Assets;
}

export const DEFAULT_STYLE: DStyle = {
  defaults: {},
  font: 'Arial, Helvetica, sans-serif',
  fontSize: 14,
  lineWidth: 1.5,
  lineColor: '#222222',
  arrow: 'triangle',
  arrowSize: 10,
  blockFill: '#ffffff',
  blockStroke: '#222222',
  blockWidth: 120,
  blockHeight: 48,
  textColor: '#111111',
  cornerRadius: 0,
  sumRadius: 10,
  junctionRadius: 4,
  junctionStyle: 'dot',
  background: 'transparent',
  grid: 10,
  padding: 24,
};

/** Scalar style keys (everything except the per-type `defaults`). */
export type StyleKey = Exclude<keyof DStyle, 'defaults'>;
export const STYLE_KEYS = (Object.keys(DEFAULT_STYLE) as (keyof DStyle)[]).filter((k) => k !== 'defaults') as StyleKey[];

export function emptyDiagram(): Diagram {
  return { style: { ...DEFAULT_STYLE, defaults: {} }, nodes: [], edges: [], assets: {} };
}

/** Fully resolved appearance of a node: node override -> type default -> global style. */
export interface ResolvedNode {
  w: number; // 0 for text nodes = measure the label
  h: number;
  fill: string;
  stroke: string;
  color: string;
  fontSize: number;
  strokeWidth: number;
  radius: number;
  sumStyle: SumStyle;
  dash?: DashKind;
  labelPos: LabelPos;
}

/** Defaults for free text on edges (labels, signs): the "text" type defaults, then the global style. */
export function edgeTextDefaults(s: DStyle): { fontSize: number; color: string } {
  const t = s.defaults.text ?? {};
  return { fontSize: t.fontSize ?? s.fontSize, color: t.color ?? s.textColor };
}

export function resolveNode(n: DNode, s: DStyle): ResolvedNode {
  const d: TypeDefaults = s.defaults[n.type] ?? {};
  let w: number;
  let h: number;
  switch (n.type) {
    case 'sum':
      w = n.w ?? d.w ?? s.sumRadius * 2;
      h = n.h ?? d.h ?? w;
      break;
    case 'junction':
      w = n.w ?? d.w ?? s.junctionRadius * 2;
      h = n.h ?? d.h ?? w;
      break;
    case 'text':
      w = n.w ?? d.w ?? 0;
      h = n.h ?? d.h ?? 0;
      break;
    default:
      w = n.w ?? d.w ?? s.blockWidth;
      h = n.h ?? d.h ?? s.blockHeight;
  }
  // images have no frame / background unless asked for
  const stroke = n.stroke ?? d.stroke ?? (n.type === 'image' ? 'none' : s.blockStroke);
  const fill = n.fill ?? d.fill ?? (n.type === 'junction' ? stroke : n.type === 'image' ? 'none' : s.blockFill);
  return {
    w,
    h,
    fill,
    stroke,
    color: n.color ?? d.color ?? s.textColor,
    fontSize: n.fontSize ?? d.fontSize ?? s.fontSize,
    strokeWidth: n.strokeWidth ?? d.strokeWidth ?? s.lineWidth,
    radius: n.radius ?? d.radius ?? (n.type === 'rounded' ? Math.min(10, h / 2) : s.cornerRadius),
    sumStyle: n.sumStyle ?? d.sumStyle ?? 'plain',
    dash: n.dash ?? d.dash,
    labelPos: n.labelPos ?? d.labelPos ?? (n.type === 'image' ? 'bottom' : 'center'),
  };
}

export function cloneDiagram(d: Diagram): Diagram {
  return JSON.parse(JSON.stringify(d));
}

export function findNode(d: Diagram, id: string): DNode | undefined {
  return d.nodes.find((n) => n.id === id);
}

export function findEdge(d: Diagram, id: string): DEdge | undefined {
  return d.edges.find((e) => e.id === id);
}

/** Effective (resolved) geometry of a node. */
export function nodeSize(n: DNode, s: DStyle): { w: number; h: number } {
  const r = resolveNode(n, s);
  return { w: r.w, h: r.h };
}

export function nextId(d: Diagram, prefix: string): string {
  let i = 1;
  const ids = new Set(d.nodes.map((n) => n.id));
  while (ids.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

export const TYPE_PREFIX: Record<NodeType, string> = {
  block: 'b',
  rounded: 'r',
  circle: 'c',
  diamond: 'd',
  gain: 'k',
  sum: 's',
  junction: 'j',
  text: 't',
  image: 'img',
};

/** Names of the embedded images referenced by image nodes. */
export function usedAssets(d: Diagram): Set<string> {
  const used = new Set<string>();
  for (const n of d.nodes) if (n.type === 'image' && n.src && d.assets[n.src] !== undefined) used.add(n.src);
  return used;
}
