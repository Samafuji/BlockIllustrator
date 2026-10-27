// SVG -> EPS (Encapsulated PostScript) converter for the subset of SVG that
// Block Illustrator produces: rect, circle, ellipse, line, polyline, polygon,
// path (all commands incl. arcs), text and nested <g transform>.
// Text uses the PostScript standard fonts (Times / Helvetica / Courier) with
// ISO Latin-1 encoding; characters outside Latin-1 are replaced by '?'.
// <image> elements are written as 8-bit RGB `colorimage` data when the caller
// supplies their decoded samples (see export.ts).

type M = [number, number, number, number, number, number]; // a b c d e f

/** Decoded picture: RGB samples, row-major from the top-left, 3 bytes per pixel. */
export interface RasterImage {
  w: number;
  h: number;
  rgb: Uint8Array;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function toHex(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  const perLine = 36; // 72 hex characters per line
  for (let i = 0; i < bytes.length; i += perLine) {
    let s = '';
    const end = Math.min(bytes.length, i + perLine);
    for (let j = i; j < end; j++) s += HEX[bytes[j]];
    lines.push(s);
  }
  return lines;
}

interface Ctx {
  m: M;
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash?: string;
  linecap: string;
  linejoin: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  color: string;
}

const I: M = [1, 0, 0, 1, 0, 0];

function mul(a: M, b: M): M {
  // a * b  (apply b first, then a)
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function apply(m: M, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function scaleOf(m: M): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

function parseTransform(s: string | null): M {
  if (!s) return I;
  let m: M = I;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(s))) {
    const a = r[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t: M = I;
    switch (r[1]) {
      case 'matrix':
        if (a.length === 6) t = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case 'translate':
        t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
        break;
      case 'scale':
        t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const rad = ((a[0] || 0) * Math.PI) / 180;
        const c = Math.cos(rad);
        const sn = Math.sin(rad);
        const rot: M = [c, sn, -sn, c, 0, 0];
        if (a.length >= 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], rot), [1, 0, 0, 1, -a[1], -a[2]]);
        else t = rot;
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, t);
  }
  return m;
}

let colorCtx: CanvasRenderingContext2D | null = null;
function toRgb(c: string): [number, number, number] | null {
  if (!c || c === 'none' || c === 'transparent') return null;
  const s = c.trim();
  let hex = '';
  if (/^#[0-9a-fA-F]{3}$/.test(s)) hex = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  else if (/^#[0-9a-fA-F]{6}$/.test(s)) hex = s;
  else if (/^#[0-9a-fA-F]{8}$/.test(s)) hex = s.slice(0, 7);
  else {
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(s);
    if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
    if (!colorCtx) colorCtx = document.createElement('canvas').getContext('2d');
    if (colorCtx) {
      colorCtx.fillStyle = '#000';
      colorCtx.fillStyle = s;
      const v = colorCtx.fillStyle;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) hex = v;
    }
  }
  if (!hex) return null;
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

function f(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

// ---------------------------------------------------------------- path data

interface Seg {
  kind: 'M' | 'L' | 'C' | 'Z';
  pts: number[];
}

/** Parse SVG path data into absolute M/L/C/Z segments (Q/T/A/H/V/S converted). */
function parsePath(d: string): Seg[] {
  const out: Seg[] = [];
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  let cmd = '';
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl: [number, number] | null = null;
  let lastCmd = '';
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/[a-zA-Z]/.test(tokens[i]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    switch (C) {
      case 'M': {
        let x = num();
        let y = num();
        if (rel) {
          x += cx;
          y += cy;
        }
        cx = sx = x;
        cy = sy = y;
        out.push({ kind: 'M', pts: [x, y] });
        lastCtrl = null;
        break;
      }
      case 'L': {
        let x = num();
        let y = num();
        if (rel) {
          x += cx;
          y += cy;
        }
        cx = x;
        cy = y;
        out.push({ kind: 'L', pts: [x, y] });
        lastCtrl = null;
        break;
      }
      case 'H': {
        let x = num();
        if (rel) x += cx;
        cx = x;
        out.push({ kind: 'L', pts: [x, cy] });
        lastCtrl = null;
        break;
      }
      case 'V': {
        let y = num();
        if (rel) y += cy;
        cy = y;
        out.push({ kind: 'L', pts: [cx, y] });
        lastCtrl = null;
        break;
      }
      case 'C': {
        let x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
        if (rel) {
          x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy;
        }
        out.push({ kind: 'C', pts: [x1, y1, x2, y2, x, y] });
        lastCtrl = [x2, y2];
        cx = x;
        cy = y;
        break;
      }
      case 'S': {
        let x2 = num(), y2 = num(), x = num(), y = num();
        if (rel) {
          x2 += cx; y2 += cy; x += cx; y += cy;
        }
        const refl: [number, number] = lastCtrl && /[CS]/i.test(lastCmd) ? [2 * cx - lastCtrl[0], 2 * cy - lastCtrl[1]] : [cx, cy];
        out.push({ kind: 'C', pts: [refl[0], refl[1], x2, y2, x, y] });
        lastCtrl = [x2, y2];
        cx = x;
        cy = y;
        break;
      }
      case 'Q': {
        let qx = num(), qy = num(), x = num(), y = num();
        if (rel) {
          qx += cx; qy += cy; x += cx; y += cy;
        }
        out.push(quadToCubic(cx, cy, qx, qy, x, y));
        lastCtrl = [qx, qy];
        cx = x;
        cy = y;
        break;
      }
      case 'T': {
        let x = num(), y = num();
        if (rel) {
          x += cx; y += cy;
        }
        const q: [number, number] = lastCtrl && /[QT]/i.test(lastCmd) ? [2 * cx - lastCtrl[0], 2 * cy - lastCtrl[1]] : [cx, cy];
        out.push(quadToCubic(cx, cy, q[0], q[1], x, y));
        lastCtrl = q;
        cx = x;
        cy = y;
        break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
        let x = num(), y = num();
        if (rel) {
          x += cx; y += cy;
        }
        for (const seg of arcToCubics(cx, cy, rx, ry, rot, large !== 0, sweep !== 0, x, y)) out.push(seg);
        cx = x;
        cy = y;
        lastCtrl = null;
        break;
      }
      case 'Z': {
        out.push({ kind: 'Z', pts: [] });
        cx = sx;
        cy = sy;
        lastCtrl = null;
        break;
      }
      default:
        i = tokens.length;
    }
    lastCmd = C;
    if (C === 'Z' && isNum()) cmd = 'L';
  }
  return out;
}

function quadToCubic(x0: number, y0: number, qx: number, qy: number, x: number, y: number): Seg {
  return {
    kind: 'C',
    pts: [x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y],
  };
}

function arcToCubics(x1: number, y1: number, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, x2: number, y2: number): Seg[] {
  if (rx === 0 || ry === 0) return [{ kind: 'L', pts: [x2, y2] }];
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2)));
  const out: Seg[] = [];
  const delta = dth / n;
  let th = th1;
  for (let k = 0; k < n; k++) {
    const t2 = th + delta;
    const kappa = (4 / 3) * Math.tan(delta / 4);
    const p = (a: number) => [cx + rx * Math.cos(a) * cosP - ry * Math.sin(a) * sinP, cy + rx * Math.cos(a) * sinP + ry * Math.sin(a) * cosP];
    const dp = (a: number) => [-rx * Math.sin(a) * cosP - ry * Math.cos(a) * sinP, -rx * Math.sin(a) * sinP + ry * Math.cos(a) * cosP];
    const p0 = p(th);
    const p3 = p(t2);
    const d0 = dp(th);
    const d3 = dp(t2);
    out.push({ kind: 'C', pts: [p0[0] + kappa * d0[0], p0[1] + kappa * d0[1], p3[0] - kappa * d3[0], p3[1] - kappa * d3[1], p3[0], p3[1]] });
    th = t2;
  }
  return out;
}

// ---------------------------------------------------------------- writer

function psFont(ctx: Ctx): string {
  const fam = ctx.fontFamily.toLowerCase();
  const bold = ctx.fontWeight === 'bold' || Number(ctx.fontWeight) >= 600;
  const italic = ctx.fontStyle === 'italic' || ctx.fontStyle === 'oblique';
  if (/courier|mono/.test(fam)) return 'Courier' + (bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : '');
  if (/times|georgia|cambria|garamond|mincho|song|serif/.test(fam) && !/sans/.test(fam)) {
    return 'Times' + (bold && italic ? '-BoldItalic' : bold ? '-Bold' : italic ? '-Italic' : '-Roman');
  }
  return 'Helvetica' + (bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : '');
}

function psString(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (code >= 32 && code < 127) out += ch;
    else if (code >= 160 && code <= 255) out += '\\' + code.toString(8).padStart(3, '0');
    else out += '?';
  }
  return out;
}

export function svgToEps(svgText: string, width: number, height: number, images?: Map<string, RasterImage>): string {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  const W = Math.ceil(width);
  const H = Math.ceil(height);
  const out: string[] = [];
  const fonts = new Set<string>();
  const body: string[] = [];

  // viewBox -> user space
  let base: M = I;
  const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    const sx = width / vb[2];
    const sy = height / vb[3];
    base = [sx, 0, 0, sy, -vb[0] * sx, -vb[1] * sy];
  }

  const rootCtx: Ctx = {
    m: base,
    fill: '#000000',
    stroke: 'none',
    strokeWidth: 1,
    linecap: 'butt',
    linejoin: 'miter',
    fontFamily: root.getAttribute('font-family') || 'Helvetica',
    fontSize: 16,
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#000000',
  };

  const inherit = (el: Element, p: Ctx): Ctx => {
    const g = (n: string) => el.getAttribute(n);
    const c: Ctx = { ...p, m: mul(p.m, parseTransform(g('transform'))) };
    const col = g('color');
    if (col) c.color = col;
    const fill = g('fill');
    if (fill !== null) c.fill = fill === 'currentColor' ? c.color : fill;
    const stroke = g('stroke');
    if (stroke !== null) c.stroke = stroke === 'currentColor' ? c.color : stroke;
    const sw = g('stroke-width');
    if (sw !== null) c.strokeWidth = parseFloat(sw);
    const da = g('stroke-dasharray');
    if (da !== null) c.dash = da === 'none' ? undefined : da;
    const lc = g('stroke-linecap');
    if (lc) c.linecap = lc;
    const lj = g('stroke-linejoin');
    if (lj) c.linejoin = lj;
    const ff = g('font-family');
    if (ff) c.fontFamily = ff;
    const fs = g('font-size');
    if (fs) c.fontSize = parseFloat(fs);
    const fw = g('font-weight');
    if (fw) c.fontWeight = fw;
    const fst = g('font-style');
    if (fst) c.fontStyle = fst;
    // inline style="..." (only the properties we care about)
    const st = g('style');
    if (st) {
      for (const decl of st.split(';')) {
        const [k, v] = decl.split(':').map((x) => x && x.trim());
        if (!k || !v) continue;
        if (k === 'fill') c.fill = v;
        else if (k === 'stroke') c.stroke = v;
        else if (k === 'stroke-width') c.strokeWidth = parseFloat(v);
        else if (k === 'font-family') c.fontFamily = v;
        else if (k === 'font-size') c.fontSize = parseFloat(v);
        else if (k === 'font-weight') c.fontWeight = v;
        else if (k === 'font-style') c.fontStyle = v;
      }
    }
    return c;
  };

  const emitPath = (segs: Seg[], c: Ctx, closeForFill: boolean) => {
    const fill = toRgb(c.fill);
    const stroke = toRgb(c.stroke);
    if (!fill && !stroke) return;
    const ps: string[] = ['newpath'];
    for (const s of segs) {
      if (s.kind === 'M') {
        const [x, y] = apply(c.m, s.pts[0], s.pts[1]);
        ps.push(`${f(x)} ${f(y)} m`);
      } else if (s.kind === 'L') {
        const [x, y] = apply(c.m, s.pts[0], s.pts[1]);
        ps.push(`${f(x)} ${f(y)} l`);
      } else if (s.kind === 'C') {
        const [x1, y1] = apply(c.m, s.pts[0], s.pts[1]);
        const [x2, y2] = apply(c.m, s.pts[2], s.pts[3]);
        const [x, y] = apply(c.m, s.pts[4], s.pts[5]);
        ps.push(`${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(x)} ${f(y)} c`);
      } else ps.push('cp');
    }
    if (fill) {
      body.push(...ps, closeForFill ? 'cp' : '', `${f(fill[0])} ${f(fill[1])} ${f(fill[2])} setrgbcolor`, stroke ? 'gsave fill grestore' : 'fill');
    }
    if (stroke) {
      if (!fill) body.push(...ps);
      const k = scaleOf(c.m);
      const lw = Math.max(0.1, c.strokeWidth * k);
      const cap = c.linecap === 'round' ? 1 : c.linecap === 'square' ? 2 : 0;
      const join = c.linejoin === 'round' ? 1 : c.linejoin === 'bevel' ? 2 : 0;
      const dash = c.dash ? `[${c.dash.split(/[\s,]+/).filter(Boolean).map((v) => f(parseFloat(v) * k)).join(' ')}] 0 setdash` : '[] 0 setdash';
      body.push(`${f(stroke[0])} ${f(stroke[1])} ${f(stroke[2])} setrgbcolor ${f(lw)} setlinewidth ${cap} setlinecap ${join} setlinejoin ${dash} stroke`);
    }
  };

  const rectSegs = (x: number, y: number, w: number, h: number, rx: number, ry: number): Seg[] => {
    rx = Math.min(rx, w / 2);
    ry = Math.min(ry, h / 2);
    if (rx <= 0 || ry <= 0) {
      return [
        { kind: 'M', pts: [x, y] },
        { kind: 'L', pts: [x + w, y] },
        { kind: 'L', pts: [x + w, y + h] },
        { kind: 'L', pts: [x, y + h] },
        { kind: 'Z', pts: [] },
      ];
    }
    const k = 0.5523;
    return [
      { kind: 'M', pts: [x + rx, y] },
      { kind: 'L', pts: [x + w - rx, y] },
      { kind: 'C', pts: [x + w - rx + rx * k, y, x + w, y + ry - ry * k, x + w, y + ry] },
      { kind: 'L', pts: [x + w, y + h - ry] },
      { kind: 'C', pts: [x + w, y + h - ry + ry * k, x + w - rx + rx * k, y + h, x + w - rx, y + h] },
      { kind: 'L', pts: [x + rx, y + h] },
      { kind: 'C', pts: [x + rx - rx * k, y + h, x, y + h - ry + ry * k, x, y + h - ry] },
      { kind: 'L', pts: [x, y + ry] },
      { kind: 'C', pts: [x, y + ry - ry * k, x + rx - rx * k, y, x + rx, y] },
      { kind: 'Z', pts: [] },
    ];
  };

  const ellipseSegs = (cx: number, cy: number, rx: number, ry: number): Seg[] => {
    const k = 0.5523;
    return [
      { kind: 'M', pts: [cx + rx, cy] },
      { kind: 'C', pts: [cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry] },
      { kind: 'C', pts: [cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy] },
      { kind: 'C', pts: [cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry] },
      { kind: 'C', pts: [cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy] },
      { kind: 'Z', pts: [] },
    ];
  };

  const walk = (el: Element, parent: Ctx) => {
    const tag = el.localName;
    if (tag === 'defs' || tag === 'title' || tag === 'desc' || tag === 'metadata' || tag === 'pattern' || tag === 'clipPath') return;
    const c = inherit(el, parent);
    const n = (name: string, def = 0) => {
      const v = el.getAttribute(name);
      return v === null ? def : parseFloat(v);
    };
    switch (tag) {
      case 'svg':
      case 'g':
      case 'a':
        for (const ch of Array.from(el.children)) walk(ch, c);
        break;
      case 'rect':
        emitPath(rectSegs(n('x'), n('y'), n('width'), n('height'), n('rx', n('ry')), n('ry', n('rx'))), c, true);
        break;
      case 'circle':
        emitPath(ellipseSegs(n('cx'), n('cy'), n('r'), n('r')), c, true);
        break;
      case 'ellipse':
        emitPath(ellipseSegs(n('cx'), n('cy'), n('rx'), n('ry')), c, true);
        break;
      case 'line':
        emitPath([{ kind: 'M', pts: [n('x1'), n('y1')] }, { kind: 'L', pts: [n('x2'), n('y2')] }], { ...c, fill: 'none' }, false);
        break;
      case 'polyline':
      case 'polygon': {
        const nums = (el.getAttribute('points') || '').split(/[\s,]+/).filter(Boolean).map(Number);
        const segs: Seg[] = [];
        for (let i = 0; i + 1 < nums.length; i += 2) segs.push({ kind: i === 0 ? 'M' : 'L', pts: [nums[i], nums[i + 1]] });
        if (tag === 'polygon') segs.push({ kind: 'Z', pts: [] });
        emitPath(segs, tag === 'polyline' ? { ...c, fill: c.fill } : c, tag === 'polygon');
        break;
      }
      case 'path':
        emitPath(parsePath(el.getAttribute('d') || ''), c, false);
        break;
      case 'image': {
        const href = el.getAttribute('href') || el.getAttribute('xlink:href');
        const img = href ? images?.get(href) : undefined;
        if (!img) break;
        // preserveAspectRatio="xMidYMid meet": fit the picture inside the box, centered
        const bx = n('x');
        const by = n('y');
        const bw = n('width');
        const bh = n('height');
        if (bw <= 0 || bh <= 0) break;
        const par = el.getAttribute('preserveAspectRatio') || 'xMidYMid meet';
        let dx = bx;
        let dy = by;
        let dw = bw;
        let dh = bh;
        if (!/none/.test(par)) {
          const k = Math.min(bw / img.w, bh / img.h);
          dw = img.w * k;
          dh = img.h * k;
          dx = bx + (bw - dw) / 2;
          dy = by + (bh - dh) / 2;
        }
        // unit square -> drawn rectangle -> current transform
        const T = mul(c.m, [dw, 0, 0, dh, dx, dy]);
        body.push(
          'gsave',
          `[${T.map(f).join(' ')}] concat`,
          `/picstr ${img.w * 3} string def`,
          `${img.w} ${img.h} 8 [${img.w} 0 0 ${img.h} 0 0] { currentfile picstr readhexstring pop } false 3 colorimage`,
          ...toHex(img.rgb),
          'grestore',
        );
        break;
      }
      case 'text': {
        const text = el.textContent ?? '';
        if (!text) break;
        const fill = toRgb(c.fill) ?? [0, 0, 0];
        const font = psFont(c);
        fonts.add(font);
        const [x, y] = apply(c.m, n('x'), n('y'));
        const size = c.fontSize * scaleOf(c.m);
        body.push(
          `gsave ${f(fill[0])} ${f(fill[1])} ${f(fill[2])} setrgbcolor /${font}-L1 findfont ${f(size)} scalefont setfont`,
          `${f(x)} ${f(y)} translate 1 -1 scale 0 0 m (${psString(text)}) show grestore`,
        );
        break;
      }
      default:
        for (const ch of Array.from(el.children)) walk(ch, c);
    }
  };
  walk(root, rootCtx);

  out.push('%!PS-Adobe-3.0 EPSF-3.0');
  out.push(`%%BoundingBox: 0 0 ${W} ${H}`);
  out.push(`%%HiResBoundingBox: 0 0 ${f(width)} ${f(height)}`);
  out.push('%%Creator: Block Illustrator');
  out.push('%%LanguageLevel: 2');
  out.push('%%Pages: 1');
  out.push('%%EndComments');
  out.push('%%BeginProlog');
  out.push('/m { moveto } bind def /l { lineto } bind def /c { curveto } bind def /cp { closepath } bind def');
  out.push('/reencode { findfont dup length dict begin { 1 index /FID ne { def } { pop pop } ifelse } forall /Encoding ISOLatin1Encoding def currentdict end definefont pop } bind def');
  for (const fnt of fonts) out.push(`/${fnt}-L1 /${fnt} reencode`);
  out.push('%%EndProlog');
  out.push('%%Page: 1 1');
  out.push('gsave');
  out.push(`0 ${f(height)} translate 1 -1 scale`); // SVG y-down -> PostScript y-up
  out.push(...body.filter((l) => l !== ''));
  out.push('grestore');
  out.push('showpage');
  out.push('%%Trailer');
  out.push('%%EOF');
  return out.join('\n');
}
