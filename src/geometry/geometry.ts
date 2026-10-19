import { DEdge, DNode, Point, Side } from '../model/types';

/** A node with its resolved size (text nodes are measured at render time). */
export interface Box {
  node: DNode;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface RoutedEdge {
  points: Point[];
  /** unit direction of the first segment (pointing away from the source) */
  startDir: Point;
  /** unit direction of the last segment (pointing into the target) */
  endDir: Point;
  /** sides actually used (undefined for straight routes) */
  fromSide?: Side;
  toSide?: Side;
}

export const SIDE_DIR: Record<Side, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

export function isHorizontal(side: Side): boolean {
  return side === 'left' || side === 'right';
}

export function opposite(side: Side): Side {
  return side === 'left' ? 'right' : side === 'right' ? 'left' : side === 'top' ? 'bottom' : 'top';
}

export function sideToward(b: Box, p: Point): Side {
  const dx = p.x - b.cx;
  const dy = p.y - b.cy;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** Anchor point on a given side. `along` optionally slides the anchor along the side. */
export function anchorOnSide(b: Box, side: Side, along?: number): Point {
  const { cx, cy, w, h, node } = b;
  const hw = w / 2;
  const hh = h / 2;
  if (node.type === 'gain') {
    const dir = node.flip ? -1 : 1;
    switch (side) {
      case 'left':
        return dir > 0 ? { x: cx - hw, y: cy } : { x: cx - hw, y: cy };
      case 'right':
        return { x: cx + hw, y: cy };
      case 'top':
        return { x: cx, y: cy - hh / 2 };
      case 'bottom':
        return { x: cx, y: cy + hh / 2 };
    }
  }
  const circular = node.type === 'sum' || node.type === 'junction' || node.type === 'circle';
  const diamond = node.type === 'diamond';
  const m = 6; // margin for sliding along a straight side
  switch (side) {
    case 'left': {
      if (circular || diamond || along === undefined) return { x: cx - hw, y: cy };
      const y = clamp(along, cy - hh + m, cy + hh - m);
      return { x: cx - hw, y };
    }
    case 'right': {
      if (circular || diamond || along === undefined) return { x: cx + hw, y: cy };
      const y = clamp(along, cy - hh + m, cy + hh - m);
      return { x: cx + hw, y };
    }
    case 'top': {
      if (circular || diamond || along === undefined) return { x: cx, y: cy - hh };
      const x = clamp(along, cx - hw + m, cx + hw - m);
      return { x, y: cy - hh };
    }
    case 'bottom': {
      if (circular || diamond || along === undefined) return { x: cx, y: cy + hh };
      const x = clamp(along, cx - hw + m, cx + hw - m);
      return { x, y: cy + hh };
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
}

/** Intersection of the ray center->target with the node boundary. */
export function anchorToward(b: Box, p: Point): Point {
  const dx = p.x - b.cx;
  const dy = p.y - b.cy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: b.cx, y: b.cy };
  const hw = Math.max(b.w / 2, 0.01);
  const hh = Math.max(b.h / 2, 0.01);
  const t = b.node.type;
  let s: number;
  if (t === 'sum' || t === 'junction' || t === 'circle') {
    // ellipse
    s = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  } else if (t === 'diamond') {
    s = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  } else {
    s = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  }
  return { x: b.cx + dx * s, y: b.cy + dy * s };
}

function unit(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-6 || Math.abs(last.y - p.y) > 1e-6) out.push(p);
  }
  // remove collinear middle points
  const res: Point[] = [];
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && i < out.length - 1) {
      const a = res[res.length - 1];
      const b = out[i];
      const c = out[i + 1];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      if (Math.abs(cross) < 1e-6 && dot > 0) continue;
    }
    res.push(out[i]);
  }
  return res;
}

/** Connect an anchor (leaving in direction of `side`) to a point with an elbow if needed. */
function elbowFrom(anchor: Point, side: Side, target: Point): Point[] {
  if (isHorizontal(side)) {
    if (Math.abs(anchor.y - target.y) < 0.5) return [anchor];
    return [anchor, { x: target.x, y: anchor.y }];
  }
  if (Math.abs(anchor.x - target.x) < 0.5) return [anchor];
  return [anchor, { x: anchor.x, y: target.y }];
}

export function routeEdge(e: DEdge, from: Box, to: Box): RoutedEdge {
  let points: Point[];
  let fromSide: Side | undefined;
  let toSide: Side | undefined;
  if (e.route === 'straight') {
    const wps = e.waypoints;
    const a = anchorToward(from, wps[0] ?? { x: to.cx, y: to.cy });
    const b = anchorToward(to, wps[wps.length - 1] ?? { x: from.cx, y: from.cy });
    points = dedupe([a, ...wps, b]);
  } else if (e.waypoints.length > 0) {
    const wps = e.waypoints;
    const fs = e.fromSide ?? sideToward(from, wps[0]);
    const ts = e.toSide ?? sideToward(to, wps[wps.length - 1]);
    const a = anchorOnSide(from, fs, isHorizontal(fs) ? wps[0].y : wps[0].x);
    const b = anchorOnSide(to, ts, isHorizontal(ts) ? wps[wps.length - 1].y : wps[wps.length - 1].x);
    const head = elbowFrom(a, fs, wps[0]);
    const tail = elbowFrom(b, ts, wps[wps.length - 1]).reverse();
    points = dedupe([...head, ...wps, ...tail]);
    fromSide = fs;
    toSide = ts;
  } else {
    const r = autoRoute(e, from, to);
    points = r.points;
    fromSide = r.fs;
    toSide = r.ts;
  }
  if (points.length < 2) points = [{ x: from.cx, y: from.cy }, { x: to.cx, y: to.cy }];
  const startDir = unit(points[0], points[1]);
  const endDir = unit(points[points.length - 2], points[points.length - 1]);
  return { points, startDir, endDir, fromSide, toSide };
}

function autoRoute(e: DEdge, from: Box, to: Box): { points: Point[]; fs: Side; ts: Side } {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  let fs = e.fromSide;
  let ts = e.toSide;

  // Feedback loop heuristic: backward horizontal connection without explicit sides
  if (!fs && !ts) {
    const overlapY = Math.abs(dy) < (from.h + to.h) / 2 + 20;
    const gapX = from.cx - from.w / 2 - (to.cx + to.w / 2);
    if (dx < 0 && overlapY && gapX > 0) {
      const loopY = Math.max(from.cy + from.h / 2, to.cy + to.h / 2) + 50;
      const a = anchorOnSide(from, 'bottom');
      const b = anchorOnSide(to, 'bottom');
      return { points: dedupe([a, { x: a.x, y: loopY }, { x: b.x, y: loopY }, b]), fs: 'bottom', ts: 'bottom' };
    }
  }

  if (!fs && !ts) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      fs = dx >= 0 ? 'right' : 'left';
      ts = opposite(fs);
    } else {
      fs = dy >= 0 ? 'bottom' : 'top';
      ts = opposite(fs);
    }
  } else if (!fs) {
    fs = sideToward(from, anchorOnSide(to, ts!));
  } else if (!ts) {
    ts = sideToward(to, anchorOnSide(from, fs));
  }
  const tsd = ts!;

  const a0 = anchorOnSide(from, fs);
  const b0 = anchorOnSide(to, tsd);
  let a = a0;
  let b = b0;
  if (isHorizontal(fs) && isHorizontal(tsd)) {
    if (Math.abs(a0.y - b0.y) <= 1) return { points: [a, b], fs, ts: tsd };
    const mx = (a.x + b.x) / 2;
    return { points: dedupe([a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]), fs, ts: tsd };
  }
  if (!isHorizontal(fs) && !isHorizontal(tsd)) {
    if (Math.abs(a0.x - b0.x) <= 1) return { points: [a, b], fs, ts: tsd };
    const my = (a.y + b.y) / 2;
    return { points: dedupe([a, { x: a.x, y: my }, { x: b.x, y: my }, b]), fs, ts: tsd };
  }
  if (isHorizontal(fs)) {
    // horizontal out, vertical in: corner at (b.x, a.y)
    a = anchorOnSide(from, fs);
    b = anchorOnSide(to, tsd, a.x);
    return { points: dedupe([a, { x: b.x, y: a.y }, b]), fs, ts: tsd };
  }
  a = anchorOnSide(from, fs);
  b = anchorOnSide(to, tsd, a.y);
  return { points: dedupe([a, { x: a.x, y: b.y }, b]), fs, ts: tsd };
}

/**
 * Shift the waypoints of an edge whose endpoint node moved by `delta`.
 * The first waypoint (nearest to the moved node) moves fully; the shift is then
 * propagated along axis-aligned segments so that horizontal segments stay
 * horizontal and vertical segments stay vertical. Propagation stops at the
 * first diagonal segment.
 */
export function followWaypoints(wps: Point[], delta: Point, fromStart: boolean): Point[] {
  if (wps.length === 0) return wps;
  const orig = fromStart ? wps : [...wps].reverse();
  const pts = orig.map((p) => ({ ...p }));
  let d = { ...delta };
  pts[0].x += d.x;
  pts[0].y += d.y;
  for (let i = 1; i < pts.length; i++) {
    const horizontal = Math.abs(orig[i - 1].y - orig[i].y) < 0.5;
    const vertical = Math.abs(orig[i - 1].x - orig[i].x) < 0.5;
    if (horizontal && !vertical) d = { x: 0, y: d.y };
    else if (vertical && !horizontal) d = { x: d.x, y: 0 };
    else break;
    if (d.x === 0 && d.y === 0) break;
    pts[i].x += d.x;
    pts[i].y += d.y;
  }
  return fromStart ? pts : pts.reverse();
}

/** Update waypoints of every edge touching a moved node. */
export function followEdgesAfterMove(
  edges: DEdge[],
  movedIds: Set<string>,
  delta: Point,
  origWps?: Map<string, Point[]>,
): void {
  for (const e of edges) {
    const a = movedIds.has(e.from);
    const b = movedIds.has(e.to);
    if (!a && !b) continue;
    const wps = origWps?.get(e.id) ?? e.waypoints;
    if (wps.length === 0) continue;
    if (a && b) e.waypoints = wps.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y }));
    else e.waypoints = followWaypoints(wps, delta, a);
  }
}

export function polylineLength(pts: Point[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return l;
}

/** Point at the middle of the polyline and the direction of that segment. */
export function polylineMid(pts: Point[]): { p: Point; dir: Point } {
  const total = polylineLength(pts);
  let target = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (target <= seg || i === pts.length - 1) {
      const t = seg === 0 ? 0 : target / seg;
      return {
        p: { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t },
        dir: unit(pts[i - 1], pts[i]),
      };
    }
    target -= seg;
  }
  return { p: pts[0], dir: { x: 1, y: 0 } };
}

/** "Left-hand" perpendicular used for default label / sign placement (above for left-to-right). */
export function perpLeft(dir: Point): Point {
  return { x: dir.y, y: -dir.x };
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export function pointInBox(p: Point, b: Box, pad = 0): boolean {
  return (
    p.x >= b.cx - b.w / 2 - pad && p.x <= b.cx + b.w / 2 + pad && p.y >= b.cy - b.h / 2 - pad && p.y <= b.cy + b.h / 2 + pad
  );
}
