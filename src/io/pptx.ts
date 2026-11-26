// Diagram -> PowerPoint (.pptx) with native, editable shapes: blocks become preset shapes,
// two-point connections become connectors glued to the shapes, bent connections become
// freeform lines, labels become text (inside the shape or as text boxes), pictures become
// pictures. One 16:9 slide; the shapes can be copied from it into any presentation.
//
// Units: a diagram unit is one CSS pixel = 0.75 pt = 9525 EMU, so sizes match the SVG /
// PNG exports and a round trip through the importer keeps the coordinates.

import { sideToward } from '../geometry/geometry';
import { ArrowKind, DEdge, DNode, DStyle, Diagram, Side, edgeTextDefaults, resolveEdgeText, resolveNode, resolveSrc } from '../model/types';
import { stripXmlInvalid } from '../model/text';
import { PLAIN_STYLE, TextStyle, splitLine, BIG_FACTOR, SMALL_FACTOR } from '../render/label';
import { DiagramLayout, EdgeLayout, junctionDotVisible, layoutDiagram, nodeLabelPos, nodeLabelText, shapeBox } from '../render/layout';
import { exportSize } from '../render/DiagramSvg';
import { downloadBlob } from './files';
import { zipStore } from './zip';

export const EMU_PER_PX = 9525;
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const esc = (s: string) =>
  stripXmlInvalid(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- colors
let colorCtx: CanvasRenderingContext2D | null | undefined;

/** Any CSS color -> { hex: 'RRGGBB', alpha: 0..1 } or null for none / transparent. */
export function cssColor(c: string | undefined): { hex: string; alpha: number } | null {
  if (!c) return null;
  const s = c.trim();
  if (!s || /^(none|transparent)$/i.test(s)) return null;
  const m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { hex: h.slice(0, 6).toUpperCase(), alpha };
  }
  if (colorCtx === undefined) colorCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (colorCtx) {
    colorCtx.fillStyle = '#000000';
    colorCtx.fillStyle = s;
    const v = String(colorCtx.fillStyle);
    const hm = /^#([0-9a-f]{6})$/i.exec(v);
    if (hm) return { hex: hm[1].toUpperCase(), alpha: 1 };
    const rm = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/i.exec(v);
    if (rm) {
      const hex = [rm[1], rm[2], rm[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase();
      const alpha = rm[4] !== undefined ? parseFloat(rm[4]) : 1;
      return alpha <= 0 ? null : { hex, alpha };
    }
  }
  return { hex: '000000', alpha: 1 };
}

function solidFill(c: string | undefined): string {
  const col = cssColor(c);
  if (!col) return '<a:noFill/>';
  const alpha = col.alpha < 1 ? `<a:alpha val="${Math.round(col.alpha * 100000)}"/>` : '';
  return `<a:solidFill><a:srgbClr val="${col.hex}">${alpha}</a:srgbClr></a:solidFill>`;
}

// ---------------------------------------------------------------- fonts
const GENERIC_FONTS: Record<string, string> = {
  'sans-serif': 'Arial',
  serif: 'Times New Roman',
  monospace: 'Consolas',
  'system-ui': 'Segoe UI',
  'ui-sans-serif': 'Arial',
  'ui-serif': 'Times New Roman',
  'ui-monospace': 'Consolas',
};

/** First concrete family of a CSS font list ("Arial, Helvetica, sans-serif" -> Arial). */
export function firstFont(font: string): string {
  for (const part of font.split(',')) {
    const f = part.trim().replace(/^['"]|['"]$/g, '');
    if (!f) continue;
    const g = GENERIC_FONTS[f.toLowerCase()];
    return g ?? f;
  }
  return 'Arial';
}

// ---------------------------------------------------------------- text
interface Run {
  text: string;
  size: number; // px
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color?: string;
}

/** Lines of runs from a label (inline tags and $math$ resolved; math keeps its TeX source in italics). */
export function labelRuns(label: string, fontSize: number, initial: Partial<TextStyle>): Run[][] {
  const out: Run[][] = [];
  let style: TextStyle = { ...PLAIN_STYLE, ...initial };
  for (const raw of label.split('\n')) {
    const res = splitLine(raw, style);
    style = res.style;
    const runs: Run[] = [];
    for (const part of res.parts) {
      const size = part.style.small ? fontSize * SMALL_FACTOR : part.style.big ? fontSize * BIG_FACTOR : fontSize;
      const text = part.kind === 'math' ? part.text.replace(/\\[,;: ]/g, ' ').replace(/\\([A-Za-z]+)/g, '$1').replace(/[{}]/g, '') : part.text;
      if (!text) continue;
      runs.push({
        text,
        size,
        bold: part.style.bold,
        italic: part.kind === 'math' ? true : part.style.italic,
        underline: !!part.style.underline,
        color: part.style.color,
      });
    }
    out.push(runs);
  }
  return out;
}

interface TextOpts {
  align: 'left' | 'center' | 'right';
  color: string;
  font: string;
  /** EMU */
  insets: number;
  wrap: boolean;
  autofit: boolean;
  anchor: 't' | 'ctr' | 'b';
}

function txBody(lines: Run[][], scale: number, o: TextOpts): string {
  const algn = o.align === 'left' ? 'l' : o.align === 'right' ? 'r' : 'ctr';
  const face = esc(firstFont(o.font));
  const ps = lines
    .map((runs) => {
      const rs = runs
        .map((r) => {
          const sz = Math.max(100, Math.round(r.size * 0.75 * scale * 100));
          const attrs = `lang="en-US" altLang="ja-JP" sz="${sz}" b="${r.bold ? 1 : 0}" i="${r.italic ? 1 : 0}"${r.underline ? ' u="sng"' : ''} dirty="0"`;
          return `<a:r><a:rPr ${attrs}>${solidFill(r.color ?? o.color)}<a:latin typeface="${face}"/><a:ea typeface="${face}"/><a:cs typeface="${face}"/></a:rPr><a:t>${esc(r.text)}</a:t></a:r>`;
        })
        .join('');
      const end = runs.length ? '' : `<a:endParaRPr lang="en-US" sz="${Math.round(14 * 0.75 * 100)}" dirty="0"/>`;
      return `<a:p><a:pPr algn="${algn}"/>${rs}${end}</a:p>`;
    })
    .join('');
  const fit = o.autofit ? '<a:spAutoFit/>' : '';
  return `<p:txBody><a:bodyPr wrap="${o.wrap ? 'square' : 'none'}" lIns="${o.insets}" tIns="${o.insets}" rIns="${o.insets}" bIns="${o.insets}" rtlCol="0" anchor="${o.anchor}" anchorCtr="0">${fit}</a:bodyPr><a:lstStyle/>${ps}</p:txBody>`;
}

// ---------------------------------------------------------------- geometry helpers
interface Xf {
  /** diagram px -> slide EMU */
  x: (px: number) => number;
  y: (px: number) => number;
  /** length px -> EMU */
  l: (px: number) => number;
  scale: number;
}

function xfrm(xf: Xf, cx: number, cy: number, w: number, h: number, rot = 0, flipH = false, flipV = false): string {
  const ex = Math.max(0, Math.round(xf.l(w)));
  const ey = Math.max(0, Math.round(xf.l(h)));
  const attrs = `${rot ? ` rot="${Math.round(rot * 60000)}"` : ''}${flipH ? ' flipH="1"' : ''}${flipV ? ' flipV="1"' : ''}`;
  return `<a:xfrm${attrs}><a:off x="${Math.round(xf.x(cx - w / 2))}" y="${Math.round(xf.y(cy - h / 2))}"/><a:ext cx="${ex}" cy="${ey}"/></a:xfrm>`;
}

function dashXml(dash: string | undefined): string {
  return dash === 'dashed' ? '<a:prstDash val="dash"/>' : dash === 'dotted' ? '<a:prstDash val="sysDot"/>' : '';
}

function lineXml(xf: Xf, color: string | undefined, widthPx: number, dash?: string, ends = ''): string {
  const col = cssColor(color);
  if (!col || widthPx <= 0) return '<a:ln><a:noFill/></a:ln>';
  return `<a:ln w="${Math.max(0, Math.round(xf.l(widthPx)))}" cap="rnd">${solidFill(color)}${dashXml(dash)}<a:round/>${ends}</a:ln>`;
}

function arrowEnd(tag: 'headEnd' | 'tailEnd', kind: ArrowKind, sizePx: number, widthPx: number): string {
  if (kind === 'none') return '';
  const type = kind === 'open' ? 'arrow' : kind === 'dot' ? 'oval' : 'triangle';
  const ratio = sizePx / Math.max(0.5, widthPx);
  const len = ratio > 5 ? 'lg' : ratio > 2.5 ? 'med' : 'sm';
  return `<a:${tag} type="${type}" w="med" len="${len}"/>`;
}

/** Connection-site index of a side, per preset geometry. */
function cxnIdx(n: DNode, s: DStyle, side: Side): number {
  const r = resolveNode(n, s);
  const ellipse = n.type === 'circle' || n.type === 'sum' || n.type === 'junction';
  // the shape's own frame is turned by its rotation: undo it for the site index
  const rot = r.rotate;
  const order: Side[] = ['top', 'right', 'bottom', 'left'];
  const local = order[(order.indexOf(side) - rot / 90 + 4) % 4];
  const idx = { top: 0, left: 1, bottom: 2, right: 3 }[local];
  return ellipse ? idx * 2 : idx;
}

function arrowKindOf(e: DEdge, s: DStyle, toJunction: boolean): ArrowKind {
  if (e.arrow !== undefined) return e.arrow;
  return toJunction ? 'none' : s.arrow;
}

// ---------------------------------------------------------------- shapes
class SlideBuilder {
  shapes: string[] = [];
  rels: string[] = [];
  media: { name: string; data: Uint8Array; ext: string }[] = [];
  private nextId = 2;
  private relSeq = 2; // rId1 = layout
  private cNvPrIds = new Map<string, number>();

  id(name: string): number {
    const id = this.nextId++;
    this.cNvPrIds.set(name, id);
    return id;
  }
  idOf(name: string): number | undefined {
    return this.cNvPrIds.get(name);
  }
  addMedia(data: Uint8Array, ext: string): string {
    const rId = `rId${this.relSeq++}`;
    const name = `image${this.media.length + 1}.${ext}`;
    this.media.push({ name, data, ext });
    this.rels.push(`<Relationship Id="${rId}" Type="${R}/image" Target="../media/${name}"/>`);
    return rId;
  }
}

function nvPr(id: number, name: string, descr: string, kind: 'sp' | 'cxn' | 'pic', txBox = false): string {
  const cnv = kind === 'sp' ? `<p:cNvSpPr${txBox ? ' txBox="1"' : ''}/>` : kind === 'cxn' ? '<p:cNvCxnSpPr/>' : '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>';
  const tag = kind === 'sp' ? 'nvSpPr' : kind === 'cxn' ? 'nvCxnSpPr' : 'nvPicPr';
  return `<p:${tag}><p:cNvPr id="${id}" name="${esc(name)}" descr="${esc(descr)}"/>${cnv}<p:nvPr/></p:${tag}>`;
}

function textBoxXml(
  b: SlideBuilder,
  xf: Xf,
  name: string,
  descr: string,
  cx: number,
  cy: number,
  w: number,
  h: number,
  lines: Run[][],
  o: Omit<TextOpts, 'insets' | 'wrap' | 'autofit' | 'anchor'>,
  rot = 0,
): string {
  const id = b.id(name);
  // a little room so PowerPoint's own metrics do not clip the text
  const pad = 4;
  return (
    `<p:sp>${nvPr(id, name, descr, 'sp', true)}<p:spPr>${xfrm(xf, cx, cy, w + pad * 2, h + pad, rot)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>` +
    txBody(lines, xf.scale, { ...o, insets: 0, wrap: false, autofit: false, anchor: 'ctr' }) +
    `</p:sp>`
  );
}

/** Decode a data URL into bytes + file extension (null when it is not a data URL). */
function dataUrlBytes(url: string): { data: Uint8Array; ext: string; mime: string } | null {
  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/i.exec(url);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpeg' : mime === 'image/gif' ? 'gif' : mime === 'image/svg+xml' ? 'svg' : mime === 'image/webp' ? 'webp' : mime === 'image/bmp' ? 'bmp' : null;
  if (!ext) return null;
  let data: Uint8Array;
  if (m[2]) {
    const bin = atob(m[3].replace(/\s+/g, ''));
    data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  } else data = new TextEncoder().encode(decodeURIComponent(m[3]));
  return { data, ext, mime };
}

/** Rasterize a picture (SVG / WebP / BMP, which PowerPoint may not take) to PNG at 2x. */
async function toPng(url: string, w: number, h: number): Promise<Uint8Array | null> {
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('image'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * 2));
    canvas.height = Math.max(1, Math.round(h * 2));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function nodeXml(b: SlideBuilder, xf: Xf, lay: DiagramLayout, n: DNode): Promise<string> {
  const d = lay.diagram;
  const s = d.style;
  const box = lay.boxes.get(n.id)!;
  const rs = resolveNode(n, s);
  const local = shapeBox(box); // unrotated frame
  const { cx, cy } = local;
  const w = Math.max(local.w, 0.5);
  const h = Math.max(local.h, 0.5);
  const labelLay = lay.labels.get(n.id)!;
  const labelText = nodeLabelText(n, s);
  const hasLabel = labelText !== '';
  const lines = labelRuns(labelText, rs.fontSize, { bold: rs.bold, italic: rs.italic, underline: rs.underline });
  const textOpts = { align: rs.textAlign, color: rs.color, font: rs.font };
  const inside = rs.labelPos === 'center' && n.type !== 'text' && n.type !== 'image';
  const parts: string[] = [];
  const fillAndLine = () => solidFill(rs.fill) + lineXml(xf, rs.stroke, rs.strokeWidth, rs.dash);
  const geomPrst = (prst: string, adj?: number) =>
    `<a:prstGeom prst="${prst}">${adj !== undefined ? `<a:avLst><a:gd name="adj" fmla="val ${Math.round(adj)}"/></a:avLst>` : '<a:avLst/>'}</a:prstGeom>`;
  const descr = `bd:${n.type}`;
  const body = inside && hasLabel ? txBody(lines, xf.scale, { ...textOpts, insets: Math.round(xf.l(2)), wrap: false, autofit: false, anchor: 'ctr' }) : '';

  switch (n.type) {
    case 'block':
    case 'rounded': {
      const ss = Math.min(w, h);
      const geom = rs.radius > 0 && ss > 0 ? geomPrst('roundRect', Math.min(50000, (Math.min(rs.radius, ss / 2) / ss) * 100000)) : geomPrst('rect');
      parts.push(`<p:sp>${nvPr(b.id(n.id), n.id, descr, 'sp')}<p:spPr>${xfrm(xf, cx, cy, w, h, rs.rotate)}${geom}${fillAndLine()}</p:spPr>${body}</p:sp>`);
      break;
    }
    case 'circle':
      parts.push(`<p:sp>${nvPr(b.id(n.id), n.id, descr, 'sp')}<p:spPr>${xfrm(xf, cx, cy, w, h, rs.rotate)}${geomPrst('ellipse')}${fillAndLine()}</p:spPr>${body}</p:sp>`);
      break;
    case 'sum': {
      parts.push(`<p:sp>${nvPr(b.id(n.id), n.id, descr, 'sp')}<p:spPr>${xfrm(xf, cx, cy, w, h, rs.rotate)}${geomPrst('ellipse')}${fillAndLine()}</p:spPr>${body}</p:sp>`);
      if (rs.sumStyle === 'cross') {
        const k = (w / 2) * Math.SQRT1_2;
        for (const [i, flip] of [
          [1, false],
          [2, true],
        ] as [number, boolean][]) {
          const name = `${n.id}.cross${i}`;
          parts.push(
            `<p:cxnSp>${nvPr(b.id(name), name, 'bd:deco', 'cxn')}<p:spPr>${xfrm(xf, cx, cy, 2 * k, 2 * k, 0, flip)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${lineXml(xf, rs.stroke, rs.strokeWidth)}</p:spPr></p:cxnSp>`,
          );
        }
      }
      break;
    }
    case 'diamond':
      parts.push(`<p:sp>${nvPr(b.id(n.id), n.id, descr, 'sp')}<p:spPr>${xfrm(xf, cx, cy, w, h, rs.rotate)}${geomPrst('diamond')}${fillAndLine()}</p:spPr>${body}</p:sp>`);
      break;
    case 'gain': {
      // triangle as a freeform (a preset triangle would have to be rotated, turning the text with it)
      const W = Math.round(xf.l(w));
      const H = Math.round(xf.l(h));
      const pts = n.flip
        ? [
            [W, 0],
            [0, H / 2],
            [W, H],
          ]
        : [
            [0, 0],
            [W, H / 2],
            [0, H],
          ];
      const path = `<a:path w="${W}" h="${H}"><a:moveTo><a:pt x="${pts[0][0]}" y="${Math.round(pts[0][1])}"/></a:moveTo><a:lnTo><a:pt x="${pts[1][0]}" y="${Math.round(pts[1][1])}"/></a:lnTo><a:lnTo><a:pt x="${pts[2][0]}" y="${Math.round(pts[2][1])}"/></a:lnTo><a:close/></a:path>`;
      // connection sites in the order top, left, bottom, right (what connectors attach to)
      const sites = [
        [W / 2, H / 4],
        [0, H / 2],
        [W / 2, (3 * H) / 4],
        [W, H / 2],
      ]
        .map(([x, y], i) => `<a:cxn ang="${[16200000, 10800000, 5400000, 0][i]}"><a:pos x="${Math.round(x)}" y="${Math.round(y)}"/></a:cxn>`)
        .join('');
      const geom = `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst>${sites}</a:cxnLst><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${path}</a:pathLst></a:custGeom>`;
      parts.push(`<p:sp>${nvPr(b.id(n.id), n.id, descr, 'sp')}<p:spPr>${xfrm(xf, cx, cy, w, h, rs.rotate)}${geom}${fillAndLine()}</p:spPr>${body}</p:sp>`);
      break;
    }
    case 'junction': {
      const visible = junctionDotVisible(n, s);
      const r = visible ? w : 2;
      const fill = visible ? solidFill(rs.fill) : '<a:noFill/>';
      parts.push(`<p:sp>${nvPr(b.id(n.id), n.id, descr + (visible ? '' : ' hidden'), 'sp')}<p:spPr>${xfrm(xf, cx, cy, r, r)}${geomPrst('ellipse')}${fill}<a:ln><a:noFill/></a:ln></p:spPr></p:sp>`);
      break;
    }
    case 'text':
      if (hasLabel) parts.push(textBoxXml(b, xf, n.id, descr, cx, cy, labelLay.w, labelLay.h, lines, textOpts, rs.rotate));
      break;
    case 'image': {
      const href = resolveSrc(n.src, d.assets);
      const raw = href ? dataUrlBytes(href) : null;
      let media: { data: Uint8Array; ext: string } | null = raw && (raw.ext === 'png' || raw.ext === 'jpeg' || raw.ext === 'gif') ? raw : null;
      if (!media && href) {
        const png = await toPng(href, w, h);
        if (png) media = { data: png, ext: 'png' };
      }
      if (rs.fill !== 'none' && cssColor(rs.fill)) {
        const name = `${n.id}.bg`;
        parts.push(`<p:sp>${nvPr(b.id(name), name, 'bd:deco', 'sp')}<p:spPr>${xfrm(xf, cx, cy, w, h, rs.rotate)}${geomPrst('rect')}${solidFill(rs.fill)}<a:ln><a:noFill/></a:ln></p:spPr></p:sp>`);
      }
      if (media) {
        const rId = b.addMedia(media.data, media.ext);
        parts.push(
          `<p:pic>${nvPr(b.id(n.id), n.id, descr, 'pic')}<p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(xf, cx, cy, w, h, rs.rotate)}${geomPrst('rect')}${lineXml(xf, rs.stroke, rs.strokeWidth, rs.dash)}</p:spPr></p:pic>`,
        );
      } else {
        parts.push(
          `<p:sp>${nvPr(b.id(n.id), n.id, descr, 'sp')}<p:spPr>${xfrm(xf, cx, cy, w, h, rs.rotate)}${geomPrst('rect')}${solidFill('#f3f4f6')}${lineXml(xf, '#9aa4b2', 1, 'dashed')}</p:spPr>${txBody(
            [[{ text: n.src ?? 'image', size: 12, bold: false, italic: false, underline: false }]],
            xf.scale,
            { align: 'center', color: '#6b7280', font: s.font, insets: 0, wrap: true, autofit: false, anchor: 'ctr' },
          )}</p:sp>`,
        );
      }
      break;
    }
  }
  // captions and other labels outside the shape are text boxes of their own
  if (hasLabel && !inside && n.type !== 'text') {
    const p = nodeLabelPos(box, labelLay, s);
    parts.push(textBoxXml(b, xf, `${n.id}.label`, 'bd:caption', p.x, p.y, labelLay.w, labelLay.h, lines, textOpts, rs.rotate));
  }
  return parts.join('');
}

function edgeXml(b: SlideBuilder, xf: Xf, lay: DiagramLayout, el: EdgeLayout): string {
  const d = lay.diagram;
  const s = d.style;
  const e = el.edge;
  const pts = el.route.points;
  if (pts.length < 2) return '';
  const color = e.color ?? s.lineColor;
  const lw = e.width ?? s.lineWidth;
  const kind = arrowKindOf(e, s, el.toJunction);
  const size = e.arrowSize ?? s.arrowSize;
  const endKind: ArrowKind = kind === 'both' ? 'triangle' : kind;
  const startKind: ArrowKind = kind === 'both' ? 'triangle' : 'none';
  const ends = arrowEnd('headEnd', startKind, size, lw) + arrowEnd('tailEnd', endKind, size, lw);
  const ln = lineXml(xf, color, lw, e.dash, ends);
  const parts: string[] = [];
  const from = lay.boxes.get(e.from);
  const to = lay.boxes.get(e.to);
  if (pts.length === 2 && from && to) {
    // straight connection: a connector glued to both shapes
    const a = pts[0];
    const z = pts[1];
    const fromSide = el.route.fromSide ?? sideToward(from, z);
    const toSide = el.route.toSide ?? sideToward(to, a);
    const stId = b.idOf(e.from);
    const endId = b.idOf(e.to);
    const st = stId !== undefined ? `<a:stCxn id="${stId}" idx="${cxnIdx(from.node, s, fromSide)}"/>` : '';
    const en = endId !== undefined ? `<a:endCxn id="${endId}" idx="${cxnIdx(to.node, s, toSide)}"/>` : '';
    const id = b.id(e.id);
    const w = Math.abs(z.x - a.x);
    const h = Math.abs(z.y - a.y);
    parts.push(
      `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${esc(e.id)}" descr="bd:edge"/><p:cNvCxnSpPr>${st}${en}</p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(
        xf,
        (a.x + z.x) / 2,
        (a.y + z.y) / 2,
        w,
        h,
        0,
        z.x < a.x,
        z.y < a.y,
      )}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>${ln}</p:spPr></p:cxnSp>`,
    );
  } else {
    // bent connection: a freeform line through the route's points
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
    const w = Math.max(maxX - minX, 0.5);
    const h = Math.max(maxY - minY, 0.5);
    const W = Math.round(xf.l(w));
    const H = Math.round(xf.l(h));
    const path = pts
      .map((p, i) => {
        const x = Math.round(xf.l(p.x - minX));
        const y = Math.round(xf.l(p.y - minY));
        return i === 0 ? `<a:moveTo><a:pt x="${x}" y="${y}"/></a:moveTo>` : `<a:lnTo><a:pt x="${x}" y="${y}"/></a:lnTo>`;
      })
      .join('');
    const geom = `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${W}" h="${H}" fill="none">${path}</a:path></a:pathLst></a:custGeom>`;
    parts.push(`<p:sp>${nvPr(b.id(e.id), e.id, 'bd:edge', 'sp')}<p:spPr>${xfrm(xf, (minX + maxX) / 2, (minY + maxY) / 2, w, h)}${geom}<a:noFill/>${ln}</p:spPr></p:sp>`);
  }
  const ta = resolveEdgeText(e, s);
  if (el.label && e.label) {
    const lines = labelRuns(e.label, ta.fontSize, { bold: ta.bold, italic: ta.italic });
    parts.push(textBoxXml(b, xf, `${e.id}.label`, 'bd:label', el.label.pos.x, el.label.pos.y, el.label.layout.w, el.label.layout.h, lines, { align: ta.textAlign, color: ta.color, font: ta.font }));
  }
  if (el.sign && e.sign) {
    const lines = labelRuns(e.sign, ta.fontSize * 1.1, {});
    parts.push(textBoxXml(b, xf, `${e.id}.sign`, 'bd:sign', el.sign.pos.x, el.sign.pos.y, el.sign.layout.w, el.sign.layout.h, lines, { align: 'center', color: edgeTextDefaults(s).color, font: s.font }));
  }
  return parts.join('');
}

// ---------------------------------------------------------------- package
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const THEME = `${XML_HEAD}<a:theme xmlns:a="${A}" name="Block Illustrator"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const EMPTY_TREE = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

const MASTER = `${XML_HEAD}<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const LAYOUT = `${XML_HEAD}<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

function rels(items: string[]): string {
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`;
}

/** Build the .pptx file. */
export async function buildPptx(diagram: Diagram): Promise<Blob> {
  const lay = layoutDiagram(diagram);
  const size = exportSize(lay);
  // the diagram is centered on a 16:9 slide at its natural size (scaled down only if it does not fit)
  const scale = Math.min(1, SLIDE_W / (size.w * EMU_PER_PX), SLIDE_H / (size.h * EMU_PER_PX));
  const offX = (SLIDE_W - size.w * EMU_PER_PX * scale) / 2;
  const offY = (SLIDE_H - size.h * EMU_PER_PX * scale) / 2;
  const xf: Xf = {
    x: (px) => (px - size.x) * EMU_PER_PX * scale + offX,
    y: (px) => (px - size.y) * EMU_PER_PX * scale + offY,
    l: (px) => px * EMU_PER_PX * scale,
    scale,
  };
  const b = new SlideBuilder();
  b.rels.push(`<Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`);
  const back = diagram.nodes.filter((n) => n.back);
  const front = diagram.nodes.filter((n) => !n.back);
  for (const n of back) b.shapes.push(await nodeXml(b, xf, lay, n));
  // shapes first so connectors can refer to their ids
  const frontXml: string[] = [];
  for (const n of front) frontXml.push(await nodeXml(b, xf, lay, n));
  const edgesXml = lay.edges.map((el) => edgeXml(b, xf, lay, el));
  b.shapes.push(...edgesXml, ...frontXml);

  const bgCol = cssColor(diagram.style.background);
  const bg = bgCol ? `<p:bg><p:bgPr>${solidFill(diagram.style.background)}<a:effectLst/></p:bgPr></p:bg>` : '';
  // the diagram's origin and scale, so an import can put the coordinates back where they were
  const cName = `BlockIllustrator origin=(${size.x},${size.y}) scale=${scale} offset=(${Math.round(offX)},${Math.round(offY)})`;
  const slide = `${XML_HEAD}<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld name="${esc(cName)}">${bg}<p:spTree>${EMPTY_TREE}${b.shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

  const presentation = `${XML_HEAD}<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>`;

  const mediaTypes = new Set(b.media.map((m) => m.ext));
  const defaults = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>', '<Default Extension="xml" ContentType="application/xml"/>'];
  for (const ext of mediaTypes) defaults.push(`<Default Extension="${ext}" ContentType="image/${ext}"/>`);
  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join('')}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Block Illustrator diagram</dc:title><dc:creator>Block Illustrator</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app = `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Block Illustrator</Application><Slides>1</Slides></Properties>`;

  const entries = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels([`<Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/>`, `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`, `<Relationship Id="rId3" Type="${R}/extended-properties" Target="docProps/app.xml"/>`]) },
    { name: 'docProps/core.xml', data: core },
    { name: 'docProps/app.xml', data: app },
    { name: 'ppt/presentation.xml', data: presentation },
    { name: 'ppt/_rels/presentation.xml.rels', data: rels([`<Relationship Id="rId1" Type="${R}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`, `<Relationship Id="rId2" Type="${R}/slide" Target="slides/slide1.xml"/>`, `<Relationship Id="rId3" Type="${R}/theme" Target="theme/theme1.xml"/>`]) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: MASTER },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([`<Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`, `<Relationship Id="rId2" Type="${R}/theme" Target="../theme/theme1.xml"/>`]) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: LAYOUT },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([`<Relationship Id="rId1" Type="${R}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`]) },
    { name: 'ppt/theme/theme1.xml', data: THEME },
    { name: 'ppt/slides/slide1.xml', data: slide },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: rels(b.rels) },
    ...b.media.map((m) => ({ name: `ppt/media/${m.name}`, data: m.data })),
  ];
  const blob = zipStore(entries);
  return new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

export async function exportPptxFile(diagram: Diagram, name: string, deliver: (blob: Blob, fileName: string) => Promise<void> | void = downloadBlob) {
  const blob = await buildPptx(diagram);
  await deliver(blob, `${name}.pptx`);
}
