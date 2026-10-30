import { t } from '../i18n';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import { Diagram } from '../model/types';
import { ExportSvg, exportSize } from '../render/DiagramSvg';
import { layoutDiagram } from '../render/layout';
import { RasterImage, svgToEps } from './eps';
import { downloadBlob } from './files';

export interface SvgResult {
  svg: string;
  w: number;
  h: number;
}

/**
 * Build the SVG document. Pictures that are themselves SVG are normally flattened
 * into the document as plain <g> groups (`inlineSvg`): Word / PowerPoint do not
 * show an <image> that points at SVG data, and their SVG renderer is unreliable
 * with nested <svg> viewports and <use> references, so the picture is written as
 * ordinary paths with its own transform (see `flattenPicture`).
 */
export function buildSvg(diagram: Diagram, opts: { inlineSvg?: boolean } = {}): SvgResult {
  const layout = layoutDiagram(diagram);
  const size = exportSize(layout);
  let markup = renderToStaticMarkup(createElement(ExportSvg, { layout }));
  if (opts.inlineSvg !== false && /data:image\/svg\+xml/i.test(markup)) markup = inlineSvgImages(markup);
  return { svg: '<?xml version="1.0" encoding="UTF-8"?>\n' + markup, w: size.w, h: size.h };
}

/** Decode a data URL (base64 or percent-encoded) to text. */
function dataUrlText(url: string): string | null {
  const m = /^data:([^,]*?)(;base64)?,([\s\S]*)$/i.exec(url);
  if (!m) return null;
  try {
    if (m[2]) {
      const bin = atob(m[3].replace(/\s+/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
    return decodeURIComponent(m[3]);
  } catch {
    return null;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Every <image> holding SVG data becomes a flattened <g> group (unique ids, no <use>). */
export function inlineSvgImages(markup: string): string {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) return markup;
  const images = Array.from(doc.getElementsByTagNameNS(SVG_NS, 'image'));
  let n = 0;
  let changed = false;
  for (const img of images) {
    const href = img.getAttribute('href') || img.getAttributeNS(XLINK_NS, 'href') || '';
    if (!/^data:image\/svg\+xml/i.test(href)) continue;
    const text = dataUrlText(href);
    if (!text) continue;
    const num = (a: string) => parseFloat(img.getAttribute(a) || '0') || 0;
    const group = flattenPicture(doc, text, {
      x: num('x'),
      y: num('y'),
      w: num('width'),
      h: num('height'),
      stretch: (img.getAttribute('preserveAspectRatio') || '').trim() === 'none',
      prefix: `pic${++n}-`,
    });
    if (!group) continue;
    img.parentNode?.replaceChild(group, img);
    changed = true;
  }
  if (!changed) return markup;
  return new XMLSerializer().serializeToString(doc.documentElement);
}

interface PictureBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** preserveAspectRatio="none" on the <image> */
  stretch: boolean;
  /** prefix for the picture's ids (unique within the combined document) */
  prefix: string;
}

const STRUCTURAL_ROOT_ATTRS = ['x', 'y', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'xmlns', 'version', 'id', 'role', 'focusable', 'overflow'];
const DROP_ELEMENTS = new Set(['title', 'desc', 'metadata', 'script']);

const fmt = (v: number) => String(Math.round(v * 10000) / 10000);

/**
 * Turn an SVG picture into a plain <g> positioned like the <image> it replaces:
 * the viewBox becomes a translate/scale transform, every <use> is replaced by a
 * copy of what it points at, ids get the prefix, `currentColor` is resolved and
 * titles / metadata / data-* attributes are dropped. Only basic elements remain
 * (paths, shapes, text, groups, transforms), which every SVG importer draws.
 */
function flattenPicture(doc: Document, text: string, box: PictureBox): Element | null {
  // make the picture's ids unique inside the combined document
  const ids = Array.from(new Set(Array.from(text.matchAll(/\sid\s*=\s*["']([^"']+)["']/g), (m) => m[1]))).sort((a, b) => b.length - a.length);
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text
      .replace(new RegExp(`(\\sid\\s*=\\s*["'])${esc}(["'])`, 'g'), `$1${box.prefix}${id}$2`)
      .replace(new RegExp(`#${esc}(?=["')\\s;,}])`, 'g'), `#${box.prefix}${id}`);
  }
  const inner = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = inner.documentElement;
  if (!root || root.localName !== 'svg' || inner.getElementsByTagName('parsererror').length) return null;

  // viewBox (or the intrinsic size) -> transform onto the image box
  let vb: number[] | null = (root.getAttribute('viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (vb.length !== 4 || vb.some((v) => !isFinite(v)) || vb[2] <= 0 || vb[3] <= 0) {
    const w = parseFloat(root.getAttribute('width') || '');
    const h = parseFloat(root.getAttribute('height') || '');
    vb = w > 0 && h > 0 ? [0, 0, w, h] : null;
  }
  let transform: string;
  if (vb && box.w > 0 && box.h > 0) {
    let sx = box.w / vb[2];
    let sy = box.h / vb[3];
    let tx = box.x;
    let ty = box.y;
    if (!box.stretch) {
      sx = sy = Math.min(sx, sy);
      tx += (box.w - vb[2] * sx) / 2;
      ty += (box.h - vb[3] * sy) / 2;
    }
    transform = `translate(${fmt(tx)} ${fmt(ty)}) scale(${fmt(sx)} ${fmt(sy)}) translate(${fmt(-vb[0])} ${fmt(-vb[1])})`;
  } else {
    transform = `translate(${fmt(box.x)} ${fmt(box.y)})`;
  }

  expandUses(inner);
  dropUnreferencedDefs(inner);

  // currentColor has nothing to inherit from once the root is gone
  const color = root.getAttribute('color') || /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(root.getAttribute('style') || '')?.[1]?.trim() || '#000000';
  for (const el of Array.from(inner.getElementsByTagName('*'))) {
    if (DROP_ELEMENTS.has(el.localName)) {
      el.parentNode?.removeChild(el);
      continue;
    }
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith('data-') || a.name.startsWith('aria-') || a.name === 'role' || a.name === 'focusable') el.removeAttribute(a.name);
      else if (/currentColor/i.test(a.value)) el.setAttribute(a.name, a.value.replace(/currentColor/gi, color));
    }
  }

  const g = doc.createElementNS(SVG_NS, 'g');
  for (const a of Array.from(root.attributes)) {
    if (STRUCTURAL_ROOT_ATTRS.includes(a.name) || a.name.startsWith('xmlns') || a.name.startsWith('data-') || a.name.startsWith('aria-')) continue;
    if (a.name === 'style') {
      // keep presentation declarations; vertical-align etc. mean nothing on a <g>
      const kept = a.value
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s && !/^(vertical-align|overflow|display|position|margin|padding|width|height)\s*:/i.test(s));
      if (kept.length) g.setAttribute('style', kept.join('; '));
      continue;
    }
    g.setAttribute(a.name, a.value);
  }
  const own = g.getAttribute('transform');
  g.setAttribute('transform', own ? `${transform} ${own}` : transform);
  for (const child of Array.from(root.childNodes)) g.appendChild(doc.importNode(child, true));
  return g;
}

/** Replace every <use> by a copy of the element it references (repeatedly, for nested uses). */
function expandUses(inner: XMLDocument) {
  for (let round = 0; round < 8; round++) {
    const uses = Array.from(inner.getElementsByTagNameNS(SVG_NS, 'use'));
    if (!uses.length) return;
    const byId = new Map<string, Element>();
    for (const el of Array.from(inner.getElementsByTagName('*'))) {
      const id = el.getAttribute('id');
      if (id && !byId.has(id)) byId.set(id, el);
    }
    for (const u of uses) {
      const parent = u.parentNode;
      if (!parent) continue;
      const ref = (u.getAttribute('href') || u.getAttributeNS(XLINK_NS, 'href') || '').trim();
      const target = ref.startsWith('#') ? byId.get(ref.slice(1)) : undefined;
      if (!target || target === u || target.contains(u)) {
        parent.removeChild(u);
        continue;
      }
      const g = inner.createElementNS(SVG_NS, 'g');
      for (const a of Array.from(u.attributes)) {
        if (a.localName === 'href' || ['x', 'y', 'width', 'height', 'id', 'transform'].includes(a.name)) continue;
        g.setAttribute(a.name, a.value);
      }
      const ux = parseFloat(u.getAttribute('x') || '0') || 0;
      const uy = parseFloat(u.getAttribute('y') || '0') || 0;
      const tr = [u.getAttribute('transform') || '', ux || uy ? `translate(${fmt(ux)} ${fmt(uy)})` : ''].filter(Boolean).join(' ');
      if (tr) g.setAttribute('transform', tr);
      const copy = target.cloneNode(true) as Element;
      copy.removeAttribute('id');
      if (copy.localName === 'symbol' || copy.localName === 'svg') {
        // a symbol's own viewport is rarely used by exported pictures: keep its children as a group
        const sg = inner.createElementNS(SVG_NS, 'g');
        for (const a of Array.from(copy.attributes)) {
          if (STRUCTURAL_ROOT_ATTRS.includes(a.name) || a.name.startsWith('xmlns')) continue;
          sg.setAttribute(a.name, a.value);
        }
        while (copy.firstChild) sg.appendChild(copy.firstChild);
        g.appendChild(sg);
      } else {
        g.appendChild(copy);
      }
      parent.replaceChild(g, u);
    }
  }
  // give up on pathological nesting
  for (const u of Array.from(inner.getElementsByTagNameNS(SVG_NS, 'use'))) u.parentNode?.removeChild(u);
}

/** Drop <defs> children (glyph paths of a font cache …) that nothing references any more. */
function dropUnreferencedDefs(inner: XMLDocument) {
  const defsList = Array.from(inner.getElementsByTagNameNS(SVG_NS, 'defs'));
  if (!defsList.length) return;
  const markup = new XMLSerializer().serializeToString(inner.documentElement);
  for (const defs of defsList) {
    for (const el of Array.from(defs.children)) {
      const id = el.getAttribute('id');
      if (!id) continue;
      if (!markup.includes(`#${id}`)) defs.removeChild(el);
    }
    if (!defs.children.length) defs.parentNode?.removeChild(defs);
  }
}

/** Where an exported file goes: a download by default, or a save dialog (see io/actions). */
export type Deliver = (blob: Blob, fileName: string) => Promise<void> | void;

export { downloadBlob } from './files';

export function baseName(fileName: string | null): string {
  if (!fileName) return 'diagram';
  return fileName.replace(/\.[^.]+$/, '') || 'diagram';
}

export async function exportSvgFile(diagram: Diagram, name: string, deliver: Deliver = downloadBlob) {
  const { svg } = buildSvg(diagram);
  await deliver(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${name}.svg`);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t('SVG の画像化に失敗しました')));
    img.src = url;
  });
}

export async function renderPng(diagram: Diagram, scale = 2): Promise<Blob> {
  const { svg, w, h } = buildSvg(diagram);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('PNG の生成に失敗しました')))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPngFile(diagram: Diagram, name: string, scale = 2, deliver: Deliver = downloadBlob) {
  const blob = await renderPng(diagram, scale);
  await deliver(blob, `${name}@${scale}x.png`);
}

export async function copyPngToClipboard(diagram: Diagram, scale = 2) {
  const blob = await renderPng(diagram, scale);
  const Item = (window as any).ClipboardItem;
  if (!Item || !navigator.clipboard?.write) throw new Error(t('このブラウザは画像のクリップボードコピーに対応していません'));
  await navigator.clipboard.write([new Item({ 'image/png': blob })]);
}

export async function copySvgToClipboard(diagram: Diagram) {
  const { svg } = buildSvg(diagram);
  await navigator.clipboard.writeText(svg);
}

/** Map CSS font families to the jsPDF standard fonts (times / helvetica / courier). */
function mapFontsForPdf(svg: string): string {
  return svg.replace(/font-family="([^"]*)"/g, (_m, fam: string) => {
    const f = fam.toLowerCase();
    let std = 'helvetica';
    if (/courier|mono/.test(f)) std = 'courier';
    else if (/times|georgia|cambria|garamond|mincho|song|serif/.test(f) && !/sans/.test(f)) std = 'times';
    return `font-family="${std}"`;
  });
}

export async function renderPdf(diagram: Diagram): Promise<Blob> {
  const built = buildSvg(diagram);
  const { w, h } = built;
  const svg = mapFontsForPdf(built.svg);
  const docEl = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const pt = 0.75; // px -> pt
  const doc = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'pt', format: [w * pt, h * pt] });
  await doc.svg(docEl as unknown as Element, { x: 0, y: 0, width: w * pt, height: h * pt });
  return doc.output('blob');
}

export async function exportPdfFile(diagram: Diagram, name: string, deliver: Deliver = downloadBlob) {
  const blob = await renderPdf(diagram);
  await deliver(blob, `${name}.pdf`);
}

/** Longest side of a raster embedded in EPS (hex data is 6 bytes per pixel in the file). */
const EPS_IMAGE_SIDE = 1000;

/** Decode every <image> of the SVG into RGB samples (composited on white) for the EPS writer. */
async function decodeImagesForEps(svg: string): Promise<Map<string, RasterImage>> {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const out = new Map<string, RasterImage>();
  for (const el of Array.from(doc.getElementsByTagName('image'))) {
    const href = el.getAttribute('href') || el.getAttribute('xlink:href');
    if (!href || out.has(href)) continue;
    try {
      const img = await loadImage(href);
      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;
      if (!nw || !nh) continue;
      const k = Math.min(1, EPS_IMAGE_SIDE / Math.max(nw, nh));
      const w = Math.max(1, Math.round(nw * k));
      const h = Math.max(1, Math.round(nh * k));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      const rgb = new Uint8Array(w * h * 3);
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
        rgb[j] = px[i];
        rgb[j + 1] = px[i + 1];
        rgb[j + 2] = px[i + 2];
      }
      out.set(href, { w, h, rgb });
    } catch {
      /* unreadable picture: the EPS simply omits it */
    }
  }
  return out;
}

/** EPS (PostScript standard fonts; math is exported as outlines; pictures as RGB rasters). */
export async function renderEps(diagram: Diagram): Promise<string> {
  // the EPS writer rasterizes <image> elements itself (nested <svg> is not something it draws)
  const { svg, w, h } = buildSvg(diagram, { inlineSvg: false });
  const images = await decodeImagesForEps(svg);
  return svgToEps(svg, w, h, images);
}

export async function exportEpsFile(diagram: Diagram, name: string, deliver: Deliver = downloadBlob) {
  const eps = await renderEps(diagram);
  await deliver(new Blob([eps], { type: 'application/postscript' }), `${name}.eps`);
}

/** Vector PDF through the browser's print dialog (keeps every font, incl. CJK). */
export function printDiagram(diagram: Diagram, name: string) {
  const { svg, w, h } = buildSvg(diagram);
  const win = window.open('', '_blank');
  if (!win) throw new Error(t('ポップアップがブロックされました'));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title>
<style>@page { size: ${w}px ${h}px; margin: 0; } html, body { margin: 0; padding: 0; } svg { display: block; }</style>
</head><body>${svg.replace(/^<\?xml[^>]*>\n?/, '')}<script>window.onload = () => { setTimeout(() => window.print(), 100); };</script></body></html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
}
