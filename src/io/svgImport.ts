// SVG written by PowerPoint (Copy, or "Save as Picture") -> raw shapes / lines / text.
// PowerPoint draws rectangles as <rect>, ellipses as closed 4-curve <path>s, connectors as
// *filled outline* paths (the arrowheads as separate subpaths, dashes as many small
// subpaths) and text as <text> elements positioned with a translate transform. This module
// recognizes those forms; anything else becomes a block covering its bounding box.

import { Point } from '../model/types';
import { measureText, TEXT_ASCENT, TEXT_DESCENT } from '../render/label';
import { RawLine, RawRun, RawScene, RawShape, RawTextBox, buildDiagram, runsToText, simplify } from './shapeImport';
import type { Diagram } from '../model/types';

type Mat = [number, number, number, number, number, number];
const ID: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
function apply(m: Mat, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
/** length scale of a matrix (geometric mean of the axis scales) */
function scaleOf(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

function parseTransform(s: string | null): Mat {
  let m: Mat = ID;
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(s))) {
    const a = r[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Mat = ID;
    switch (r[1]) {
      case 'matrix':
        if (a.length === 6) t = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case 'translate':
        t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const rad = ((a[0] ?? 0) * Math.PI) / 180;
        const c = Math.cos(rad);
        const sn = Math.sin(rad);
        t = [c, sn, -sn, c, 0, 0];
        if (a.length === 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, t);
  }
  return m;
}

// ---------------------------------------------------------------- inherited presentation
interface Style {
  fill: string;
  stroke: string;
  strokeWidth: number;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dash: boolean;
  opacity: number;
}

function cssProps(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const st = el.getAttribute('style');
  if (st) for (const part of st.split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function styleOf(el: Element, parent: Style): Style {
  const css = cssProps(el);
  const get = (name: string) => css[name] ?? el.getAttribute(name) ?? undefined;
  const s: Style = { ...parent };
  const fill = get('fill');
  if (fill !== undefined) s.fill = fill;
  const stroke = get('stroke');
  if (stroke !== undefined) s.stroke = stroke;
  const sw = get('stroke-width');
  if (sw !== undefined) s.strokeWidth = parseFloat(sw);
  const fs = get('font-size');
  if (fs !== undefined) s.fontSize = parseFloat(fs) * (/pt$/.test(fs) ? 4 / 3 : 1);
  const ff = get('font-family');
  if (ff !== undefined) s.fontFamily = ff;
  const fw = get('font-weight');
  if (fw !== undefined) s.bold = fw === 'bold' || fw === 'bolder' || Number(fw) >= 600;
  const fst = get('font-style');
  if (fst !== undefined) s.italic = fst === 'italic' || fst === 'oblique';
  const td = get('text-decoration');
  if (td !== undefined) s.underline = /underline/.test(td);
  const da = get('stroke-dasharray');
  if (da !== undefined) s.dash = da !== 'none' && da !== '';
  const op = get('opacity');
  if (op !== undefined) s.opacity *= parseFloat(op);
  return s;
}

const ROOT_STYLE: Style = { fill: '#000000', stroke: 'none', strokeWidth: 1, fontSize: 16, fontFamily: 'Arial', bold: false, italic: false, underline: false, dash: false, opacity: 1 };

/** rgb(...) / named / hex -> #rrggbb (or 'none') */
function normColor(c: string): string {
  const s = c.trim();
  if (!s || s === 'none' || s === 'transparent') return 'none';
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + s.slice(1).split('').map((x) => x + x).join('')).toLowerCase();
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (m) return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
  return s;
}

// ---------------------------------------------------------------- paths
interface SubPath {
  points: Point[];
  curves: number;
  closed: boolean;
}

/** absolute vertices of each subpath (curve control points are dropped, end points kept) */
function parsePath(d: string, m: Mat): SubPath[] {
  const toks = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const subs: SubPath[] = [];
  let cur: SubPath | null = null;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let i = 0;
  const n = () => Number(toks[i++]);
  const push = (px: number, py: number) => {
    if (!cur) {
      cur = { points: [], curves: 0, closed: false };
      subs.push(cur);
    }
    cur.points.push(apply(m, { x: px, y: py }));
  };
  // (functions, so TypeScript does not narrow `cur` to null after the assignments below)
  const bump = () => {
    if (cur) cur.curves++;
  };
  const close = () => {
    if (cur) cur.closed = true;
    cur = null;
  };
  let fresh = false; // the command letter was just read (its first coordinates follow)
  while (i < toks.length) {
    const t = toks[i];
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t;
      fresh = true;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        close();
        x = sx;
        y = sy;
        continue;
      }
      continue;
    }
    // further coordinate pairs after a moveto are implicit linetos
    if (!fresh && cmd === 'M') cmd = 'L';
    else if (!fresh && cmd === 'm') cmd = 'l';
    fresh = false;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        cur = null;
        x = ox + n();
        y = oy + n();
        sx = x;
        sy = y;
        push(x, y);
        break;
      case 'L':
        x = ox + n();
        y = oy + n();
        push(x, y);
        break;
      case 'H':
        x = ox + n();
        push(x, y);
        break;
      case 'V':
        y = oy + n();
        push(x, y);
        break;
      case 'C':
        i += 4;
        x = ox + n();
        y = oy + n();
        bump();
        push(x, y);
        break;
      case 'S':
      case 'Q':
        i += 2;
        x = ox + n();
        y = oy + n();
        bump();
        push(x, y);
        break;
      case 'T':
        x = ox + n();
        y = oy + n();
        bump();
        push(x, y);
        break;
      case 'A':
        i += 5;
        x = ox + n();
        y = oy + n();
        bump();
        push(x, y);
        break;
      default:
        i++;
    }
  }
  return subs.filter((s) => s.points.length > 0);
}

function area(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}
function perimeter(pts: Point[]): number {
  let l = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    l += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return l;
}
function bbox(pts: Point[]): { x: number; y: number; w: number; h: number; cx: number; cy: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
function centroid(pts: Point[]): Point {
  const b = bbox(pts);
  return { x: b.cx, y: b.cy };
}

/** center line of a thin outline polygon: vertices are clustered, in the order the outline visits them */
function skeleton(outline: Point[], width: number): Point[] {
  const thr = Math.max(4, width * 2.5 + 1);
  const clusters: { sum: Point; n: number }[] = [];
  for (const p of outline) {
    let hit = false;
    for (const c of clusters) {
      const cx = c.sum.x / c.n;
      const cy = c.sum.y / c.n;
      if (Math.hypot(cx - p.x, cy - p.y) <= thr) {
        c.sum.x += p.x;
        c.sum.y += p.y;
        c.n++;
        hit = true;
        break;
      }
    }
    if (!hit) clusters.push({ sum: { x: p.x, y: p.y }, n: 1 });
  }
  return simplify(
    clusters.map((c) => ({ x: c.sum.x / c.n, y: c.sum.y / c.n })),
    Math.max(1.5, width),
  );
}

// ---------------------------------------------------------------- reading
interface TextItem {
  x: number; // left of the text (after text-anchor)
  baseline: number;
  w: number;
  size: number;
  run: RawRun;
  font: string;
}

interface Collected {
  shapes: RawShape[];
  lines: RawLine[];
  texts: TextItem[];
  images: RawShape[];
  assets: Record<string, string>;
}

function readRect(el: Element, m: Mat, st: Style, out: Collected): void {
  const x = Number(el.getAttribute('x') ?? 0);
  const y = Number(el.getAttribute('y') ?? 0);
  const w = Number(el.getAttribute('width') ?? 0);
  const h = Number(el.getAttribute('height') ?? 0);
  if (w <= 0 || h <= 0) return;
  const corners = [apply(m, { x, y }), apply(m, { x: x + w, y }), apply(m, { x: x + w, y: y + h }), apply(m, { x, y: y + h })];
  const fill = normColor(st.fill);
  const stroke = normColor(st.stroke);
  if (fill === 'none' && stroke === 'none') return;
  // PowerPoint's clip rectangles have neither fill nor stroke; a huge white rectangle is the slide background
  const b = bbox(corners);
  const rx = Number(el.getAttribute('rx') ?? 0) * scaleOf(m);
  const line = Math.hypot(b.w, b.h) > 1.5 && (b.w < 2 || b.h < 2) && fill !== 'none';
  if (line) {
    // a filled hairline rectangle is a straight line segment
    const pts = b.w >= b.h ? [{ x: b.x, y: b.cy }, { x: b.x + b.w, y: b.cy }] : [{ x: b.cx, y: b.y }, { x: b.cx, y: b.y + b.h }];
    out.lines.push({ points: pts, arrowStart: false, arrowEnd: false, color: fill, width: Math.max(0.5, Math.min(b.w, b.h)) });
    return;
  }
  out.shapes.push({
    type: rx > 0 ? 'rounded' : 'block',
    cx: b.cx,
    cy: b.cy,
    w: b.w,
    h: b.h,
    fill,
    stroke,
    strokeWidth: stroke !== 'none' ? st.strokeWidth * scaleOf(m) : undefined,
    radius: rx > 0 ? rx : undefined,
    dash: st.dash ? 'dashed' : undefined,
  });
}

function readEllipse(el: Element, m: Mat, st: Style, out: Collected): void {
  const cx = Number(el.getAttribute('cx') ?? 0);
  const cy = Number(el.getAttribute('cy') ?? 0);
  const rx = Number(el.getAttribute('rx') ?? el.getAttribute('r') ?? 0);
  const ry = Number(el.getAttribute('ry') ?? el.getAttribute('r') ?? 0);
  const pts = [apply(m, { x: cx - rx, y: cy - ry }), apply(m, { x: cx + rx, y: cy + ry })];
  const b = bbox(pts);
  addEllipse(b, normColor(st.fill), normColor(st.stroke), st.strokeWidth * scaleOf(m), out);
}

function addEllipse(b: ReturnType<typeof bbox>, fill: string, stroke: string, strokeWidth: number, out: Collected): void {
  if (fill === 'none' && stroke === 'none') return;
  const small = Math.max(b.w, b.h) <= 12 && stroke === 'none' && fill !== 'none';
  out.shapes.push({
    type: small ? 'junction' : Math.max(b.w, b.h) <= 40 ? 'sum' : 'circle',
    cx: b.cx,
    cy: b.cy,
    w: b.w,
    h: b.h,
    fill,
    stroke: small ? undefined : stroke,
    strokeWidth: stroke !== 'none' && !small ? strokeWidth : undefined,
  });
}

function readPathElement(el: Element, m: Mat, st: Style, out: Collected): void {
  const d = el.getAttribute('d');
  if (!d) return;
  readPolys(parsePath(d, m), st, scaleOf(m), out);
}

function readPolyElement(el: Element, m: Mat, st: Style, out: Collected, closed: boolean): void {
  const nums = (el.getAttribute('points') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const pts: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push(apply(m, { x: nums[i], y: nums[i + 1] }));
  if (pts.length >= 2) readPolys([{ points: pts, curves: 0, closed }], st, scaleOf(m), out);
}

/** classify the subpaths of one path element */
function readPolys(subs: SubPath[], st: Style, k: number, out: Collected): void {
  const fill = normColor(st.fill);
  const stroke = normColor(st.stroke);
  if (subs.length === 0 || (fill === 'none' && stroke === 'none')) return;
  const strokeWidth = st.strokeWidth * k;

  if (fill === 'none') {
    // ordinary stroked geometry (not what PowerPoint writes, but other tools do)
    for (const s of subs) {
      if (s.closed && s.points.length >= 3) classifyPolygon(s, 'none', stroke, strokeWidth, st.dash, out);
      else if (s.points.length >= 2) out.lines.push({ points: s.points, arrowStart: false, arrowEnd: false, color: stroke, width: strokeWidth, dash: st.dash ? 'dashed' : undefined });
    }
    return;
  }

  // filled: PowerPoint's connectors are filled outlines (body + arrowheads, or many dashes)
  const body = subs.reduce((a, b) => (perimeter(b.points) > perimeter(a.points) ? b : a));
  const bArea = area(body.points);
  const bPer = perimeter(body.points);
  const est = bPer > 0 ? (2 * bArea) / bPer : 0; // ≈ line width for a thin outline
  const smalls = subs.filter((s) => s !== body);
  const median = (vals: number[]) => {
    const v = [...vals].sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  };
  const dashed = subs.length > 6 && subs.filter((s) => s.points.length <= 6).length >= subs.length * 0.8 && median(subs.map((s) => perimeter(s.points))) < 40;
  if (dashed) {
    // dashes in drawing order trace the line; the odd big subpath is an arrowhead
    const per = subs.map((s) => perimeter(s.points));
    const med = median(per);
    const dashes = subs.filter((_, i) => per[i] <= med * 2.5);
    const heads = subs.filter((_, i) => per[i] > med * 2.5);
    let pts = simplify(dashes.map((s) => centroid(s.points)), 2.5);
    if (pts.length < 2) return;
    const width = Math.max(0.5, median(dashes.map((s) => Math.min(bbox(s.points).w, bbox(s.points).h))));
    const dashLen = median(dashes.map((s) => Math.max(bbox(s.points).w, bbox(s.points).h)));
    const line: RawLine = { points: pts, arrowStart: false, arrowEnd: false, color: fill, width, dash: dashLen > width * 2 ? 'dashed' : 'dotted' };
    attachHeads(line, heads, width);
    out.lines.push(line);
    return;
  }
  if (body.curves >= 4 && body.closed && body.points.length <= 6) {
    addEllipse(bbox(body.points), fill, stroke, strokeWidth, out);
    return;
  }
  const thin = est > 0 && est < Math.max(4, Math.min(bbox(body.points).w, bbox(body.points).h) * 0.35) && body.points.length >= 4;
  if (thin && stroke === 'none') {
    const pts = skeleton(body.points, est);
    if (pts.length >= 2) {
      const line: RawLine = { points: pts, arrowStart: false, arrowEnd: false, color: fill, width: Math.max(0.5, Math.round(est * 4) / 4) };
      attachHeads(line, smalls, est);
      out.lines.push(line);
      return;
    }
  }
  for (const s of subs) if (s.points.length >= 3) classifyPolygon(s, fill, stroke, strokeWidth, st.dash, out);
}

/** small subpaths near a line end are arrowheads: extend the line to the tip and flag the end */
function attachHeads(line: RawLine, heads: SubPath[], width: number): void {
  for (const h of heads) {
    if (h.points.length < 3 || h.points.length > 8) continue;
    const c = centroid(h.points);
    const pts = line.points;
    const dStart = Math.hypot(c.x - pts[0].x, c.y - pts[0].y);
    const dEnd = Math.hypot(c.x - pts[pts.length - 1].x, c.y - pts[pts.length - 1].y);
    const reach = Math.max(bbox(h.points).w, bbox(h.points).h) * 1.5 + width * 4;
    if (Math.min(dStart, dEnd) > reach) continue;
    const atEnd = dEnd <= dStart;
    const anchor = atEnd ? pts[pts.length - 2] ?? pts[0] : pts[1] ?? pts[pts.length - 1];
    // the tip is the head's vertex farthest from the line
    let tip = h.points[0];
    let best = -1;
    for (const p of h.points) {
      const dd = Math.hypot(p.x - anchor.x, p.y - anchor.y);
      if (dd > best) {
        best = dd;
        tip = p;
      }
    }
    if (atEnd) {
      pts[pts.length - 1] = tip;
      line.arrowEnd = true;
    } else {
      pts[0] = tip;
      line.arrowStart = true;
    }
    if (h.curves >= 4) line.arrowKind = 'dot';
  }
}

function classifyPolygon(s: SubPath, fill: string, stroke: string, strokeWidth: number, dash: boolean, out: Collected): void {
  const pts = simplify(s.points, 0.75);
  if (pts.length >= 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.75) pts.pop();
  const b = bbox(pts);
  if (b.w < 1 && b.h < 1) return;
  const common = { cx: b.cx, cy: b.cy, w: b.w, h: b.h, fill, stroke, strokeWidth: stroke !== 'none' ? strokeWidth : undefined, dash: dash ? ('dashed' as const) : undefined };
  const near = (p: Point, x: number, y: number) => Math.abs(p.x - x) < 1.5 && Math.abs(p.y - y) < 1.5;
  if (pts.length === 4) {
    const onCorners = pts.every((p) => (near(p, b.x, b.y) || near(p, b.x + b.w, b.y) || near(p, b.x + b.w, b.y + b.h) || near(p, b.x, b.y + b.h)));
    if (onCorners) {
      out.shapes.push({ type: 'block', ...common });
      return;
    }
    const onMids = pts.every((p) => near(p, b.cx, b.y) || near(p, b.x + b.w, b.cy) || near(p, b.cx, b.y + b.h) || near(p, b.x, b.cy));
    if (onMids) {
      out.shapes.push({ type: 'diamond', ...common });
      return;
    }
  }
  if (pts.length === 3) {
    const left = pts.filter((p) => p.x < b.cx - b.w * 0.25).length;
    const right = pts.filter((p) => p.x > b.cx + b.w * 0.25).length;
    if (left === 1 && right === 2) {
      out.shapes.push({ type: 'gain', flip: true, ...common });
      return;
    }
    if (right === 1 && left === 2) {
      out.shapes.push({ type: 'gain', ...common });
      return;
    }
  }
  out.shapes.push({ type: 'block', ...common });
}

function readText(el: Element, m: Mat, st: Style, out: Collected): void {
  const content = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!content) return;
  const x = Number(el.getAttribute('x') ?? 0);
  const y = Number(el.getAttribute('y') ?? 0);
  const p = apply(m, { x, y });
  const k = scaleOf(m);
  const size = st.fontSize * k;
  const family = st.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '') || 'Arial';
  const w = measureText(content, size, family, st.bold, st.italic);
  const anchor = el.getAttribute('text-anchor') ?? cssProps(el)['text-anchor'];
  const left = anchor === 'middle' ? p.x - w / 2 : anchor === 'end' ? p.x - w : p.x;
  const fill = normColor(st.fill);
  out.texts.push({
    x: left,
    baseline: p.y,
    w,
    size,
    font: family,
    run: { text: content, bold: st.bold || undefined, italic: st.italic || undefined, underline: st.underline || undefined, color: fill === 'none' ? undefined : fill, size, font: family },
  });
}

function readImage(el: Element, m: Mat, out: Collected): void {
  const href = el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '';
  if (!/^data:image\//i.test(href)) return;
  const x = Number(el.getAttribute('x') ?? 0);
  const y = Number(el.getAttribute('y') ?? 0);
  const w = Number(el.getAttribute('width') ?? 0);
  const h = Number(el.getAttribute('height') ?? 0);
  const b = bbox([apply(m, { x, y }), apply(m, { x: x + w, y: y + h })]);
  const name = `picture${Object.keys(out.assets).length + 1}`;
  out.assets[name] = href;
  out.images.push({ type: 'image', cx: b.cx, cy: b.cy, w: b.w, h: b.h, src: name });
}

function walk(el: Element, m: Mat, st: Style, out: Collected): void {
  const tag = el.localName;
  if (tag === 'defs' || tag === 'clipPath' || tag === 'mask' || tag === 'marker' || tag === 'title' || tag === 'desc' || tag === 'metadata') return;
  const mm = mul(m, parseTransform(el.getAttribute('transform')));
  const s = styleOf(el, st);
  if (s.opacity <= 0.02) return;
  switch (tag) {
    case 'svg':
    case 'g':
    case 'a':
    case 'switch':
      for (const c of Array.from(el.children)) walk(c, mm, s, out);
      break;
    case 'rect':
      readRect(el, mm, s, out);
      break;
    case 'ellipse':
    case 'circle':
      readEllipse(el, mm, s, out);
      break;
    case 'path':
      readPathElement(el, mm, s, out);
      break;
    case 'polygon':
      readPolyElement(el, mm, s, out, true);
      break;
    case 'polyline':
      readPolyElement(el, mm, s, out, false);
      break;
    case 'line': {
      const a = apply(mm, { x: Number(el.getAttribute('x1') ?? 0), y: Number(el.getAttribute('y1') ?? 0) });
      const b = apply(mm, { x: Number(el.getAttribute('x2') ?? 0), y: Number(el.getAttribute('y2') ?? 0) });
      const stroke = normColor(s.stroke);
      if (stroke !== 'none') out.lines.push({ points: [a, b], arrowStart: false, arrowEnd: false, color: stroke, width: s.strokeWidth * scaleOf(mm), dash: s.dash ? 'dashed' : undefined });
      break;
    }
    case 'text':
      readText(el, mm, s, out);
      break;
    case 'image':
      readImage(el, mm, out);
      break;
    case 'use':
    default:
      break;
  }
}

// ---------------------------------------------------------------- text grouping
/** text pieces -> text boxes: pieces on one baseline join into a line, lines stacked closely into one box */
function groupTexts(items: TextItem[]): RawTextBox[] {
  const sorted = [...items].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  // lines: same baseline
  const lines: { items: TextItem[]; baseline: number; size: number; left: number; right: number }[] = [];
  for (const it of sorted) {
    const l = lines[lines.length - 1];
    // same baseline and close by: one line (a wide gap means a separate piece of text)
    if (l && Math.abs(l.baseline - it.baseline) < it.size * 0.4 && it.x - l.right < Math.max(l.size, it.size) * 1.2) {
      l.items.push(it);
      l.left = Math.min(l.left, it.x);
      l.right = Math.max(l.right, it.x + it.w);
      l.size = Math.max(l.size, it.size);
    } else lines.push({ items: [it], baseline: it.baseline, size: it.size, left: it.x, right: it.x + it.w });
  }
  // boxes: consecutive lines that are close and overlap horizontally
  const boxes: (typeof lines)[] = [];
  for (const l of lines) {
    const b = boxes[boxes.length - 1];
    const prev = b?.[b.length - 1];
    if (prev && l.baseline - prev.baseline < Math.max(prev.size, l.size) * 1.7 && l.left < prev.right + prev.size && l.right > prev.left - prev.size) b.push(l);
    else boxes.push([l]);
  }
  return boxes.map((ls) => {
    const runLines: RawRun[][] = ls.map((l) => {
      const runs: RawRun[] = [];
      const its = [...l.items].sort((a, b) => a.x - b.x);
      its.forEach((it, i) => {
        const prev = its[i - 1];
        // a gap between two pieces on one line is a space PowerPoint did not write
        if (prev && it.x - (prev.x + prev.w) > it.size * 0.2) runs.push({ text: ' ' });
        runs.push(it.run);
      });
      return runs;
    });
    const text = runsToText(runLines);
    const size = Math.max(...ls.map((l) => l.size));
    const left = Math.min(...ls.map((l) => l.left));
    const right = Math.max(...ls.map((l) => l.right));
    const top = ls[0].baseline - ls[0].size * TEXT_ASCENT;
    const bottom = ls[ls.length - 1].baseline + ls[ls.length - 1].size * TEXT_DESCENT;
    if (!text.fontSize) text.fontSize = size;
    return { cx: (left + right) / 2, cy: (top + bottom) / 2, w: right - left, h: bottom - top, text };
  });
}

/** Does this look like an SVG document at all? */
export function isSvgText(text: string): boolean {
  return /<svg[\s>]/i.test(text.slice(0, 2000));
}

/** Convert an SVG (as PowerPoint writes it) into a diagram. */
export function diagramFromSvg(svg: string): Diagram {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('Not an SVG picture');
  const out: Collected = { shapes: [], lines: [], texts: [], images: [], assets: {} };
  walk(root, ID, ROOT_STYLE, out);
  // the picture's own background (a rectangle covering everything) is not a block
  if (out.shapes.length > 1) {
    const all = bbox(out.shapes.flatMap((s) => [{ x: s.cx - s.w / 2, y: s.cy - s.h / 2 }, { x: s.cx + s.w / 2, y: s.cy + s.h / 2 }]));
    out.shapes = out.shapes.filter((s) => !(s.type === 'block' && s.w >= all.w - 1 && s.h >= all.h - 1 && s.stroke === 'none'));
  }
  const scene: RawScene = { shapes: [...out.shapes, ...out.images], lines: out.lines, texts: groupTexts(out.texts), assets: out.assets, normalize: true };
  return buildDiagram(scene);
}
