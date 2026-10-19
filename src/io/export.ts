import { t } from '../i18n';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import { Diagram } from '../model/types';
import { ExportSvg, exportSize } from '../render/DiagramSvg';
import { layoutDiagram } from '../render/layout';
import { svgToEps } from './eps';

export interface SvgResult {
  svg: string;
  w: number;
  h: number;
}

export function buildSvg(diagram: Diagram): SvgResult {
  const layout = layoutDiagram(diagram);
  const size = exportSize(layout);
  const markup = renderToStaticMarkup(createElement(ExportSvg, { layout }));
  return { svg: '<?xml version="1.0" encoding="UTF-8"?>\n' + markup, w: size.w, h: size.h };
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function baseName(fileName: string | null): string {
  if (!fileName) return 'diagram';
  return fileName.replace(/\.[^.]+$/, '') || 'diagram';
}

export function exportSvgFile(diagram: Diagram, name: string) {
  const { svg } = buildSvg(diagram);
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${name}.svg`);
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

export async function exportPngFile(diagram: Diagram, name: string, scale = 2) {
  const blob = await renderPng(diagram, scale);
  downloadBlob(blob, `${name}@${scale}x.png`);
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

export async function exportPdfFile(diagram: Diagram, name: string) {
  const blob = await renderPdf(diagram);
  downloadBlob(blob, `${name}.pdf`);
}

/** EPS (PostScript standard fonts; math is exported as outlines). */
export function exportEpsFile(diagram: Diagram, name: string) {
  const { svg, w, h } = buildSvg(diagram);
  const eps = svgToEps(svg, w, h);
  downloadBlob(new Blob([eps], { type: 'application/postscript' }), `${name}.eps`);
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
