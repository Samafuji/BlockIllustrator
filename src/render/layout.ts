import { Box, RoutedEdge, routeEdge, polylineMid, perpLeft } from '../geometry/geometry';
import { DEdge, DNode, DStyle, Diagram, Point, edgeTextDefaults, nodeSize, resolveNode } from '../model/types';
import { LabelLayout, layoutLabel } from './label';

export interface EdgeLayout {
  edge: DEdge;
  route: RoutedEdge;
  /** target is a junction: no arrowhead unless the edge sets one explicitly */
  toJunction: boolean;
  label?: { layout: LabelLayout; pos: Point; defaultOffset: Point; mid: Point };
  sign?: { layout: LabelLayout; pos: Point };
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

/** Where a node's label is drawn: inside the shape, or as a caption under an image. */
export function nodeLabelPos(box: Box, lay: LabelLayout, s: DStyle): Point {
  const n = box.node;
  const rs = resolveNode(n, s);
  const gap = rs.fontSize * 0.35;
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
      if (n.type === 'gain') return { x: box.cx + (n.flip ? 1 : -1) * box.w * 0.12, y: box.cy };
      return { x: box.cx, y: box.cy };
  }
}

export function layoutDiagram(d: Diagram): DiagramLayout {
  const s = d.style;
  const boxes = new Map<string, Box>();
  const labels = new Map<string, LabelLayout>();
  for (const n of d.nodes) {
    const lay = layoutLabel(nodeLabelText(n, s), nodeFontSize(n, s), s.font);
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
    boxes.set(n.id, { node: n, cx: n.x, cy: n.y, w, h });
  }
  const edges: EdgeLayout[] = [];
  for (const e of d.edges) {
    const from = boxes.get(e.from);
    const to = boxes.get(e.to);
    if (!from || !to) continue;
    const route = routeEdge(e, from, to);
    const el: EdgeLayout = { edge: e, route, toJunction: to.node.type === 'junction' };
    const fs = e.fontSize ?? edgeTextDefaults(s).fontSize;
    if (e.label) {
      const lay = layoutLabel(e.label, fs, s.font);
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
  return { diagram: d, boxes, labels, edges, bounds: computeBounds(boxes, labels, edges, s) };
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
      add(p.x - lay.w / 2, p.y - lay.h / 2);
      add(p.x + lay.w / 2, p.y + lay.h / 2);
    }
  }
  for (const el of edges) {
    for (const p of el.route.points) add(p.x - s.arrowSize / 2, p.y - s.arrowSize / 2), add(p.x + s.arrowSize / 2, p.y + s.arrowSize / 2);
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
