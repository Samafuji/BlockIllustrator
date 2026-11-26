// Shared half of the PowerPoint importers: "raw" shapes / lines / text boxes (already in
// diagram pixels) become a Diagram. Lines are attached to the shapes they touch, loose
// text becomes block labels, line labels or text nodes, and the most common colors /
// sizes / fonts move into the style block so the generated .bd stays readable.

import { Box, distToSegment, pointInBox, routeEdge, sideToward } from '../geometry/geometry';
import {
  ArrowKind,
  DEFAULT_STYLE,
  DEdge,
  DNode,
  DashKind,
  Diagram,
  NodeType,
  Point,
  Side,
  SumStyle,
  TYPE_PREFIX,
  TextAlign,
  emptyDiagram,
} from '../model/types';
import { layoutDiagram } from '../render/layout';

export interface RawRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  /** px */
  size?: number;
  font?: string;
}

export interface RawText {
  /** label text with inline tags and \n */
  text: string;
  fontSize?: number;
  color?: string;
  font?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: TextAlign;
}

export interface RawShape {
  type: NodeType;
  /** preferred id (from a Block Illustrator export) */
  id?: string;
  /** reference used by lines / labels that point at this shape */
  ref?: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  dash?: DashKind;
  text?: RawText;
  flip?: boolean;
  rotate?: number;
  src?: string;
  sumStyle?: SumStyle;
  hidden?: boolean;
  back?: boolean;
}

export interface RawLine {
  id?: string;
  ref?: string;
  points: Point[];
  /** shape refs the ends are glued to (connectors) */
  fromRef?: string;
  toRef?: string;
  arrowStart: boolean;
  arrowEnd: boolean;
  arrowKind?: 'triangle' | 'open' | 'dot';
  color?: string;
  width?: number;
  dash?: DashKind;
}

export interface RawTextBox {
  /** reference used by connectors glued to this text box (it then becomes a text node) */
  ref?: string;
  /** preferred id (from a Block Illustrator export) */
  id?: string;
  /** what the box was in a Block Illustrator export */
  hint?: 'label' | 'sign' | 'caption';
  /** ref of the line / shape the hint belongs to */
  target?: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  text: RawText;
}

export interface RawScene {
  shapes: RawShape[];
  lines: RawLine[];
  texts: RawTextBox[];
  assets: Record<string, string>;
  /** shift the result so its top-left lands near (40, 40) */
  normalize: boolean;
}

// ---------------------------------------------------------------- text helpers
const esc$ = (s: string) => s.replace(/\$/g, '\\$');

/** Lines of runs -> one label (inline tags only where a run differs from the whole). */
export function runsToText(lines: RawRun[][]): RawText {
  const runs = lines.flat().filter((r) => r.text.trim() !== '');
  const all = (k: 'bold' | 'italic' | 'underline') => runs.length > 0 && runs.every((r) => !!r[k]);
  const bold = all('bold');
  const italic = all('italic');
  const underline = all('underline');
  const colors = runs.map((r) => r.color).filter((c): c is string => !!c);
  const color = colors.length === runs.length && runs.length > 0 && colors.every((c) => c === colors[0]) ? colors[0] : undefined;
  const sizes = runs.map((r) => r.size).filter((s): s is number => !!s);
  const fontSize = sizes.length ? mode(sizes) : undefined;
  const fonts = runs.map((r) => r.font).filter((f): f is string => !!f);
  const font = fonts.length ? mode(fonts) : undefined;
  const text = lines
    .map((line) =>
      line
        .map((r) => {
          let s = esc$(r.text);
          if (!s) return '';
          if (r.size && fontSize && r.size < fontSize * 0.9) s = `<small>${s}</small>`;
          else if (r.size && fontSize && r.size > fontSize * 1.15) s = `<big>${s}</big>`;
          if (r.color && !color && r.text.trim()) s = `<color ${r.color}>${s}</color>`;
          if (r.bold && !bold) s = `<b>${s}</b>`;
          if (r.italic && !italic) s = `<i>${s}</i>`;
          if (r.underline && !underline) s = `<u>${s}</u>`;
          return s;
        })
        .join(''),
    )
    .join('\n')
    .replace(/\n+$/, '');
  return { text, fontSize, color, font, bold: bold || undefined, italic: italic || undefined, underline: underline || undefined };
}

export function mode<T extends string | number>(values: T[]): T {
  const count = new Map<T, number>();
  let best = values[0];
  let bestN = 0;
  for (const v of values) {
    const n = (count.get(v) ?? 0) + 1;
    count.set(v, n);
    if (n > bestN) {
      bestN = n;
      best = v;
    }
  }
  return best;
}

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------- geometry helpers
function boxOf(n: DNode, w: number, h: number): Box {
  return { node: n, cx: n.x, cy: n.y, w, h };
}

/** distance from a point to the edge of a box (0 inside) */
function distToBox(p: Point, b: Box): number {
  const dx = Math.max(Math.abs(p.x - b.cx) - b.w / 2, 0);
  const dy = Math.max(Math.abs(p.y - b.cy) - b.h / 2, 0);
  return Math.hypot(dx, dy);
}

function distToPolyline(p: Point, pts: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, distToSegment(p, pts[i], pts[i + 1]));
  return best;
}

function samePolyline(a: Point[], b: Point[], tol: number): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => Math.abs(p.x - b[i].x) <= tol && Math.abs(p.y - b[i].y) <= tol);
}

/** drop points that continue the previous segment in a straight line */
export function simplify(pts: Point[], tol = 1): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < tol) continue;
    out.push({ x: p.x, y: p.y });
  }
  const res: Point[] = [];
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && i < out.length - 1) {
      const a = res[res.length - 1];
      const b = out[i];
      const c = out[i + 1];
      if (distToSegment(b, a, c) < tol) continue;
    }
    res.push(out[i]);
  }
  return res;
}

const round1 = (v: number) => Math.round(v * 2) / 2;

/** make the segments of a nearly axis-aligned polyline exactly horizontal / vertical */
function orthogonalize(pts: Point[]): Point[] {
  const out = pts.map((p) => ({ x: p.x, y: p.y }));
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1];
    const b = out[i];
    if (Math.abs(b.x - a.x) <= Math.abs(b.y - a.y)) {
      const x = i === 1 ? a.x : i === out.length - 1 ? b.x : (a.x + b.x) / 2;
      a.x = x;
      b.x = x;
    } else {
      const y = i === 1 ? a.y : i === out.length - 1 ? b.y : (a.y + b.y) / 2;
      a.y = y;
      b.y = y;
    }
  }
  return out;
}

// ---------------------------------------------------------------- conversion
/**
 * Build a Diagram from raw shapes, lines and text boxes. Coordinates are diagram pixels.
 */
export function buildDiagram(scene: RawScene): Diagram {
  const d = emptyDiagram();
  d.assets = { ...scene.assets };
  const used = new Set<string>();
  const counters: Record<string, number> = {};
  const freshId = (type: NodeType): string => {
    const p = TYPE_PREFIX[type];
    let i = (counters[p] ?? 0) + 1;
    while (used.has(`${p}${i}`)) i++;
    counters[p] = i;
    used.add(`${p}${i}`);
    return `${p}${i}`;
  };
  const idFor = (type: NodeType, hint?: string): string => {
    if (hint && ID_RE.test(hint) && !used.has(hint)) {
      used.add(hint);
      return hint;
    }
    return freshId(type);
  };

  // text boxes that lines are glued to are text nodes, not loose labels
  const glued = new Set<string>();
  for (const l of scene.lines) {
    if (l.fromRef) glued.add(l.fromRef);
    if (l.toRef) glued.add(l.toRef);
  }
  const shapes: RawShape[] = [...scene.shapes];
  const texts: RawTextBox[] = [];
  for (const tb of scene.texts) {
    if (tb.ref && glued.has(tb.ref) && !tb.hint) shapes.push({ type: 'text', id: tb.id, ref: tb.ref, cx: tb.cx, cy: tb.cy, w: tb.w, h: tb.h, text: tb.text });
    else texts.push(tb);
  }

  // ---- nodes
  const refToId = new Map<string, string>();
  const boxes = new Map<string, Box>();
  const applyText = (n: DNode, t: RawText | undefined) => {
    if (!t) return;
    n.label = t.text;
    if (t.fontSize) n.fontSize = round1(t.fontSize);
    if (t.color) n.color = t.color;
    if (t.font) n.font = t.font;
    if (t.bold) n.bold = true;
    if (t.italic) n.italic = true;
    if (t.underline) n.underline = true;
    if (t.align && t.align !== 'center') n.textAlign = t.align;
  };
  for (const s of shapes) {
    const id = idFor(s.type, s.id);
    if (s.ref) refToId.set(s.ref, id);
    const n: DNode = { id, type: s.type, label: '', x: s.cx, y: s.cy };
    if (s.type !== 'text') {
      n.w = round1(s.w);
      n.h = round1(s.h);
    }
    if (s.fill !== undefined) n.fill = s.fill;
    if (s.stroke !== undefined) n.stroke = s.stroke;
    if (s.strokeWidth !== undefined) n.strokeWidth = round1(s.strokeWidth);
    if (s.radius !== undefined && s.radius > 0) n.radius = round1(s.radius);
    if (s.dash && s.dash !== 'solid') n.dash = s.dash;
    if (s.flip) n.flip = true;
    if (s.rotate) n.rotate = s.rotate;
    if (s.src) n.src = s.src;
    if (s.sumStyle) n.sumStyle = s.sumStyle;
    if (s.hidden) n.hidden = true;
    if (s.back) n.back = true;
    applyText(n, s.text);
    d.nodes.push(n);
    boxes.set(id, boxOf(n, s.w, s.h));
  }

  // ---- lines -> edges
  const nodeAt = (p: Point, tol: number): string | null => {
    let best: { id: string; dist: number; area: number } | null = null;
    for (const [id, b] of boxes) {
      const dist = distToBox(p, b);
      if (dist > tol) continue;
      const area = b.w * b.h;
      // the nearest box wins; among boxes containing the point, the smallest one
      if (!best || dist < best.dist - 0.01 || (Math.abs(dist - best.dist) <= 0.01 && area < best.area)) best = { id, dist, area };
    }
    return best?.id ?? null;
  };
  const lineRefToEdge = new Map<string, DEdge>();
  let edgeSeq = 0;
  for (const raw of scene.lines) {
    let pts = simplify(raw.points, 0.75);
    if (pts.length < 2) continue;
    let arrowStart = raw.arrowStart;
    let arrowEnd = raw.arrowEnd;
    let fromRef = raw.fromRef;
    let toRef = raw.toRef;
    // a line whose only arrowhead sits at its start points the other way
    if (arrowStart && !arrowEnd) {
      pts = [...pts].reverse();
      [arrowStart, arrowEnd] = [false, true];
      [fromRef, toRef] = [toRef, fromRef];
    }
    const tol = Math.max(6, (raw.width ?? 1.5) * 2);
    const endNode = (ref: string | undefined, p: Point): string => {
      const byRef = ref ? refToId.get(ref) : undefined;
      if (byRef && boxes.has(byRef)) return byRef;
      const near = nodeAt(p, tol);
      if (near) return near;
      // nothing there: a hidden branch point keeps the line end in place
      const id = freshId('junction');
      const n: DNode = { id, type: 'junction', label: '', x: p.x, y: p.y, hidden: true };
      d.nodes.push(n);
      boxes.set(id, boxOf(n, 0, 0));
      return id;
    };
    const from = endNode(fromRef, pts[0]);
    const to = endNode(toRef, pts[pts.length - 1]);
    if (from === to && pts.length < 3) continue;
    const e: DEdge = { id: `e${++edgeSeq}`, from, to, waypoints: [], route: 'auto' };
    const kind: ArrowKind = arrowStart && arrowEnd ? 'both' : arrowEnd ? raw.arrowKind ?? 'triangle' : 'none';
    e.arrow = kind;
    if (raw.color !== undefined) e.color = raw.color;
    if (raw.width !== undefined) e.width = round1(raw.width);
    if (raw.dash && raw.dash !== 'solid') e.dash = raw.dash;
    const fb = boxes.get(from)!;
    const tb = boxes.get(to)!;
    const orthogonal = pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 2.5 || Math.abs(p.y - pts[i - 1].y) < 2.5);
    if (orthogonal) pts = orthogonalize(pts);
    // does the automatic route already draw this line? then no waypoints / sides are needed
    const auto = routeEdge(e, fb, tb);
    const inner = pts.slice(1, -1);
    if (samePolyline(simplify(auto.points, 0.75), pts, 2.5)) {
      /* perfect */
    } else {
      e.waypoints = inner.map((p) => ({ x: round1(p.x), y: round1(p.y) }));
      if (!orthogonal) e.route = 'straight';
      // sides only when the line clearly leaves / enters through a side the router would not pick
      const fs: Side = sideToward(fb, pts[1]);
      const ts: Side = sideToward(tb, pts[pts.length - 2]);
      if (orthogonal && fb.w > 0) {
        const r2 = routeEdge(e, fb, tb);
        if (r2.fromSide !== fs) e.fromSide = fs;
        if (r2.toSide !== ts) e.toSide = ts;
      }
      if (inner.length === 0 && orthogonal) {
        // a plain straight segment the router bends: keep it straight through its midpoint
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        e.waypoints = [{ x: round1(mid.x), y: round1(mid.y) }];
        const r3 = routeEdge(e, fb, tb);
        if (samePolyline(simplify(r3.points, 0.75), pts, 2.5)) {
          /* good */
        } else {
          e.waypoints = [];
          e.route = 'straight';
        }
      }
    }
    d.edges.push(e);
    if (raw.ref) lineRefToEdge.set(raw.ref, e);
    if (raw.id) lineRefToEdge.set(raw.id, e);
  }

  // ---- text boxes: labels of shapes / lines, or text nodes
  let lay = layoutDiagram(d);
  const routes = new Map(lay.edges.map((el) => [el.edge.id, el.route.points]));
  const labelTargets: { e: DEdge; center: Point }[] = [];
  for (const tb of texts) {
    const center = { x: tb.cx, y: tb.cy };
    const fs = tb.text.fontSize ?? d.style.fontSize;
    if (tb.hint && tb.target) {
      const e = lineRefToEdge.get(tb.target);
      const nid = refToId.get(tb.target);
      if (tb.hint === 'label' && e) {
        e.label = tb.text.text;
        if (tb.text.fontSize) e.fontSize = round1(tb.text.fontSize);
        if (tb.text.bold) e.bold = true;
        if (tb.text.italic) e.italic = true;
        labelTargets.push({ e, center });
        continue;
      }
      if (tb.hint === 'sign' && e) {
        e.sign = tb.text.text;
        continue;
      }
      if (tb.hint === 'caption' && nid) {
        const n = d.nodes.find((x) => x.id === nid);
        if (n) {
          applyText(n, tb.text);
          continue;
        }
      }
    }
    // inside a shape without text: that shape's label
    let host: DNode | null = null;
    for (const [id, b] of boxes) {
      if (b.node.type === 'text' || b.node.type === 'junction') continue;
      if (pointInBox(center, b) && b.node.label === '') {
        if (!host || b.w * b.h < (boxes.get(host.id)!.w * boxes.get(host.id)!.h)) host = d.nodes.find((x) => x.id === id) ?? null;
      }
    }
    if (host) {
      applyText(host, tb.text);
      continue;
    }
    // next to a line: its label
    let bestE: DEdge | null = null;
    let bestD = Math.max(14, fs * 1.6);
    for (const e of d.edges) {
      if (e.label) continue;
      const pts = routes.get(e.id);
      if (!pts) continue;
      const dist = distToPolyline(center, pts);
      if (dist < bestD) {
        bestD = dist;
        bestE = e;
      }
    }
    if (bestE) {
      bestE.label = tb.text.text;
      if (tb.text.fontSize) bestE.fontSize = round1(tb.text.fontSize);
      if (tb.text.bold) bestE.bold = true;
      if (tb.text.italic) bestE.italic = true;
      labelTargets.push({ e: bestE, center });
      continue;
    }
    const n: DNode = { id: freshId('text'), type: 'text', label: '', x: tb.cx, y: tb.cy };
    applyText(n, tb.text);
    if (n.label === '') continue;
    d.nodes.push(n);
    boxes.set(n.id, boxOf(n, tb.w, tb.h));
  }
  // line labels keep the place their text box had
  if (labelTargets.length) {
    lay = layoutDiagram(d);
    for (const { e, center } of labelTargets) {
      const el = lay.edges.find((x) => x.edge.id === e.id);
      if (!el?.label) continue;
      const off = { x: round1(center.x - el.label.mid.x), y: round1(center.y - el.label.mid.y) };
      const def = el.label.defaultOffset;
      if (Math.abs(off.x - def.x) > 1.5 || Math.abs(off.y - def.y) > 1.5) e.labelOffset = off;
    }
  }

  // ---- common values move into the style block
  const shapeNodes = d.nodes.filter((n) => ['block', 'rounded', 'circle', 'diamond', 'gain', 'sum'].includes(n.type));
  const fills = shapeNodes.map((n) => n.fill).filter((v): v is string => v !== undefined);
  const strokes = shapeNodes.map((n) => n.stroke).filter((v): v is string => v !== undefined);
  const widths = [...shapeNodes.map((n) => n.strokeWidth), ...d.edges.map((e) => e.width)].filter((v): v is number => v !== undefined);
  const lineColors = d.edges.map((e) => e.color).filter((v): v is string => v !== undefined);
  const textSizes = [...d.nodes.map((n) => n.fontSize), ...d.edges.map((e) => e.fontSize)].filter((v): v is number => v !== undefined);
  const textColors = d.nodes.map((n) => n.color).filter((v): v is string => v !== undefined);
  const fonts = [...d.nodes.map((n) => n.font), ...d.edges.map((e) => e.font)].filter((v): v is string => v !== undefined);
  const blocks = d.nodes.filter((n) => n.type === 'block' || n.type === 'rounded');
  const blockSizes = blocks.filter((n) => n.w && n.h).map((n) => `${n.w}x${n.h}`);
  const sums = d.nodes.filter((n) => n.type === 'sum' && n.w);
  const junctions = d.nodes.filter((n) => n.type === 'junction' && n.w);
  const s = d.style;
  if (fills.length) s.blockFill = mode(fills);
  if (strokes.length) s.blockStroke = mode(strokes);
  if (widths.length) s.lineWidth = mode(widths);
  if (lineColors.length) s.lineColor = mode(lineColors);
  if (textSizes.length) s.fontSize = mode(textSizes);
  if (textColors.length) s.textColor = mode(textColors);
  if (fonts.length) {
    const f = mode(fonts);
    // "Arial" is what the default font list starts with: keep the default
    if (f.toLowerCase() !== DEFAULT_STYLE.font.split(',')[0].trim().toLowerCase()) s.font = f;
  }
  if (blockSizes.length) {
    const [w, h] = mode(blockSizes).split('x').map(Number);
    s.blockWidth = w;
    s.blockHeight = h;
  }
  if (sums.length) s.sumRadius = mode(sums.map((n) => n.w!)) / 2;
  if (junctions.length) s.junctionRadius = mode(junctions.map((n) => n.w!)) / 2;
  const arrows = d.edges.map((e) => e.arrow ?? 'triangle');
  if (arrows.length) {
    const a = mode(arrows);
    if (a === 'triangle' || a === 'open' || a === 'none' || a === 'dot') s.arrow = a;
  }
  for (const n of d.nodes) {
    if (shapeNodes.includes(n)) {
      if (n.fill === s.blockFill) delete n.fill;
      if (n.stroke === s.blockStroke) delete n.stroke;
    }
    if (n.type === 'junction' && n.fill === s.blockStroke) delete n.fill;
    if (n.strokeWidth === s.lineWidth) delete n.strokeWidth;
    if (n.fontSize === s.fontSize) delete n.fontSize;
    if (n.color === s.textColor) delete n.color;
    if (n.font === s.font || (n.font && n.font.toLowerCase() === s.font.split(',')[0].trim().toLowerCase())) delete n.font;
    if ((n.type === 'block' || n.type === 'rounded') && n.w === s.blockWidth && n.h === s.blockHeight) {
      delete n.w;
      delete n.h;
    }
    if (n.type === 'sum' && n.w === s.sumRadius * 2 && n.h === n.w) {
      delete n.w;
      delete n.h;
    }
    if (n.type === 'junction' && n.w !== undefined && (n.w <= 0 || (n.w === s.junctionRadius * 2 && n.h === n.w))) {
      delete n.w;
      delete n.h;
    }
  }
  for (const e of d.edges) {
    if (e.width === s.lineWidth) delete e.width;
    if (e.color === s.lineColor) delete e.color;
    if (e.fontSize === s.fontSize) delete e.fontSize;
    if (e.font === s.font || (e.font && e.font.toLowerCase() === s.font.split(',')[0].trim().toLowerCase())) delete e.font;
    const toJunction = d.nodes.find((n) => n.id === e.to)?.type === 'junction';
    const def = toJunction ? 'none' : s.arrow;
    if (e.arrow === def) delete e.arrow;
  }

  // ---- place the drawing near the origin
  if (scene.normalize && d.nodes.length) {
    lay = layoutDiagram(d);
    const dx = 40 - lay.bounds.x;
    const dy = 40 - lay.bounds.y;
    shiftDiagram(d, Math.round(dx), Math.round(dy));
  }
  for (const n of d.nodes) {
    n.x = Math.round(n.x * 2) / 2;
    n.y = Math.round(n.y * 2) / 2;
  }
  return d;
}

export function shiftDiagram(d: Diagram, dx: number, dy: number): void {
  for (const n of d.nodes) {
    n.x += dx;
    n.y += dy;
  }
  for (const e of d.edges) e.waypoints = e.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export { DEFAULT_STYLE };
