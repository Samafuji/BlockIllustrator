import React from 'react';
import { MathBox, mathMetrics, texToSvg } from './math';

// ---------------------------------------------------------------------------
// Label layout: plain text mixed with $math$ segments, multi-line via \n.
// Inline markup: <b>bold</b>, <small>smaller text</small>, <i>italic</i>.
// ---------------------------------------------------------------------------

export interface TextStyle {
  bold: boolean;
  italic: boolean;
  small: boolean;
}

export type Seg =
  | { kind: 'text'; text: string; w: number; size: number; bold: boolean; italic: boolean }
  | { kind: 'math'; box: MathBox; w: number; ascent: number; descent: number; scale: number };

export interface LineLayout {
  w: number;
  ascent: number;
  descent: number;
  segs: Seg[];
}

export interface LabelLayout {
  w: number;
  h: number;
  lines: LineLayout[];
  fontSize: number;
  font: string;
}

export const TEXT_ASCENT = 0.74;
export const TEXT_DESCENT = 0.24;
export const LINE_GAP = 0.3;
export const SMALL_FACTOR = 0.8;

let ctx: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

export function measureText(text: string, fontSize: number, font: string, bold = false, italic = false): number {
  const key = `${fontSize}|${bold ? 'b' : ''}${italic ? 'i' : ''}|${font}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  if (!ctx) {
    const c = document.createElement('canvas');
    ctx = c.getContext('2d');
  }
  let w = text.length * fontSize * 0.6;
  if (ctx) {
    ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontSize}px ${font}`;
    w = ctx.measureText(text).width;
  }
  widthCache.set(key, w);
  return w;
}

export interface Part {
  kind: 'text' | 'math';
  text: string;
  display?: boolean;
  style: TextStyle;
}

const TAG_RE = /^<(\/?)(b|i|small)>/i;

/** Split a line into text / $math$ parts, tracking inline markup state. */
export function splitLine(line: string, initial: TextStyle = { bold: false, italic: false, small: false }): { parts: Part[]; style: TextStyle } {
  const parts: Part[] = [];
  let style = { ...initial };
  let i = 0;
  let buf = '';
  const flush = () => {
    if (buf) parts.push({ kind: 'text', text: buf, style: { ...style } });
    buf = '';
  };
  while (i < line.length) {
    const c = line[i];
    if (c === '\\' && line[i + 1] === '$') {
      buf += '$';
      i += 2;
      continue;
    }
    if (c === '<') {
      const m = TAG_RE.exec(line.slice(i));
      if (m) {
        flush();
        const on = m[1] !== '/';
        const tag = m[2].toLowerCase();
        if (tag === 'b') style.bold = on;
        else if (tag === 'i') style.italic = on;
        else style.small = on;
        i += m[0].length;
        continue;
      }
    }
    if (c === '$') {
      const display = line[i + 1] === '$';
      const open = display ? 2 : 1;
      const close = line.indexOf(display ? '$$' : '$', i + open);
      if (close < 0) {
        buf += line.slice(i);
        break;
      }
      flush();
      parts.push({ kind: 'math', text: line.slice(i + open, close), display, style: { ...style } });
      i = close + open;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return { parts, style };
}

/** Backwards-compatible helper (text/math only). */
export function splitMath(line: string): { kind: 'text' | 'math'; text: string; display?: boolean }[] {
  return splitLine(line).parts.map((p) => ({ kind: p.kind, text: p.text, display: p.display }));
}

export function layoutLabel(text: string, fontSize: number, font: string): LabelLayout {
  const rawLines = text.split('\n');
  const lines: LineLayout[] = [];
  let maxW = 0;
  let totalH = 0;
  let style: TextStyle = { bold: false, italic: false, small: false };
  for (let li = 0; li < rawLines.length; li++) {
    const raw = rawLines[li];
    const segs: Seg[] = [];
    let w = 0;
    let ascent = 0;
    let descent = 0;
    const res = splitLine(raw, style);
    style = res.style; // markup state carries over line breaks
    for (const part of res.parts) {
      const size = part.style.small ? fontSize * SMALL_FACTOR : fontSize;
      if (part.kind === 'text') {
        const tw = measureText(part.text, size, font, part.style.bold, part.style.italic);
        segs.push({ kind: 'text', text: part.text, w: tw, size, bold: part.style.bold, italic: part.style.italic });
        w += tw;
        ascent = Math.max(ascent, size * TEXT_ASCENT);
        descent = Math.max(descent, size * TEXT_DESCENT);
      } else {
        const box = texToSvg(part.text, part.display);
        const m = mathMetrics(box, size);
        segs.push({ kind: 'math', box, w: m.w, ascent: m.ascent, descent: m.descent, scale: m.scale });
        w += m.w;
        ascent = Math.max(ascent, m.ascent, size * TEXT_ASCENT * 0.9);
        descent = Math.max(descent, m.descent);
      }
    }
    if (segs.length === 0) {
      ascent = fontSize * TEXT_ASCENT;
      descent = fontSize * TEXT_DESCENT;
    }
    lines.push({ w, ascent, descent, segs });
    maxW = Math.max(maxW, w);
    totalH += ascent + descent + (li > 0 ? fontSize * LINE_GAP : 0);
  }
  return { w: maxW, h: totalH, lines, fontSize, font };
}

export interface LabelProps {
  layout: LabelLayout;
  /** anchor position */
  x: number;
  y: number;
  /** horizontal alignment relative to x */
  align?: 'center' | 'left' | 'right';
  /** vertical alignment relative to y */
  valign?: 'middle' | 'top' | 'bottom';
  color: string;
  dataAttrs?: Record<string, string>;
  className?: string;
}

export function LabelSvg({ layout, x, y, align = 'center', valign = 'middle', color, dataAttrs, className }: LabelProps) {
  const { lines, fontSize, font } = layout;
  const top = valign === 'middle' ? y - layout.h / 2 : valign === 'top' ? y : y - layout.h;
  let cursorY = top;
  const items: React.ReactNode[] = [];
  lines.forEach((line, li) => {
    if (li > 0) cursorY += fontSize * LINE_GAP;
    const baseline = cursorY + line.ascent;
    const lineLeft = align === 'center' ? x - line.w / 2 : align === 'left' ? x : x - line.w;
    let cx = lineLeft;
    line.segs.forEach((seg, si) => {
      if (seg.kind === 'text') {
        items.push(
          <text
            key={`${li}-${si}`}
            x={cx}
            y={baseline}
            fontFamily={font}
            fontSize={seg.size}
            fontWeight={seg.bold ? 'bold' : undefined}
            fontStyle={seg.italic ? 'italic' : undefined}
            fill={color}
            xmlSpace="preserve"
            style={{ whiteSpace: 'pre' }}
          >
            {seg.text}
          </text>,
        );
      } else {
        const inner = seg.box.inner.replace(/currentColor/g, seg.box.error ? '#d00' : color);
        items.push(
          <g key={`${li}-${si}`} transform={`translate(${cx}, ${baseline}) scale(${seg.scale})`}>
            <g transform={`translate(${-seg.box.vb.x}, 0)`} dangerouslySetInnerHTML={{ __html: inner }} />
          </g>,
        );
      }
      cx += seg.w;
    });
    cursorY += line.ascent + line.descent;
  });
  return (
    <g className={className} {...dataAttrs}>
      {items}
    </g>
  );
}
