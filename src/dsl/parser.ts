import {
  ARROW_KINDS,
  ArrowKind,
  LABEL_POSITIONS,
  LabelPos,
  DEFAULT_STYLE,
  DEdge,
  DNode,
  DStyle,
  Diagram,
  NODE_TYPES,
  NodeType,
  SIDES,
  STYLE_KEYS,
  Side,
  StyleKey,
  TypeDefaults,
} from '../model/types';
import { t as tr } from '../i18n';

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

export type TokKind = 'ident' | 'num' | 'str' | 'color' | 'arrow' | 'punct';
export interface Token {
  kind: TokKind;
  value: string;
  col: number;
}

export function tokenizeLine(line: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '/' && line[i + 1] === '/') break; // comment
    const start = i;
    if (c === '"') {
      // Inside $...$ (math) backslashes are kept literally so that LaTeX such as
      // \nu or \theta is not mistaken for the \n / \t escapes.
      let s = '';
      let inMath = false;
      i++;
      while (i < n && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < n) {
          const e = line[i + 1];
          if (e === '"') s += '"';
          else if (inMath) s += '\\' + e;
          else if (e === 'n') s += '\n';
          else if (e === 't') s += '\t';
          else if (e === '\\') s += '\\';
          else s += '\\' + e;
          i += 2;
        } else {
          if (line[i] === '$') inMath = !inMath;
          s += line[i++];
        }
      }
      if (i >= n) throw new Error(tr('文字列が閉じられていません (")'));
      i++; // closing quote
      toks.push({ kind: 'str', value: s, col: start });
      continue;
    }
    if (c === '#') {
      let j = i + 1;
      while (j < n && /[0-9a-fA-F]/.test(line[j])) j++;
      const len = j - i - 1;
      if (len === 3 || len === 4 || len === 6 || len === 8) {
        toks.push({ kind: 'color', value: line.slice(i, j), col: start });
        i = j;
        continue;
      }
      throw new Error(tr('不正なカラー値: {v}', { v: line.slice(i, j) }));
    }
    if (/[0-9]/.test(c) || ((c === '-' || c === '+') && /[0-9.]/.test(line[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < n && /[0-9.]/.test(line[j])) j++;
      const v = line.slice(i, j);
      if (isNaN(Number(v))) throw new Error(tr('不正な数値: {v}', { v }));
      toks.push({ kind: 'num', value: v, col: start });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_\-]/.test(line[j])) j++;
      toks.push({ kind: 'ident', value: line.slice(i, j), col: start });
      i = j;
      continue;
    }
    if (line.startsWith('<->', i)) {
      toks.push({ kind: 'arrow', value: '<->', col: start });
      i += 3;
      continue;
    }
    if (line.startsWith('->', i) || line.startsWith('<-', i) || line.startsWith('--', i)) {
      toks.push({ kind: 'arrow', value: line.slice(i, i + 2), col: start });
      i += 2;
      continue;
    }
    if ('(),{}:=.+-*;'.includes(c)) {
      toks.push({ kind: 'punct', value: c, col: start });
      i++;
      continue;
    }
    throw new Error(tr("解釈できない文字: '{v}'", { v: c }));
  }
  return toks;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface Span {
  start: number; // 0-based line index (inclusive)
  end: number; // inclusive
}
export interface ParseError {
  line: number; // 1-based
  message: string;
}
export interface ParseResult {
  diagram: Diagram;
  errors: ParseError[];
  nodeSpans: Record<string, Span>;
  edgeSpans: Record<string, Span>;
  styleSpan?: Span;
  /** line index of each style entry: scalar keys by name, per-type defaults as "type:<nodeType>" */
  styleKeyLines: Record<string, number>;
  /** line index of each `asset` statement */
  assetSpans: Record<string, Span>;
}

const TYPE_ALIASES: Record<string, NodeType> = {
  box: 'block',
  rect: 'block',
  input: 'text',
  output: 'text',
  label: 'text',
  dot: 'junction',
  branch: 'junction',
  node: 'junction',
  ellipse: 'circle',
  triangle: 'gain',
  img: 'image',
  picture: 'image',
  photo: 'image',
};

const STYLE_ALIASES: Record<string, StyleKey> = {};
for (const k of STYLE_KEYS) {
  STYLE_ALIASES[k.toLowerCase()] = k;
  STYLE_ALIASES[k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())] = k;
}

class Cursor {
  i = 0;
  constructor(public toks: Token[]) {}
  peek(off = 0): Token | undefined {
    return this.toks[this.i + off];
  }
  next(): Token | undefined {
    return this.toks[this.i++];
  }
  done(): boolean {
    return this.i >= this.toks.length;
  }
  isPunct(v: string, off = 0): boolean {
    const t = this.peek(off);
    return !!t && t.kind === 'punct' && t.value === v;
  }
  expectPunct(v: string): void {
    const t = this.next();
    if (!t || t.kind !== 'punct' || t.value !== v) {
      throw new Error(tr("'{v}' が必要です", { v }) + (t ? tr(" (位置: '{v}')", { v: t.value }) : ''));
    }
  }
  expectNum(what = tr('数値')): number {
    const t = this.next();
    if (!t || t.kind !== 'num') throw new Error(tr('{what}が必要です', { what }) + (t ? tr(" (位置: '{v}')", { v: t.value }) : ''));
    return Number(t.value);
  }
  expectIdent(what = tr('識別子')): string {
    const t = this.next();
    if (!t || t.kind !== 'ident') throw new Error(tr('{what}が必要です', { what }) + (t ? tr(" (位置: '{v}')", { v: t.value }) : ''));
    return t.value;
  }
  expectStr(what = tr('文字列')): string {
    const t = this.next();
    if (!t || t.kind !== 'str') throw new Error(tr('{what}が必要です', { what }) + (t ? tr(" (位置: '{v}')", { v: t.value }) : ''));
    return t.value;
  }
  /** (x, y) or x, y or x y */
  readPoint(): { x: number; y: number } {
    const paren = this.isPunct('(');
    if (paren) this.next();
    const x = this.expectNum(tr('X座標'));
    if (this.isPunct(',')) this.next();
    const y = this.expectNum(tr('Y座標'));
    if (paren) this.expectPunct(')');
    return { x, y };
  }
  readColor(): string {
    const t = this.next();
    if (!t) throw new Error(tr('色の値が必要です'));
    if (t.kind === 'color' || t.kind === 'ident' || t.kind === 'str') return t.value;
    throw new Error(tr("色の値が不正です: '{v}'", { v: t.value }));
  }
}

/** One entry inside a style block: `key: value` or `<nodeType>: <node attributes>` */
function parseStyleEntry(c: Cursor, style: DStyle, styleKeyLines: Record<string, number>, li: number): void {
  const keyTok = c.next()!;
  const kl = keyTok.value.toLowerCase();
  const key = STYLE_ALIASES[kl];
  if (c.isPunct(':') || c.isPunct('=')) c.next();
  if (key) {
    (style as any)[key] = parseStyleValue(key, c);
    styleKeyLines[key] = li;
    return;
  }
  const t: NodeType | undefined = NODE_TYPES.includes(kl as NodeType) ? (kl as NodeType) : TYPE_ALIASES[kl];
  if (!t) throw new Error(tr('未知のスタイル項目: {v}', { v: keyTok.value }));
  const d: TypeDefaults = {};
  parseAttrs(d, c, { allowPosition: false, stopAtPunct: true });
  style.defaults = { ...style.defaults, [t]: d };
  styleKeyLines['type:' + t] = li;
}

function parseStyleValue(key: StyleKey, c: Cursor): DStyle[StyleKey] {
  const def = DEFAULT_STYLE[key];
  const t = c.next();
  if (!t) throw new Error(tr('{key} の値が必要です', { key }));
  if (typeof def === 'number') {
    if (t.kind !== 'num') throw new Error(tr('{key} は数値で指定してください', { key }));
    return Number(t.value);
  }
  if (key === 'arrow') {
    if (!ARROW_KINDS.includes(t.value as ArrowKind)) {
      throw new Error(tr('arrow は {v} のいずれかです', { v: ARROW_KINDS.join(' | ') }));
    }
    return t.value as ArrowKind;
  }
  if (key === 'junctionStyle') {
    if (t.value !== 'dot' && t.value !== 'none') throw new Error(tr('junctionStyle は dot | none のいずれかです'));
    return t.value;
  }
  // string (font, colors)
  if (t.kind === 'str' || t.kind === 'color' || t.kind === 'ident') {
    // font may contain commas when unquoted: Arial, sans-serif
    let v = t.value;
    if (key === 'font' && t.kind !== 'str') {
      while (!c.done() && !c.isPunct('}') && !c.isPunct(';')) {
        const n = c.next()!;
        v += n.kind === 'punct' && n.value === ',' ? ',' : ' ' + n.value;
      }
    }
    return v;
  }
  throw new Error(tr('{key} の値が不正です', { key }));
}

export function parse(code: string): ParseResult {
  const lines = code.split('\n');
  const errors: ParseError[] = [];
  const style: DStyle = { ...DEFAULT_STYLE, defaults: {} };
  const nodes: DNode[] = [];
  const nodeSpans: Record<string, Span> = {};
  const assetSpans: Record<string, Span> = {};
  const assets: Record<string, string> = {};
  const styleKeyLines: Record<string, number> = {};
  let styleSpan: Span | undefined;
  const rawEdges: { edge: Omit<DEdge, 'id'>; line: number }[] = [];

  let inStyle = false;
  let styleStart = -1;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let toks: Token[];
    try {
      toks = tokenizeLine(line);
    } catch (e) {
      errors.push({ line: li + 1, message: (e as Error).message });
      continue;
    }
    if (toks.length === 0) continue;

    try {
      const c = new Cursor(toks);
      if (inStyle) {
        if (c.isPunct('}')) {
          inStyle = false;
          styleSpan = { start: styleStart, end: li };
          continue;
        }
        parseStyleEntry(c, style, styleKeyLines, li);
        if (c.isPunct(';')) c.next();
        if (!c.done()) throw new Error(tr("余分なトークン: '{v}'", { v: c.peek()!.value }));
        continue;
      }

      const first = c.peek()!;
      if (first.kind === 'ident' && first.value === 'style' && c.isPunct('{', 1)) {
        c.next();
        c.expectPunct('{');
        if (c.done()) {
          inStyle = true;
          styleStart = li;
          continue;
        }
        // single-line style { key: v; key: v }
        let closed = false;
        while (!c.done()) {
          if (c.isPunct('}')) {
            c.next();
            closed = true;
            break;
          }
          if (c.isPunct(',') || c.isPunct(';')) {
            c.next();
            continue;
          }
          parseStyleEntry(c, style, styleKeyLines, li);
        }
        if (!closed) throw new Error(tr('style ブロックが閉じられていません (})'));
        styleSpan = { start: li, end: li };
        continue;
      }

      // asset statement: asset <name> "data:image/...;base64,..."
      if (first.kind === 'ident' && first.value.toLowerCase() === 'asset' && c.peek(1)?.kind === 'ident') {
        c.next();
        const name = c.expectIdent(tr('アセット名'));
        const data = c.expectStr(tr('画像データ (data URL)'));
        if (!c.done()) throw new Error(tr("余分なトークン: '{v}'", { v: c.peek()!.value }));
        assets[name] = data;
        assetSpans[name] = { start: li, end: li };
        continue;
      }

      // node statement: <type> <id> ...
      const typeName = first.kind === 'ident' ? first.value.toLowerCase() : '';
      const nodeType: NodeType | undefined = NODE_TYPES.includes(typeName as NodeType)
        ? (typeName as NodeType)
        : TYPE_ALIASES[typeName];
      const second = c.peek(1);
      if (nodeType && second && second.kind === 'ident') {
        c.next();
        const node = parseNode(nodeType, c);
        if (nodes.some((n) => n.id === node.id)) throw new Error(tr('ID が重複しています: {v}', { v: node.id }));
        nodes.push(node);
        nodeSpans[node.id] = { start: li, end: li };
        continue;
      }

      // edge statement
      if (first.kind === 'ident') {
        const edge = parseEdge(c);
        rawEdges.push({ edge, line: li });
        continue;
      }
      throw new Error(tr("文の先頭を解釈できません: '{v}'", { v: first.value }));
    } catch (e) {
      errors.push({ line: li + 1, message: (e as Error).message });
    }
  }
  if (inStyle) {
    errors.push({ line: styleStart + 1, message: tr('style ブロックが閉じられていません (})') });
    styleSpan = { start: styleStart, end: lines.length - 1 };
  }

  // resolve edges
  const edges: DEdge[] = [];
  const edgeSpans: Record<string, Span> = {};
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const { edge, line } of rawEdges) {
    if (!nodeIds.has(edge.from)) {
      errors.push({ line: line + 1, message: tr('未定義のノード: {v}', { v: edge.from }) });
      continue;
    }
    if (!nodeIds.has(edge.to)) {
      errors.push({ line: line + 1, message: tr('未定義のノード: {v}', { v: edge.to }) });
      continue;
    }
    const id = `e${edges.length + 1}`;
    edges.push({ id, ...edge });
    edgeSpans[id] = { start: line, end: line };
  }

  errors.sort((a, b) => a.line - b.line);
  return {
    diagram: { style, nodes, edges, assets },
    errors,
    nodeSpans,
    edgeSpans,
    styleSpan,
    styleKeyLines,
    assetSpans,
  };
}

/** Attribute target: a node, or a per-type defaults object inside the style block. */
interface AttrTarget extends TypeDefaults {
  x?: number;
  y?: number;
  label?: string;
  flip?: boolean;
  hidden?: boolean;
  src?: string;
}

/** Parse `size (w, h) fill #.. stroke #.. ...` attributes. Returns whether a position was given. */
function parseAttrs(o: AttrTarget, c: Cursor, opts: { allowPosition: boolean; stopAtPunct?: boolean }): boolean {
  let hasPos = false;
  const nodeOnly = (t: Token) => {
    if (!opts.allowPosition) throw new Error(tr("既定値 (style) では '{v}' は使えません", { v: t.value }));
  };
  while (!c.done()) {
    if (opts.stopAtPunct && (c.isPunct('}') || c.isPunct(';'))) break;
    const t = c.next()!;
    const key = t.kind === 'ident' ? t.value.toLowerCase() : t.value;
    switch (key) {
      case 'at':
      case 'pos': {
        nodeOnly(t);
        const p = c.readPoint();
        o.x = p.x;
        o.y = p.y;
        hasPos = true;
        break;
      }
      case 'size': {
        const p = c.readPoint();
        o.w = p.x;
        o.h = p.y;
        break;
      }
      case 'w':
        o.w = c.expectNum();
        break;
      case 'h':
        o.h = c.expectNum();
        break;
      case 'fill':
        o.fill = c.readColor();
        break;
      case 'stroke':
        o.stroke = c.readColor();
        break;
      case 'color':
      case 'textcolor':
        o.color = c.readColor();
        break;
      case 'fontsize':
      case 'font-size':
        o.fontSize = c.expectNum();
        break;
      case 'width':
      case 'strokewidth':
      case 'stroke-width':
      case 'lw':
        o.strokeWidth = c.expectNum();
        break;
      case 'radius':
      case 'r':
        o.radius = c.expectNum();
        break;
      case 'flip':
        nodeOnly(t);
        o.flip = true;
        break;
      case 'hidden':
      case 'nodot':
        nodeOnly(t);
        o.hidden = true;
        break;
      case 'visible':
      case 'dot':
        nodeOnly(t);
        o.hidden = false;
        break;
      case 'plain':
      case 'cross':
      case 'sigma':
        o.sumStyle = key;
        break;
      case 'label':
        nodeOnly(t);
        o.label = c.expectStr(tr('ラベル'));
        break;
      case 'dashed':
      case 'dotted':
      case 'solid':
        o.dash = key;
        break;
      case 'caption':
      case 'labelpos':
      case 'label-pos': {
        const v = c.expectIdent(tr('caption の位置 (center|top|bottom|left|right)')).toLowerCase();
        const map: Record<string, LabelPos> = { inside: 'center', middle: 'center', below: 'bottom', above: 'top' };
        const pos = (map[v] ?? v) as LabelPos;
        if (!LABEL_POSITIONS.includes(pos)) throw new Error(tr('caption は {v} のいずれかです', { v: LABEL_POSITIONS.join(' | ') }));
        o.labelPos = pos;
        break;
      }
      case 'src':
      case 'image': {
        nodeOnly(t);
        const v = c.next();
        if (!v || (v.kind !== 'ident' && v.kind !== 'str')) throw new Error(tr('src の後にアセット名か URL が必要です'));
        o.src = v.value;
        break;
      }
      default:
        throw new Error(tr("未知の属性: '{v}'", { v: t.value }));
    }
  }
  return hasPos;
}

function parseNode(type: NodeType, c: Cursor): DNode {
  const id = c.expectIdent(tr('ノードID'));
  const node: DNode = { id, type, label: '', x: 0, y: 0 };
  if (c.peek()?.kind === 'str') node.label = c.next()!.value;
  const hasPos = parseAttrs(node, c, { allowPosition: true });
  if (!hasPos) throw new Error(tr('ノード {v} に位置 (at (x, y)) がありません', { v: id }));
  if (type === 'sum' && node.w !== undefined && node.h === undefined) node.h = node.w;
  return node;
}

function parseSide(c: Cursor): Side | undefined {
  if (c.isPunct('.')) {
    c.next();
    const s = c.expectIdent(tr('辺 (left|right|top|bottom)')).toLowerCase();
    const map: Record<string, Side> = {
      l: 'left',
      r: 'right',
      t: 'top',
      b: 'bottom',
      n: 'top',
      s: 'bottom',
      e: 'right',
      w: 'left',
    };
    const side = (map[s] ?? s) as Side;
    if (!SIDES.includes(side)) throw new Error(tr('辺の指定が不正です: {v}', { v: s }));
    return side;
  }
  return undefined;
}

function parseEdge(c: Cursor): Omit<DEdge, 'id'> {
  const from = c.expectIdent(tr('接続元ノード'));
  const fromSide = parseSide(c);
  const arrowTok = c.next();
  if (!arrowTok || arrowTok.kind !== 'arrow') {
    throw new Error(tr("'->' が必要です") + (arrowTok ? tr(" (位置: '{v}')", { v: arrowTok.value }) : ''));
  }
  const to = c.expectIdent(tr('接続先ノード'));
  const toSide = parseSide(c);
  const edge: Omit<DEdge, 'id'> = { from, to, fromSide, toSide, waypoints: [], route: 'auto' };
  if (arrowTok.value === '<-') {
    edge.from = to;
    edge.to = from;
    edge.fromSide = toSide;
    edge.toSide = fromSide;
  } else if (arrowTok.value === '--') edge.arrow = 'none';
  else if (arrowTok.value === '<->') edge.arrow = 'both';

  while (!c.done()) {
    const t = c.next()!;
    const key = t.kind === 'ident' ? t.value.toLowerCase() : t.value;
    switch (key) {
      case 'label':
        edge.label = c.expectStr(tr('ラベル'));
        break;
      case 'sign': {
        const s = c.next();
        if (!s) throw new Error(tr('sign の値が必要です'));
        if (s.kind === 'str') edge.sign = s.value;
        else if (s.kind === 'punct' && (s.value === '+' || s.value === '-')) edge.sign = s.value;
        else if (s.kind === 'ident' && s.value === 'plus') edge.sign = '+';
        else if (s.kind === 'ident' && s.value === 'minus') edge.sign = '-';
        else throw new Error(tr("sign の値が不正です: '{v}'", { v: s.value }));
        break;
      }
      case 'via':
      case 'through':
      case 'points': {
        let count = 0;
        while (c.isPunct('(') || c.peek()?.kind === 'num') {
          edge.waypoints.push(c.readPoint());
          count++;
        }
        if (count === 0) throw new Error(tr('via の後に座標 (x, y) が必要です'));
        break;
      }
      case 'offset':
      case 'labeloffset':
        edge.labelOffset = c.readPoint();
        break;
      case 'arrow': {
        const a = c.expectIdent(tr('矢印種別')).toLowerCase() as ArrowKind;
        if (!ARROW_KINDS.includes(a)) throw new Error(tr('arrow は {v} のいずれかです', { v: ARROW_KINDS.join(' | ') }));
        edge.arrow = a;
        break;
      }
      case 'width':
      case 'lw':
        edge.width = c.expectNum();
        break;
      case 'color':
      case 'stroke':
        edge.color = c.readColor();
        break;
      case 'dashed':
      case 'dotted':
      case 'solid':
        edge.dash = key;
        break;
      case 'straight':
        edge.route = 'straight';
        break;
      case 'auto':
      case 'ortho':
      case 'orthogonal':
        edge.route = 'auto';
        break;
      case 'fontsize':
      case 'font-size':
        edge.fontSize = c.expectNum();
        break;
      default:
        throw new Error(tr("未知の属性: '{v}'", { v: t.value }));
    }
  }
  return edge;
}
