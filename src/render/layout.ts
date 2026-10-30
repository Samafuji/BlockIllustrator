import { Box, RoutedEdge, routeEdge, polylineMid, perpLeft, segmentCrossing } from '../geometry/geometry';
import { DEdge, DNode, DStyle, Diagram, Point, edgeTextDefaults, nodeSize, resolveEdgeText, resolveNode } from '../model/types';
import { LabelLayout, layoutLabel } from './label';

/** A place where a line hops over another one: point on the segment `seg`, at distance `d` from its start. */
export interface Jump {
  seg: number;
  d: number;
  p: Point;
}

export interface EdgeLayout {
  edge: DEdge;
  route: RoutedEdge;
  /** target is a junction: no arrowhead unless the edge sets one explicitly */
  toJunction: boolean;
  label?: { layout: LabelLayout; pos: Point; defaultOffset: Point; mid: Point };
  sign?: { layout: LabelLayout; pos: Point };
  /** hops drawn where this line crosses lines defined before it (sorted along the line) */
  jumps: Jump[];
}

export interface DiagramLayout {
  diagram: Diagram;
  boxes: Map<string, Box>;
  labels: Map<string, LabelLayout>;
  edges: EdgeLayout[];
  bounds: { x: number; y: number; w: number; h: number };
}

export function nodeFontSize(n: DNode, s: DStyle): number {
  return resolveNode(n, s).fontSize;
}

/** Whether a junction node draws its dot. */
export function junctionDotVisible(n: DNode, s: DStyle): boolean {
  if (n.hidden === true) return false;
  if (n.hidden === false) return true;
  return s.junctionStyle !== 'none';
}

export function nodeLabelText(n: DNode, s: DStyle): string {
  if (n.type === 'sum' && n.label === '' && resolveNode(n, s).sumStyle === 'sigma') return '$\\Sigma$';
  return n.label;
}

/** Layout of a node's label with its resolved font / weight / style. */
export function layoutNodeLabel(n: DNode, s: DStyle): LabelLayout {
  const rs = resolveNode(n, s);
  return layoutLabel(nodeLabelText(n, s), rs.fontSize, rs.font, { bold: rs.bold, italic: rs.italic, underline: rs.underline });
}

/** Unit vector a gain triangle points along (right / down / left / up). */
export function gainDirection(n: DNode): Point {
  const r = (resolveNodeRotate(n) + (n.flip ? 180 : 0)) % 360;
  return r === 0 ? { x: 1, y: 0 } : r === 90 ? { x: 0, y: 1 } : r === 180 ? { x: -1, y: 0 } : { x: 0, y: -1 };
}

function resolveNodeRotate(n: DNode): number {
  const r = n.rotate ?? 0;
  return (((Math.round(r / 90) * 90) % 360) + 360) % 360;
}

/** The node's box in its own (unrotated) frame: what the shape is drawn with. */
export function shapeBox(box: Box): Box {
  const r = resolveNodeRotate(box.node);
  return r === 90 || r === 270 ? { ...box, w: box.h, h: box.w } : box;
}

/** Turn a point around the node center by the node's rotation. */
export function rotateAbout(p: Point, box: Box): Point {
  const r = resolveNodeRotate(box.node);
  if (r === 0) return p;
  const dx = p.x - box.cx;
  const dy = p.y - box.cy;
  if (r === 90) return { x: box.cx - dy, y: box.cy + dx };
  if (r === 180) return { x: box.cx - dx, y: box.cy - dy };
  return { x: box.cx + dy, y: box.cy - dx };
}

/**
 * Where a node's label is drawn, in the node's own frame: inside the shape, or as a
 * caption under an image (before any manual offset).
 */
export function nodeLabelBasePos(b: Box, lay: LabelLayout, s: DStyle): Point {
  const box = shapeBox(b);
  const n = box.node;
  const rs = resolveNode(n, s);
  const gap = rs.fontSize * 0.35;
  // text at the left / right edge of a block (multi-line alignment also moves the label)
  const inset = (): number => {
    if (n.type === 'text' || n.type === 'image' || rs.textAlign === 'center') return 0;
    const pad = Math.min(rs.fontSize * 0.6, Math.max(0, (box.w - lay.w) / 2));
    return rs.textAlign === 'left' ? -(box.w / 2 - pad - lay.w / 2) : box.w / 2 - pad - lay.w / 2;
  };
  switch (rs.labelPos) {
    case 'bottom':
      return { x: box.cx, y: box.cy + box.h / 2 + gap + lay.h / 2 };
    case 'top':
      return { x: box.cx, y: box.cy - box.h / 2 - gap - lay.h / 2 };
    case 'left':
      return { x: box.cx - box.w / 2 - gap * 1.5 - lay.w / 2, y: box.cy };
    case 'right':
      return { x: box.cx + box.w / 2 + gap * 1.5 + lay.w / 2, y: box.cy };
    default:
      if (n.type === 'gain') {
        // the text sits toward the base of the triangle (the shape itself is drawn pointing right)
        return { x: box.cx + (n.flip ? 1 : -1) * box.w * 0.12, y: box.cy };
      }
      return { x: box.cx + inset(), y: box.cy };
  }
}

/** Label position in the node's own frame: the default placement plus the manual `offset`. */
export function nodeLabelLocalPos(box: Box, lay: LabelLayout, s: DStyle): Point {
  const base = nodeLabelBasePos(box, lay, s);
  const off = box.node.labelOffset;
  return off ? { x: base.x + off.x, y: base.y + off.y } : base;
}

/** Final label position in world coordinates (turned with a rotated node). */
export function nodeLabelPos(box: Box, lay: LabelLayout, s: DStyle): Point {
  return rotateAbout(nodeLabelLocalPos(box, lay, s), box);
}

export function layoutDiagram(d: Diagram): DiagramLayout {
  const s = d.style;
  const boxes = new Map<string, Box>();
  const labels = new Map<string, LabelLayout>();
  for (const n of d.nodes) {
    const lay = layoutNodeLabel(n, s);
    labels.set(n.id, lay);
    let { w, h } = nodeSize(n, s);
    if (n.type === 'text') {
      if (!w) w = lay.w + 4; // 0 = not specified: measure the label
      if (!h) h = lay.h + 2;
    }
    if (n.type === 'junction' && !junctionDotVisible(n, s)) {
      w = 0;
      h = 0;
    }
    // a shape turned by 90° occupies its transposed box (what lines attach to and handles show)
    const rot = resolveNodeRotate(n);
    if (rot === 90 || rot === 270) [w, h] = [h, w];
    boxes.set(n.id, { node: n, cx: n.x, cy: n.y, w, h });
  }
  const edges: EdgeLayout[] = [];
  for (const e of d.edges) {
    const from = boxes.get(e.from);
    const to = boxes.get(e.to);
    if (!from || !to) continue;
    const route = routeEdge(e, from, to);
    const el: EdgeLayout = { edge: e, route, toJunction: to.node.type === 'junction', jumps: [] };
    const ta = resolveEdgeText(e, s);
    const fs = ta.fontSize;
    if (e.label) {
      const lay = layoutLabel(e.label, fs, ta.font, { bold: ta.bold, italic: ta.italic });
      const { p, dir } = polylineMid(route.points);
      const perp = perpLeft(dir);
      const defaultOffset = { x: perp.x * (fs * 0.6 + lay.h / 2), y: perp.y * (fs * 0.6 + lay.h / 2) };
      const off = e.labelOffset ?? defaultOffset;
      el.label = { layout: lay, pos: { x: p.x + off.x, y: p.y + off.y }, defaultOffset, mid: p };
    }
    if (e.sign) {
      const lay = layoutLabel(e.sign, fs * 1.1, s.font);
      const end = route.points[route.points.length - 1];
      const dir = route.endDir;
      const perp = perpLeft(dir);
      const back = fs * 0.9 + (to.node.type === 'sum' ? 2 : 0);
      const side = fs * 0.7;
      el.sign = { layout: lay, pos: { x: end.x - dir.x * back + perp.x * side, y: end.y - dir.y * back + perp.y * side } };
    }
    edges.push(el);
  }
  computeJumps(edges, s);
  return { diagram: d, boxes, labels, edges, bounds: computeBounds(boxes, labels, edges, s) };
}

/**
 * Line hops: where a connection crosses one that was written before it, the later
 * line gets a small arc. Crossings at the ends of a segment (lines meeting at a
 * junction or leaving the same block) are not hops.
 */
function computeJumps(edges: EdgeLayout[], s: DStyle): void {
  const r = s.jumpSize;
  for (let i = 0; i < edges.length; i++) {
    const el = edges[i];
    const jump = el.edge.jump ?? r > 0;
    if (!jump) continue;
    const radius = r > 0 ? r : 6;
    const pts = el.route.points;
    const found: Jump[] = [];
    for (let a = 0; a < pts.length - 1; a++) {
      const p0 = pts[a];
      const p1 = pts[a + 1];
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (len < radius * 2 + 2) continue;
      for (let j = 0; j < i; j++) {
        const other = edges[j];
        if (other.edge.from === el.edge.from && other.edge.to === el.edge.to) continue;
        const q = other.route.points;
        for (let b = 0; b < q.length - 1; b++) {
          const c = segmentCrossing(p0, p1, q[b], q[b + 1]);
          if (!c) continue;
          const d = c.t * len;
          // keep the arc inside the segment, away from its ends
          if (d < radius + 1 || d > len - radius - 1) continue;
          found.push({ seg: a, d, p: c.p });
        }
      }
    }
    found.sort((x, y) => x.seg - y.seg || x.d - y.d);
    // merge hops that would overlap
    const out: Jump[] = [];
    for (const f of found) {
      const last = out[out.length - 1];
      if (last && last.seg === f.seg && f.d - last.d < radius * 2) continue;
      out.push(f);
    }
    el.jumps = out;
  }
}

function computeBounds(
  boxes: Map<string, Box>,
  labels: Map<string, LabelLayout>,
  edges: EdgeLayout[],
  s: DStyle,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const b of boxes.values()) {
    const sw = resolveNode(b.node, s).strokeWidth / 2;
    add(b.cx - b.w / 2 - sw, b.cy - b.h / 2 - sw);
    add(b.cx + b.w / 2 + sw, b.cy + b.h / 2 + sw);
    const lay = labels.get(b.node.id);
    if (lay && (b.node.label !== '' || b.node.type === 'sum')) {
      const p = nodeLabelPos(b, lay, s);
      const r = resolveNodeRotate(b.node);
      const [lw, lh] = r === 90 || r === 270 ? [lay.h, lay.w] : [lay.w, lay.h];
      add(p.x - lw / 2, p.y - lh / 2);
      add(p.x + lw / 2, p.y + lh / 2);
    }
  }
  for (const el of edges) {
    const e = el.edge;
    const lw = (e.width ?? s.lineWidth) / 2;
    const pts = el.route.points;
    for (const p of pts) add(p.x - lw, p.y - lw), add(p.x + lw, p.y + lw);
    // arrowheads are wider than the line (0.4 × size each side of the tip)
    const kind = e.arrow ?? (el.toJunction ? 'none' : s.arrow);
    const aw = (e.arrowSize ?? s.arrowSize) * 0.45;
    if (kind !== 'none' && pts.length > 1) {
      const tip = pts[pts.length - 1];
      add(tip.x - aw, tip.y - aw), add(tip.x + aw, tip.y + aw);
      if (kind === 'both') add(pts[0].x - aw, pts[0].y - aw), add(pts[0].x + aw, pts[0].y + aw);
    }
    const jr = s.jumpSize;
    for (const j of el.jumps) add(j.p.x - jr, j.p.y - jr), add(j.p.x + jr, j.p.y + jr);
    if (el.label) {
      add(el.label.pos.x - el.label.layout.w / 2, el.label.pos.y - el.label.layout.h / 2);
      add(el.label.pos.x + el.label.layout.w / 2, el.label.pos.y + el.label.layout.h / 2);
    }
    if (el.sign) {
      add(el.sign.pos.x - el.sign.layout.w / 2, el.sign.pos.y - el.sign.layout.h / 2);
      add(el.sign.pos.x + el.sign.layout.w / 2, el.sign.pos.y + el.sign.layout.h / 2);
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 200, h: 100 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
