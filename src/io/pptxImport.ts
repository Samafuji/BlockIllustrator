// PowerPoint (.pptx) -> diagrams, one per slide: shapes (DrawingML) become blocks,
// connectors become connections glued to the same shapes, text boxes become labels or
// text nodes, pictures become image nodes. Shapes written by this app's own exporter
// carry their ids and types in name / descr and come back exactly.

import { Point } from '../model/types';
import { RawLine, RawRun, RawScene, RawShape, RawText, RawTextBox, buildDiagram, runsToText } from './shapeImport';
import { EMU_PER_PX } from './pptx';
import { unzip } from './zip';
import { t } from '../i18n';
import type { Diagram, NodeType, TextAlign } from '../model/types';

const dec = new TextDecoder('utf-8');

function parseXml(bytes: Uint8Array | undefined): Document | null {
  if (!bytes) return null;
  const doc = new DOMParser().parseFromString(dec.decode(bytes), 'application/xml');
  return doc.getElementsByTagName('parsererror').length ? null : doc;
}

/** direct children with this local name */
function kids(el: Element | null | undefined, name: string): Element[] {
  if (!el) return [];
  return Array.from(el.children).filter((c) => c.localName === name);
}
function kid(el: Element | null | undefined, name: string): Element | null {
  return kids(el, name)[0] ?? null;
}
function num(el: Element | null | undefined, attr: string, def = 0): number {
  const v = el?.getAttribute(attr);
  return v == null || v === '' ? def : Number(v);
}
const px = (emu: number) => emu / EMU_PER_PX;

// ---------------------------------------------------------------- relationships
function relsOf(files: Map<string, Uint8Array>, partPath: string): Map<string, string> {
  const i = partPath.lastIndexOf('/');
  const dir = partPath.slice(0, i + 1);
  const relPath = `${dir}_rels/${partPath.slice(i + 1)}.rels`;
  const doc = parseXml(files.get(relPath));
  const out = new Map<string, string>();
  if (!doc) return out;
  for (const r of Array.from(doc.getElementsByTagName('Relationship'))) {
    const id = r.getAttribute('Id');
    const target = r.getAttribute('Target');
    if (!id || !target) continue;
    out.set(id, r.getAttribute('TargetMode') === 'External' ? target : resolvePath(dir, target));
  }
  return out;
}

function resolvePath(dir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dir + target).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

// ---------------------------------------------------------------- colors
type Theme = Record<string, string>;

const CLR_MAP: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };

function themeColors(files: Map<string, Uint8Array>): Theme {
  const theme: Theme = { dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72' };
  const path = [...files.keys()].find((k) => /^ppt\/theme\/theme\d*\.xml$/.test(k));
  const doc = path ? parseXml(files.get(path)) : null;
  const scheme = doc ? doc.getElementsByTagNameNS('*', 'clrScheme')[0] : null;
  if (scheme) {
    for (const c of Array.from(scheme.children)) {
      const v = c.firstElementChild;
      if (!v) continue;
      const hex = v.localName === 'srgbClr' ? v.getAttribute('val') : v.getAttribute('lastClr');
      if (hex) theme[c.localName] = hex.toUpperCase();
    }
  }
  return theme;
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  return [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function applyLum(hex: string, lumMod: number, lumOff: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const dd = max - min;
    s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
    if (max === r) h = ((g - b) / dd + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / dd + 2) / 6;
    else h = ((r - g) / dd + 4) / 6;
  }
  l = Math.max(0, Math.min(1, l * lumMod + lumOff));
  const hue = (p: number, q: number, tt: number) => {
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let rr: number;
  let gg: number;
  let bb: number;
  if (s === 0) rr = gg = bb = l;
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rr = hue(p, q, h + 1 / 3);
    gg = hue(p, q, h);
    bb = hue(p, q, h - 1 / 3);
  }
  return rgbToHex(rr * 255, gg * 255, bb * 255);
}

/** a:srgbClr / a:schemeClr / a:sysClr / a:prstClr (with lumMod / lumOff) -> "#rrggbb" or "#rrggbbaa" */
function colorOf(el: Element | null, theme: Theme): string | undefined {
  if (!el) return undefined;
  let hex: string | undefined;
  switch (el.localName) {
    case 'srgbClr':
      hex = el.getAttribute('val') ?? undefined;
      break;
    case 'sysClr':
      hex = el.getAttribute('lastClr') ?? undefined;
      break;
    case 'schemeClr': {
      const v = el.getAttribute('val') ?? '';
      hex = theme[CLR_MAP[v] ?? v];
      break;
    }
    case 'prstClr': {
      const c = document.createElement('canvas').getContext('2d');
      if (c) {
        c.fillStyle = '#000';
        c.fillStyle = el.getAttribute('val') ?? '';
        hex = String(c.fillStyle).replace('#', '');
      }
      break;
    }
  }
  if (!hex) return undefined;
  hex = hex.toLowerCase().slice(0, 6);
  const lumMod = num(kid(el, 'lumMod'), 'val', 100000) / 100000;
  const lumOff = num(kid(el, 'lumOff'), 'val', 0) / 100000;
  if (lumMod !== 1 || lumOff !== 0) hex = applyLum(hex, lumMod, lumOff);
  const alpha = num(kid(el, 'alpha'), 'val', 100000) / 100000;
  if (alpha < 1) hex += Math.round(alpha * 255).toString(16).padStart(2, '0');
  return '#' + hex;
}

/** fill of a spPr-like element: 'none', a color, or undefined (not given) */
function fillOf(el: Element | null, theme: Theme): string | undefined {
  if (!el) return undefined;
  for (const c of Array.from(el.children)) {
    if (c.localName === 'noFill') return 'none';
    if (c.localName === 'solidFill') return colorOf(c.firstElementChild, theme);
    if (c.localName === 'gradFill') {
      const gs = c.getElementsByTagNameNS('*', 'gs')[0];
      return colorOf(gs?.firstElementChild ?? null, theme);
    }
    if (c.localName === 'blipFill' || c.localName === 'pattFill') return undefined;
  }
  return undefined;
}

interface LineProps {
  color?: string;
  width?: number;
  dash?: 'solid' | 'dashed' | 'dotted';
  head?: string;
  tail?: string;
  given: boolean;
}

function lineOf(ln: Element | null, theme: Theme): LineProps {
  if (!ln) return { given: false };
  const out: LineProps = { given: true };
  const w = ln.getAttribute('w');
  if (w) out.width = px(Number(w));
  const fill = fillOf(ln, theme);
  if (fill !== undefined) out.color = fill;
  const dash = kid(ln, 'prstDash')?.getAttribute('val');
  if (dash) out.dash = /dot/i.test(dash) ? 'dotted' : dash === 'solid' ? 'solid' : 'dashed';
  out.head = kid(ln, 'headEnd')?.getAttribute('type') ?? undefined;
  out.tail = kid(ln, 'tailEnd')?.getAttribute('type') ?? undefined;
  return out;
}

/** p:style -> colors from the theme (fillRef / lnRef / fontRef) */
function styleRefs(style: Element | null, theme: Theme): { fill?: string; line?: string; lineIdx: number; text?: string } {
  if (!style) return { lineIdx: 0 };
  const fillRef = kid(style, 'fillRef');
  const lnRef = kid(style, 'lnRef');
  const fontRef = kid(style, 'fontRef');
  return {
    fill: num(fillRef, 'idx') > 0 ? colorOf(fillRef?.firstElementChild ?? null, theme) : num(fillRef, 'idx') === 0 ? 'none' : undefined,
    line: num(lnRef, 'idx') > 0 ? colorOf(lnRef?.firstElementChild ?? null, theme) : num(lnRef, 'idx') === 0 ? 'none' : undefined,
    lineIdx: num(lnRef, 'idx'),
    text: colorOf(fontRef?.firstElementChild ?? null, theme),
  };
}

// ---------------------------------------------------------------- text
function textOf(txBody: Element | null, theme: Theme, defaultColor?: string): RawText | undefined {
  if (!txBody) return undefined;
  const lines: RawRun[][] = [];
  let align: TextAlign | undefined;
  for (const p of kids(txBody, 'p')) {
    const algn = kid(p, 'pPr')?.getAttribute('algn');
    if (algn === 'l') align = 'left';
    else if (algn === 'r') align = 'right';
    let line: RawRun[] = [];
    for (const c of Array.from(p.children)) {
      if (c.localName === 'br') {
        lines.push(line);
        line = [];
        continue;
      }
      if (c.localName !== 'r' && c.localName !== 'fld') continue;
      const text = kid(c, 't')?.textContent ?? '';
      if (!text) continue;
      const rPr = kid(c, 'rPr');
      const sz = rPr?.getAttribute('sz');
      const color = fillOf(rPr, theme);
      line.push({
        text,
        bold: rPr?.getAttribute('b') === '1',
        italic: rPr?.getAttribute('i') === '1',
        underline: !!rPr?.getAttribute('u') && rPr.getAttribute('u') !== 'none',
        size: sz ? Number(sz) / 100 / 0.75 : undefined,
        color: color && color !== 'none' ? color : defaultColor,
        font: kid(rPr, 'latin')?.getAttribute('typeface') ?? undefined,
      });
    }
    lines.push(line);
  }
  while (lines.length && lines[lines.length - 1].length === 0) lines.pop();
  if (!lines.some((l) => l.some((r) => r.text.trim()))) return undefined;
  const txt = runsToText(lines);
  if (align) txt.align = align;
  return txt;
}

// ---------------------------------------------------------------- geometry
interface Xf {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
}

/** mapping of a group's child coordinates to its parent */
interface Mapper {
  (p: Point): Point;
  sx: number;
  sy: number;
}
const identity: Mapper = Object.assign((p: Point) => p, { sx: 1, sy: 1 });

function xfrmOf(spPr: Element | null, map: Mapper): Xf | null {
  const xf = kid(spPr, 'xfrm');
  const off = kid(xf, 'off');
  const ext = kid(xf, 'ext');
  if (!xf || !off || !ext) return null;
  const o = map({ x: px(num(off, 'x')), y: px(num(off, 'y')) });
  return {
    x: o.x,
    y: o.y,
    w: px(num(ext, 'cx')) * map.sx,
    h: px(num(ext, 'cy')) * map.sy,
    rot: num(xf, 'rot') / 60000,
    flipH: xf.getAttribute('flipH') === '1',
    flipV: xf.getAttribute('flipV') === '1',
  };
}

/** points of a custGeom path (moveTo / lnTo / bezier end points), in shape pixels */
function customPath(spPr: Element | null, xf: Xf): { points: Point[]; closed: boolean } | null {
  const path = kid(spPr, 'custGeom') ? kid(spPr, 'custGeom')!.getElementsByTagNameNS('*', 'path')[0] : null;
  if (!path) return null;
  const pw = num(path, 'w') || 1;
  const ph = num(path, 'h') || 1;
  const points: Point[] = [];
  let closed = false;
  const toPt = (pt: Element | null) => (pt ? { x: xf.x + (num(pt, 'x') / pw) * xf.w, y: xf.y + (num(pt, 'y') / ph) * xf.h } : null);
  for (const c of Array.from(path.children)) {
    if (c.localName === 'close') closed = true;
    else if (c.localName === 'moveTo' || c.localName === 'lnTo') {
      const p = toPt(kid(c, 'pt'));
      if (p) points.push(p);
    } else if (c.localName === 'cubicBezTo' || c.localName === 'quadBezTo') {
      const pts = kids(c, 'pt');
      const p = toPt(pts[pts.length - 1] ?? null);
      if (p) points.push(p);
    } else if (c.localName === 'arcTo') {
      /* arcs are skipped (rare in diagrams) */
    }
  }
  return { points, closed };
}

const BLOCK_PRESETS = new Set(['rect', 'snip1Rect', 'snip2SameRect', 'snip2DiagRect', 'snipRoundRect', 'round1Rect', 'round2SameRect', 'round2DiagRect', 'flowChartProcess', 'flowChartPredefinedProcess', 'flowChartInternalStorage', 'homePlate', 'chevron', 'plaque', 'can', 'cube', 'bevel', 'frame', 'parallelogram', 'trapezoid', 'hexagon', 'octagon', 'pentagon', 'flowChartDocument', 'flowChartTerminator', 'flowChartData']);

function typeOfPreset(prst: string, xf: Xf, text: RawText | undefined): { type: NodeType; radius?: number; sumStyle?: 'plain' | 'cross' | 'sigma'; flip?: boolean } | null {
  if (prst === 'roundRect') return { type: 'rounded' };
  if (prst === 'ellipse' || prst === 'flowChartConnector') {
    const small = Math.max(xf.w, xf.h) <= 40;
    const label = text?.text.trim() ?? '';
    if (small && (label === '' || label === '+' || label === 'Σ' || label === '×' || label === '-' || label === '−')) return { type: 'sum', sumStyle: label === 'Σ' ? 'sigma' : 'plain' };
    return { type: 'circle' };
  }
  if (prst === 'diamond' || prst === 'flowChartDecision') return { type: 'diamond' };
  if (prst === 'triangle') {
    const r = ((Math.round(xf.rot / 90) * 90) % 360 + 360) % 360;
    return { type: 'gain', flip: r === 270 !== xf.flipH };
  }
  if (BLOCK_PRESETS.has(prst) || /^flowChart|^action|Rect$/.test(prst)) return { type: 'block' };
  return null;
}

// ---------------------------------------------------------------- shapes
interface Ctx {
  files: Map<string, Uint8Array>;
  theme: Theme;
  rels: Map<string, string>;
  scene: RawScene;
  assetSeq: number;
}

function bdHint(cNvPr: Element | null): { kind: string; name: string; hidden: boolean } | null {
  const descr = cNvPr?.getAttribute('descr') ?? '';
  const m = /^bd:(\w+)( hidden)?/.exec(descr);
  if (!m) return null;
  return { kind: m[1], name: cNvPr?.getAttribute('name') ?? '', hidden: !!m[2] };
}

function readShape(ctx: Ctx, sp: Element, map: Mapper): void {
  const nv = kid(sp, 'nvSpPr');
  const cNvPr = kid(nv, 'cNvPr');
  const spPr = kid(sp, 'spPr');
  const xf = xfrmOf(spPr, map);
  if (!xf || cNvPr?.getAttribute('hidden') === '1') return;
  const ref = `s${cNvPr?.getAttribute('id') ?? ''}`;
  const hint = bdHint(cNvPr);
  if (hint?.kind === 'deco') return;
  const style = styleRefs(kid(sp, 'style'), ctx.theme);
  const txBody = kid(sp, 'txBody');
  const text = textOf(txBody, ctx.theme, style.text);
  let fill = fillOf(spPr, ctx.theme);
  if (fill === undefined) fill = style.fill;
  const lnEl = kid(spPr, 'ln');
  const ln = lineOf(lnEl, ctx.theme);
  let stroke = ln.color;
  if (stroke === undefined && !lnEl?.children.length) stroke = style.line;
  else if (stroke === undefined && ln.given) stroke = style.line;
  const strokeWidth = ln.width ?? (style.lineIdx > 0 ? [0.5 / 0.75, 1 / 0.75, 1.5 / 0.75][Math.min(style.lineIdx, 3) - 1] : undefined);
  const prst = kid(spPr, 'prstGeom')?.getAttribute('prst') ?? null;
  const isTxBox = kid(nv, 'cNvSpPr')?.getAttribute('txBox') === '1';
  const cx = xf.x + xf.w / 2;
  const cy = xf.y + xf.h / 2;
  const rot = ((Math.round(xf.rot / 90) * 90) % 360 + 360) % 360;

  // our own labels / signs / captions come back to their lines and shapes
  if (hint && (hint.kind === 'label' || hint.kind === 'sign' || hint.kind === 'caption')) {
    const m = /^(.+)\.(label|sign)$/.exec(hint.name);
    if (text) ctx.scene.texts.push({ hint: hint.kind as 'label' | 'sign' | 'caption', target: m ? m[1] : hint.name, cx, cy, w: xf.w, h: xf.h, text });
    return;
  }
  if (hint?.kind === 'text') {
    // a text node of this app: a shape lines can attach to
    if (text) ctx.scene.shapes.push({ type: 'text', id: hint.name, ref, cx, cy, w: xf.w, h: xf.h, text, rotate: rot || undefined });
    return;
  }
  if (isTxBox || (prst === 'rect' && (fill === 'none' || fill === undefined) && (stroke === 'none' || stroke === undefined) && text)) {
    if (text) ctx.scene.texts.push({ ref, cx, cy, w: xf.w, h: xf.h, text });
    return;
  }

  // freeform lines (open paths without fill)
  const custom = customPath(spPr, xf);
  if (custom && !custom.closed && (fill === 'none' || fill === undefined) && custom.points.length >= 2) {
    const line: RawLine = {
      ref,
      id: hint?.kind === 'edge' ? hint.name : undefined,
      points: custom.points,
      arrowStart: !!ln.head && ln.head !== 'none',
      arrowEnd: !!ln.tail && ln.tail !== 'none',
      arrowKind: arrowKind(ln.tail ?? ln.head),
      color: stroke && stroke !== 'none' ? stroke : undefined,
      width: strokeWidth,
      dash: ln.dash,
    };
    ctx.scene.lines.push(line);
    return;
  }

  let kind: { type: NodeType; radius?: number; sumStyle?: 'plain' | 'cross' | 'sigma'; flip?: boolean } | null = null;
  if (hint && ['block', 'rounded', 'circle', 'diamond', 'gain', 'sum', 'junction', 'image'].includes(hint.kind)) kind = { type: hint.kind as NodeType };
  else if (prst) kind = typeOfPreset(prst, xf, text) ?? { type: 'block' };
  else if (custom) {
    const pts = custom.points;
    if (pts.length === 3 || (pts.length === 4 && Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y) < 1)) {
      // a triangle: the apex is the lone vertex on one side
      const xs = pts.slice(0, 3).map((p) => p.x);
      const left = xs.filter((x) => x < cx).length;
      kind = { type: 'gain', flip: left === 1 };
    } else kind = { type: 'block' };
  }
  if (!kind) return;
  const shape: RawShape = {
    type: kind.type,
    id: hint ? hint.name : undefined,
    ref,
    cx,
    cy,
    w: rot === 90 || rot === 270 ? xf.h : xf.w,
    h: rot === 90 || rot === 270 ? xf.w : xf.h,
    text,
    rotate: rot || undefined,
    flip: kind.flip || (hint?.kind === 'gain' && xf.flipH) || undefined,
    sumStyle: kind.sumStyle,
    hidden: hint?.hidden || undefined,
  };
  if (kind.type === 'sum' && text && (text.text === '+' || text.text === 'Σ')) shape.text = undefined;
  if (kind.type === 'sum' && text?.text === 'Σ') shape.sumStyle = 'sigma';
  if (fill !== undefined) shape.fill = fill;
  if (stroke !== undefined) shape.stroke = stroke;
  if (strokeWidth !== undefined && stroke !== 'none') shape.strokeWidth = strokeWidth;
  if (ln.dash && ln.dash !== 'solid') shape.dash = ln.dash;
  if (kind.type === 'rounded' || prst === 'roundRect') {
    const adj = kid(spPr, 'prstGeom')?.getElementsByTagNameNS('*', 'gd')[0]?.getAttribute('fmla');
    const val = adj ? Number(adj.replace('val ', '')) : 16667;
    shape.radius = (Math.min(xf.w, xf.h) * val) / 100000;
  }
  if (kind.type === 'junction') {
    shape.fill = shape.hidden ? undefined : fill === 'none' ? undefined : fill;
    shape.stroke = undefined;
    shape.strokeWidth = undefined;
    if (shape.hidden) {
      shape.w = 0;
      shape.h = 0;
    }
  }
  ctx.scene.shapes.push(shape);
}

function arrowKind(type: string | undefined): 'triangle' | 'open' | 'dot' | undefined {
  if (!type || type === 'none') return undefined;
  if (type === 'arrow') return 'open';
  if (type === 'oval' || type === 'diamond') return 'dot';
  return 'triangle';
}

function readConnector(ctx: Ctx, cxn: Element, map: Mapper): void {
  const nv = kid(cxn, 'nvCxnSpPr');
  const cNvPr = kid(nv, 'cNvPr');
  const cNv = kid(nv, 'cNvCxnSpPr');
  const spPr = kid(cxn, 'spPr');
  const xf = xfrmOf(spPr, map);
  if (!xf) return;
  const hint = bdHint(cNvPr);
  if (hint?.kind === 'deco') return;
  const style = styleRefs(kid(cxn, 'style'), ctx.theme);
  const ln = lineOf(kid(spPr, 'ln'), ctx.theme);
  const color = ln.color ?? style.line;
  const width = ln.width ?? (style.lineIdx > 0 ? [0.5 / 0.75, 1 / 0.75, 1.5 / 0.75][Math.min(style.lineIdx, 3) - 1] : undefined);
  const prst = kid(spPr, 'prstGeom')?.getAttribute('prst') ?? 'straightConnector1';
  // the connector's box: start at one corner, end at the opposite one (flips choose which)
  let start = { x: xf.x + (xf.flipH ? xf.w : 0), y: xf.y + (xf.flipV ? xf.h : 0) };
  let end = { x: xf.x + (xf.flipH ? 0 : xf.w), y: xf.y + (xf.flipV ? 0 : xf.h) };
  const points: Point[] = [start];
  const rot = ((Math.round(xf.rot / 90) * 90) % 360 + 360) % 360;
  if (rot) {
    // turned connector frame: turn the corner points around the center
    const c = { x: xf.x + xf.w / 2, y: xf.y + xf.h / 2 };
    const turn = (p: Point): Point => {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      if (rot === 90) return { x: c.x - dy, y: c.y + dx };
      if (rot === 180) return { x: c.x - dx, y: c.y - dy };
      return { x: c.x + dy, y: c.y - dx };
    };
    start = turn(start);
    end = turn(end);
    points[0] = start;
  }
  if (!rot && /^bentConnector[2-5]$/.test(prst)) {
    // the bends of a bent connector (bentConnector2: one corner; 3: two with an adjustable middle)
    const adj = kid(spPr, 'prstGeom')?.getElementsByTagNameNS('*', 'gd')[0]?.getAttribute('fmla');
    const f = adj ? Number(adj.replace('val ', '')) / 100000 : 0.5;
    if (prst === 'bentConnector2') points.push({ x: end.x, y: start.y });
    else if (prst === 'bentConnector3') {
      const mx = start.x + (end.x - start.x) * f;
      points.push({ x: mx, y: start.y }, { x: mx, y: end.y });
    }
  }
  points.push(end);
  const st = kid(cNv, 'stCxn');
  const en = kid(cNv, 'endCxn');
  ctx.scene.lines.push({
    ref: `s${cNvPr?.getAttribute('id') ?? ''}`,
    id: hint?.kind === 'edge' ? hint.name : undefined,
    points,
    fromRef: st ? `s${st.getAttribute('id')}` : undefined,
    toRef: en ? `s${en.getAttribute('id')}` : undefined,
    arrowStart: !!ln.head && ln.head !== 'none',
    arrowEnd: !!ln.tail && ln.tail !== 'none',
    arrowKind: arrowKind(ln.tail ?? ln.head),
    color: color && color !== 'none' ? color : undefined,
    width,
    dash: ln.dash,
  });
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${mime};base64,${btoa(bin)}`;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp' };

function readPicture(ctx: Ctx, pic: Element, map: Mapper): void {
  const nv = kid(pic, 'nvPicPr');
  const cNvPr = kid(nv, 'cNvPr');
  const spPr = kid(pic, 'spPr');
  const xf = xfrmOf(spPr, map);
  if (!xf) return;
  const hint = bdHint(cNvPr);
  const blip = kid(pic, 'blipFill') ? kid(pic, 'blipFill')!.getElementsByTagNameNS('*', 'blip')[0] : null;
  const rId = blip?.getAttribute('r:embed') ?? blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
  const target = rId ? ctx.rels.get(rId) : undefined;
  const bytes = target ? ctx.files.get(target) : undefined;
  const ext = target ? target.replace(/^.*\./, '').toLowerCase() : '';
  let src: string | undefined;
  if (bytes && MIME[ext]) {
    const base = (hint?.name || cNvPr?.getAttribute('name') || `image${++ctx.assetSeq}`).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || `image${++ctx.assetSeq}`;
    let name = /^[A-Za-z_]/.test(base) ? base : `img_${base}`;
    let i = 2;
    while (ctx.scene.assets[name] !== undefined) name = `${base}_${i++}`;
    ctx.scene.assets[name] = bytesToDataUrl(bytes, MIME[ext]);
    src = name;
  }
  const ln = lineOf(kid(spPr, 'ln'), ctx.theme);
  ctx.scene.shapes.push({
    type: 'image',
    id: hint ? hint.name : undefined,
    ref: `s${cNvPr?.getAttribute('id') ?? ''}`,
    cx: xf.x + xf.w / 2,
    cy: xf.y + xf.h / 2,
    w: xf.w,
    h: xf.h,
    src: src ?? (cNvPr?.getAttribute('name') ?? 'image'),
    stroke: ln.color && ln.color !== 'none' ? ln.color : undefined,
    strokeWidth: ln.color && ln.color !== 'none' ? ln.width : undefined,
  });
}

function readTree(ctx: Ctx, tree: Element, map: Mapper): void {
  for (const c of Array.from(tree.children)) {
    switch (c.localName) {
      case 'sp':
        readShape(ctx, c, map);
        break;
      case 'cxnSp':
        readConnector(ctx, c, map);
        break;
      case 'pic':
        readPicture(ctx, c, map);
        break;
      case 'grpSp': {
        const gp = kid(c, 'grpSpPr');
        const xf = kid(gp, 'xfrm');
        const off = kid(xf, 'off');
        const ext = kid(xf, 'ext');
        const chOff = kid(xf, 'chOff');
        const chExt = kid(xf, 'chExt');
        let inner: Mapper = map;
        if (off && ext && chOff && chExt && num(chExt, 'cx') && num(chExt, 'cy')) {
          const sx = num(ext, 'cx') / num(chExt, 'cx');
          const sy = num(ext, 'cy') / num(chExt, 'cy');
          const o = { x: px(num(off, 'x')), y: px(num(off, 'y')) };
          const co = { x: px(num(chOff, 'x')), y: px(num(chOff, 'y')) };
          inner = Object.assign((p: Point) => map({ x: o.x + (p.x - co.x) * sx, y: o.y + (p.y - co.y) * sy }), { sx: map.sx * sx, sy: map.sy * sy });
        }
        readTree(ctx, c, inner);
        break;
      }
      case 'graphicFrame':
      case 'AlternateContent':
      default:
        break;
    }
  }
}

/** Shapes of one slide document -> raw scene. */
function sceneOfSlide(files: Map<string, Uint8Array>, theme: Theme, slidePath: string): { scene: RawScene; origin: { x: number; y: number; scale: number; off: Point } | null } | null {
  const doc = parseXml(files.get(slidePath));
  if (!doc) return null;
  const cSld = doc.getElementsByTagNameNS('*', 'cSld')[0];
  const tree = doc.getElementsByTagNameNS('*', 'spTree')[0];
  if (!tree) return null;
  const ctx: Ctx = { files, theme, rels: relsOf(files, slidePath), scene: { shapes: [], lines: [], texts: [], assets: {}, normalize: true }, assetSeq: 0 };
  readTree(ctx, tree, identity);
  // a slide written by this app records where the diagram's coordinates were
  const m = /BlockIllustrator origin=\(([-\d.]+),([-\d.]+)\) scale=([\d.e-]+) offset=\(([-\d.]+),([-\d.]+)\)/.exec(cSld?.getAttribute('name') ?? '');
  const origin = m ? { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]), off: { x: px(Number(m[4])), y: px(Number(m[5])) } } : null;
  return { scene: ctx.scene, origin };
}

export interface ImportedSlide {
  title: string;
  diagram: Diagram;
}

/** Every slide with shapes becomes a diagram. */
export async function diagramsFromPptx(blob: Blob): Promise<ImportedSlide[]> {
  const files = await unzip(blob);
  const pres = parseXml(files.get('ppt/presentation.xml'));
  if (!pres) throw new Error('Not a PowerPoint file (ppt/presentation.xml missing)');
  const rels = relsOf(files, 'ppt/presentation.xml');
  const theme = themeColors(files);
  const slides: string[] = [];
  for (const sld of Array.from(pres.getElementsByTagNameNS('*', 'sldId'))) {
    const rId = sld.getAttribute('r:id') ?? sld.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const path = rId ? rels.get(rId) : undefined;
    if (path) slides.push(path);
  }
  const out: ImportedSlide[] = [];
  slides.forEach((path, i) => {
    const res = sceneOfSlide(files, theme, path);
    if (!res) return;
    const { scene, origin } = res;
    if (scene.shapes.length + scene.lines.length + scene.texts.length === 0) return;
    if (origin && origin.scale > 0) {
      // undo the centering / scaling of the export so the .bd coordinates come back
      const back = (p: { cx: number; cy: number }) => {
        p.cx = (p.cx - origin.off.x) / origin.scale + origin.x;
        p.cy = (p.cy - origin.off.y) / origin.scale + origin.y;
      };
      for (const s of scene.shapes) {
        back(s);
        s.w /= origin.scale;
        s.h /= origin.scale;
        if (s.text?.fontSize) s.text.fontSize /= origin.scale;
        if (s.strokeWidth) s.strokeWidth /= origin.scale;
        if (s.radius) s.radius /= origin.scale;
      }
      for (const l of scene.lines) {
        l.points = l.points.map((p) => ({ x: (p.x - origin.off.x) / origin.scale + origin.x, y: (p.y - origin.off.y) / origin.scale + origin.y }));
        if (l.width) l.width /= origin.scale;
      }
      for (const tb of scene.texts) {
        back(tb);
        tb.w /= origin.scale;
        tb.h /= origin.scale;
        if (tb.text.fontSize) tb.text.fontSize /= origin.scale;
      }
      scene.normalize = false;
    }
    out.push({ title: t('スライド {n}', { n: i + 1 }), diagram: buildDiagram(scene) });
  });
  return out;
}

export type { RawTextBox };
