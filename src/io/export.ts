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
 * Build the SVG document. Pictures that are themselves SVG are normally written
 * into the document as nested <svg> elements (`inlineSvg`): Word / PowerPoint do not
 * show an <image> that points at SVG data, and glyph definitions inside such a
 * picture (MathJax ids) would clash with the diagram's own ones once flattened.
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

/** Every <image> holding SVG data becomes a nested <svg> with unique ids. */
export function inlineSvgImages(markup: string): string {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) return markup;
  const images = Array.from(doc.getElementsByTagNameNS(SVG_NS, 'image'));
  let n = 0;
  let changed = false;
  for (const img of images) {
    const href = img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
    if (!/^data:image\/svg\+xml/i.test(href)) continue;
    let text = dataUrlText(href);
    if (!text) continue;
    n++;
    // make the picture's ids unique inside the combined document
    const prefix = `pic${n}-`;
    const ids = Array.from(new Set(Array.from(text.matchAll(/\sid\s*=\s*["']([^"']+)["']/g), (m) => m[1]))).sort((a, b) => b.length - a.length);
    for (const id of ids) {
      const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text
        .replace(new RegExp(`(\\sid\\s*=\\s*["'])${esc}(["'])`, 'g'), `$1${prefix}${id}$2`)
        .replace(new RegExp(`#${esc}(?=["')\\s;,}])`, 'g'), `#${prefix}${id}`);
    }
    const inner = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = inner.documentElement;
    if (!root || root.localName !== 'svg' || inner.getElementsByTagName('parsererror').length) continue;
    const nested = doc.createElementNS(SVG_NS, 'svg');
    for (const a of ['x', 'y', 'width', 'height']) {
      const v = img.getAttribute(a);
      if (v !== null) nested.setAttribute(a, v);
    }
    let vb = root.getAttribute('viewBox');
    if (!vb) {
      const w = parseFloat(root.getAttribute('width') || '');
      const h = parseFloat(root.getAttribute('height') || '');
      if (w > 0 && h > 0) vb = `0 0 ${w} ${h}`;
    }
    if (vb) nested.setAttribute('viewBox', vb);
    nested.setAttribute('preserveAspectRatio', img.getAttribute('preserveAspectRatio') || 'xMidYMid meet');
    nested.setAttribute('overflow', 'visible');
    // keep the picture's own presentation attributes (font, fill …) and its style
    for (const a of Array.from(root.attributes)) {
      if (['x', 'y', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'xmlns', 'version', 'id'].includes(a.name) || a.name.startsWith('xmlns:')) continue;
      nested.setAttribute(a.name, a.value);
    }
    for (const child of Array.from(root.childNodes)) nested.appendChild(doc.importNode(child, true));
    img.parentNode?.replaceChild(nested, img);
    changed = true;
  }
  if (!changed) return markup;
  return new XMLSerializer().serializeToString(doc.documentElement);
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
