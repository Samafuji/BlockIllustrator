import { DEFAULT_STYLE, DEdge, DNode, DStyle, Diagram, NODE_TYPES, NodeType, STYLE_KEYS, StyleKey, TypeDefaults, Point } from '../model/types';
import { ParseResult, Span } from './parser';

// ---------------------------------------------------------------------------
// Diagram -> DSL text
// ---------------------------------------------------------------------------

export function fmtNum(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r);
}

export function quote(s: string): string {
  // Mirror of the tokenizer: backslashes inside $...$ are literal.
  let out = '';
  let inMath = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') out += '\\"';
    else if (c === '\n') out += '\\n';
    else if (c === '\t') out += '\\t';
    else if (c === '$') {
      inMath = !inMath;
      out += c;
    } else if (c === '\\' && !inMath) {
      const e = s[i + 1];
      out += e === 'n' || e === 't' || e === '\\' || e === '"' ? '\\\\' : '\\';
    } else out += c;
  }
  return '"' + out + '"';
}

function colorTok(c: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(c) || /^[A-Za-z]+$/.test(c) ? c : quote(c);
}

/** Attribute text shared by node lines and per-type defaults in the style block. */
export function attrParts(o: TypeDefaults & { flip?: boolean; hidden?: boolean; labelOffset?: Point }, type: NodeType): string[] {
  const parts: string[] = [];
  if (o.w !== undefined || o.h !== undefined) {
    if (type === 'sum' || type === 'junction') {
      if (o.h !== undefined && o.w !== undefined && o.h !== o.w) parts.push(`size (${fmtNum(o.w)}, ${fmtNum(o.h)})`);
      else parts.push(`size (${fmtNum(o.w ?? o.h!)}, ${fmtNum(o.w ?? o.h!)})`);
    } else if (o.w !== undefined && o.h !== undefined) parts.push(`size (${fmtNum(o.w)}, ${fmtNum(o.h)})`);
    else if (o.w !== undefined) parts.push(`w ${fmtNum(o.w)}`);
    else if (o.h !== undefined) parts.push(`h ${fmtNum(o.h)}`);
  }
  if (o.fill !== undefined) parts.push(`fill ${colorTok(o.fill)}`);
  if (o.stroke !== undefined) parts.push(`stroke ${colorTok(o.stroke)}`);
  if (o.color !== undefined) parts.push(`color ${colorTok(o.color)}`);
  if (o.fontSize !== undefined) parts.push(`fontSize ${fmtNum(o.fontSize)}`);
  if (o.strokeWidth !== undefined) parts.push(`width ${fmtNum(o.strokeWidth)}`);
  if (o.radius !== undefined) parts.push(`radius ${fmtNum(o.radius)}`);
  if (o.flip) parts.push('flip');
  if (o.hidden === true) parts.push('hidden');
  else if (o.hidden === false) parts.push('visible');
  if (o.sumStyle !== undefined) parts.push(o.sumStyle);
  if (o.dash !== undefined && o.dash !== 'solid') parts.push(o.dash);
  if (o.labelPos !== undefined) parts.push(`caption ${o.labelPos}`);
  if (o.labelOffset) parts.push(`offset (${fmtNum(o.labelOffset.x)}, ${fmtNum(o.labelOffset.y)})`);
  return parts;
}

function srcTok(src: string): string {
  return /^[A-Za-z_][A-Za-z0-9_\-]*$/.test(src) ? src : quote(src);
}

export function nodeToLine(n: DNode): string {
  const parts: string[] = [n.type, n.id];
  if (n.label !== '') parts.push(quote(n.label));
  parts.push(`at (${fmtNum(n.x)}, ${fmtNum(n.y)})`);
  if (n.src !== undefined && n.src !== '') parts.push(`src ${srcTok(n.src)}`);
  parts.push(...attrParts(n, n.type));
  return parts.join(' ');
}

export function assetToLine(name: string, data: string): string {
  return `asset ${name} ${quote(data)}`;
}

/** Text of the embedded images (appended to the code when saving / copying). */
export function assetsToLines(assets: Record<string, string>, names?: Iterable<string>): string[] {
  const keys = names ? [...names] : Object.keys(assets);
  const out: string[] = [];
  for (const k of keys) if (assets[k] !== undefined) out.push(assetToLine(k, assets[k]));
  return out;
}

export function typeDefaultsToText(t: NodeType, d: TypeDefaults | undefined): string | null {
  if (!d) return null;
  const ap = attrParts(d, t);
  return ap.length ? `${t}: ${ap.join(' ')}` : null;
}

export function edgeToLine(e: DEdge): string {
  const from = e.from + (e.fromSide ? '.' + e.fromSide : '');
  const to = e.to + (e.toSide ? '.' + e.toSide : '');
  let arrowTok = '->';
  let arrowAttr: string | undefined;
  if (e.arrow === 'none') arrowTok = '--';
  else if (e.arrow === 'both') arrowTok = '<->';
  else if (e.arrow !== undefined) arrowAttr = e.arrow;
  const parts: string[] = [`${from} ${arrowTok} ${to}`];
  if (e.label !== undefined && e.label !== '') parts.push(`label ${quote(e.label)}`);
  if (e.sign !== undefined && e.sign !== '') parts.push(`sign ${quote(e.sign)}`);
  if (e.waypoints.length > 0) {
    parts.push('via ' + e.waypoints.map((p) => `(${fmtNum(p.x)}, ${fmtNum(p.y)})`).join(' '));
  }
  if (e.labelOffset) parts.push(`offset (${fmtNum(e.labelOffset.x)}, ${fmtNum(e.labelOffset.y)})`);
  if (arrowAttr) parts.push(`arrow ${arrowAttr}`);
  if (e.width !== undefined) parts.push(`width ${fmtNum(e.width)}`);
  if (e.color !== undefined) parts.push(`color ${colorTok(e.color)}`);
  if (e.dash !== undefined && e.dash !== 'solid') parts.push(e.dash);
  if (e.route === 'straight') parts.push('straight');
  if (e.fontSize !== undefined) parts.push(`fontSize ${fmtNum(e.fontSize)}`);
  return parts.join(' ');
}

export function styleValueToText(key: StyleKey, v: DStyle[StyleKey]): string {
  if (typeof v === 'number') return fmtNum(v);
  if (key === 'font') return quote(String(v));
  if (key === 'arrow' || key === 'junctionStyle') return String(v);
  return colorTok(String(v));
}

export function styleToLines(style: DStyle, all = false): string[] {
  const lines: string[] = ['style {'];
  for (const k of STYLE_KEYS) {
    if (all || style[k] !== DEFAULT_STYLE[k]) lines.push(`  ${k}: ${styleValueToText(k, style[k])}`);
  }
  for (const t of NODE_TYPES) {
    const text = typeDefaultsToText(t, style.defaults[t]);
    if (text) lines.push('  ' + text);
  }
  lines.push('}');
  return lines;
}

export function generate(d: Diagram): string {
  const out: string[] = [];
  out.push('// Block Illustrator diagram');
  out.push(...styleToLines(d.style));
  out.push('');
  out.push('// --- nodes ---');
  for (const n of d.nodes) out.push(nodeToLine(n));
  out.push('');
  out.push('// --- connections ---');
  for (const e of d.edges) out.push(edgeToLine(e));
  out.push('');
  const assets = assetsToLines(d.assets);
  if (assets.length) {
    out.push('// --- images ---');
    out.push(...assets);
    out.push('');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Incremental sync: patch only the lines that changed
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) o[k] = normalize(val);
    }
    return o;
  }
  return v;
}

interface Op {
  start: number;
  end: number; // inclusive; end < start means pure insertion at `start`
  lines: string[];
}

export interface SyncOptions {
  /** map newNodeId -> oldNodeId for renamed nodes */
  renamed?: Record<string, string>;
}

export function syncCode(code: string, prev: ParseResult, next: Diagram, opts: SyncOptions = {}): string {
  const lines = code.split('\n');
  const ops: Op[] = [];
  const renamed = opts.renamed ?? {};
  const prevNodes = new Map(prev.diagram.nodes.map((n) => [n.id, n]));
  const prevEdges = new Map(prev.diagram.edges.map((e) => [e.id, e]));

  // ---- nodes
  const usedOld = new Set<string>();
  const newNodeLines: string[] = [];
  for (const n of next.nodes) {
    const oldId = renamed[n.id] ?? n.id;
    const old = prevNodes.get(oldId);
    const span = prev.nodeSpans[oldId];
    if (old && span) {
      usedOld.add(oldId);
      if (!deepEqual(old, n)) ops.push({ start: span.start, end: span.end, lines: [nodeToLine(n)] });
    } else {
      newNodeLines.push(nodeToLine(n));
    }
  }
  for (const [id] of prevNodes) {
    if (!usedOld.has(id)) {
      const span = prev.nodeSpans[id];
      if (span) ops.push({ start: span.start, end: span.end, lines: [] });
    }
  }

  // ---- edges
  const usedOldEdges = new Set<string>();
  const newEdgeLines: string[] = [];
  for (const e of next.edges) {
    const old = prevEdges.get(e.id);
    const span = prev.edgeSpans[e.id];
    if (old && span) {
      usedOldEdges.add(e.id);
      if (!deepEqual(old, e)) ops.push({ start: span.start, end: span.end, lines: [edgeToLine(e)] });
    } else {
      newEdgeLines.push(edgeToLine(e));
    }
  }
  for (const [id] of prevEdges) {
    if (!usedOldEdges.has(id)) {
      const span = prev.edgeSpans[id];
      if (span) ops.push({ start: span.start, end: span.end, lines: [] });
    }
  }

  // ---- assets written inside the code itself (normally they are kept apart, see the store)
  for (const [name, span] of Object.entries(prev.assetSpans)) {
    const v = next.assets[name];
    if (v === undefined) ops.push({ start: span.start, end: span.end, lines: [] });
    else if (v !== prev.diagram.assets[name]) ops.push({ start: span.start, end: span.end, lines: [assetToLine(name, v)] });
  }

  // ---- style (scalar keys + per-type defaults)
  const entries: { lineKey: string; text: string | null }[] = [];
  for (const k of STYLE_KEYS) {
    if (prev.diagram.style[k] !== next.style[k]) entries.push({ lineKey: k, text: `${k}: ${styleValueToText(k, next.style[k])}` });
  }
  for (const t of NODE_TYPES) {
    if (deepEqual(prev.diagram.style.defaults[t] ?? {}, next.style.defaults[t] ?? {})) continue;
    entries.push({ lineKey: 'type:' + t, text: typeDefaultsToText(t, next.style.defaults[t]) });
  }
  if (entries.length > 0) {
    if (prev.styleSpan && prev.styleSpan.end > prev.styleSpan.start) {
      const insertLines: string[] = [];
      for (const en of entries) {
        const li = prev.styleKeyLines[en.lineKey];
        if (li !== undefined) {
          if (en.text === null) {
            ops.push({ start: li, end: li, lines: [] });
          } else {
            const indent = (lines[li].match(/^\s*/) ?? [''])[0] || '  ';
            ops.push({ start: li, end: li, lines: [indent + en.text] });
          }
        } else if (en.text !== null) {
          insertLines.push('  ' + en.text);
        }
      }
      if (insertLines.length) ops.push({ start: prev.styleSpan.end, end: prev.styleSpan.end - 1, lines: insertLines });
    } else if (prev.styleSpan) {
      // single-line style block: rewrite it fully
      ops.push({ start: prev.styleSpan.start, end: prev.styleSpan.end, lines: styleToLines(next.style) });
    } else {
      ops.push({ start: 0, end: -1, lines: [...styleToLines(next.style), ''] });
    }
  }

  // ---- insert positions
  if (newNodeLines.length > 0) {
    const nodeEnds = Object.values(prev.nodeSpans).map((s) => s.end);
    let pos: number;
    if (nodeEnds.length) pos = Math.max(...nodeEnds) + 1;
    else if (prev.styleSpan) pos = prev.styleSpan.end + 1;
    else pos = 0;
    ops.push({ start: pos, end: pos - 1, lines: newNodeLines });
  }
  if (newEdgeLines.length > 0) {
    let pos = lines.length;
    // keep trailing blank line at the end of file
    while (pos > 0 && lines[pos - 1].trim() === '') pos--;
    ops.push({ start: pos, end: pos - 1, lines: newEdgeLines });
  }

  // apply ops bottom-up; for equal start, range ops before insertions
  ops.sort((a, b) => {
    if (b.start !== a.start) return b.start - a.start;
    const aIns = a.end < a.start ? 1 : 0;
    const bIns = b.end < b.start ? 1 : 0;
    return aIns - bIns;
  });
  for (const op of ops) {
    const count = op.end >= op.start ? op.end - op.start + 1 : 0;
    lines.splice(op.start, count, ...op.lines);
  }
  return lines.join('\n');
}

export function spanOfNode(p: ParseResult, id: string): Span | undefined {
  return p.nodeSpans[id];
}
