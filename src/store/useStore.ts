import { create } from 'zustand';
import { assetsToLines, edgeToLine, nodeToLine, syncCode } from '../dsl/generator';
import { ParseResult, parse } from '../dsl/parser';
import {
  Assets,
  DEdge,
  DNode,
  Diagram,
  NODE_STYLE_KEYS,
  NodeType,
  Point,
  Side,
  TYPE_PREFIX,
  TextAlign,
  cloneDiagram,
  nextId,
  resolveEdgeText,
  resolveNode,
  usedAssets,
} from '../model/types';
import { EXAMPLES } from '../examples';
import { followEdgesAfterMove, polylineLength, polylineMid } from '../geometry/geometry';
import { DiagramLayout, layoutDiagram } from '../render/layout';

export interface SelectionState {
  nodes: string[];
  edges: string[];
  /** ids of the connections whose *label* is selected (as a movable piece of text) */
  labels: string[];
}

/** Something the align / distribute commands can move: a node, or the label of a connection. */
export interface AlignItem {
  kind: 'node' | 'label';
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Bounding boxes of the given connection labels (labels that do not exist are skipped). */
export function labelBoxes(lay: DiagramLayout, ids: Iterable<string>): AlignItem[] {
  const out: AlignItem[] = [];
  for (const id of ids) {
    const el = lay.edges.find((x) => x.edge.id === id);
    if (el?.label) out.push({ kind: 'label', id, cx: el.label.pos.x, cy: el.label.pos.y, w: el.label.layout.w, h: el.label.layout.h });
  }
  return out;
}

/**
 * Set the `offset` of each connection label so that its center lands on the given
 * world position. Called after nodes were moved, so a label keeps its absolute
 * position (or reaches its target) whatever its line did in the meantime.
 */
export function placeEdgeLabels(d: Diagram, targets: Map<string, Point>): void {
  if (targets.size === 0) return;
  const lay = layoutDiagram(d);
  for (const el of lay.edges) {
    const tg = targets.get(el.edge.id);
    if (!tg || !el.label) continue;
    const e = d.edges.find((x) => x.id === el.edge.id);
    if (e) e.labelOffset = { x: Math.round((tg.x - el.label.mid.x) * 10) / 10, y: Math.round((tg.y - el.label.mid.y) * 10) / 10 };
  }
}

export interface ViewState {
  x: number;
  y: number;
  zoom: number;
}

const AUTOSAVE_KEY = 'blockillustrator.autosave.v1';
const ASSETS_KEY = 'blockillustrator.autosave.assets.v1';
const MAX_HISTORY = 200;

export interface StoreState {
  code: string;
  parse: ParseResult;
  diagram: Diagram;
  /**
   * Embedded images (name -> data URL). Kept apart from `code` so the editor and the
   * undo history stay small; they are appended as `asset` lines when saving / copying.
   */
  assets: Assets;
  /** shown in the status bar when the browser autosave could not store the images */
  autosaveWarning: string | null;
  /** incremented whenever `code` was changed by something other than the editor */
  codeVersion: number;
  selection: SelectionState;
  hoverNode: string | null;
  view: ViewState;
  showGrid: boolean;
  snap: boolean;
  showCode: boolean;
  /** move `via` waypoints together with the blocks they connect */
  followEdges: boolean;
  /** connect mode: dragging from a node to another node creates a connection */
  connectMode: boolean;
  setConnectMode: (on: boolean) => void;
  past: string[];
  future: string[];
  fileName: string | null;
  fileHandle: FileSystemFileHandle | null;
  dirty: boolean;
  focusLabelRequest: number;
  /** line (0-based) to reveal in the code editor */
  revealLine: { line: number; v: number } | null;

  // ---- code side
  setCodeFromEditor: (code: string) => void;
  loadCode: (code: string, file?: { name: string | null; handle: FileSystemFileHandle | null }) => void;
  markSaved: (name: string, handle: FileSystemFileHandle | null) => void;
  /** full .bd text: the code plus the embedded images that are in use */
  serialize: () => string;
  /** embed an image; returns the name actually used (identical data reuses the existing name) */
  addAsset: (name: string, data: string) => string;
  /** add an image node showing an asset (size in diagram units) */
  addImageNode: (src: string, at: { x: number; y: number }, size: { w: number; h: number }) => string;

  // ---- GUI side
  liveUpdate: (fn: (d: Diagram) => void) => void;
  /** `coalesce`: consecutive commits with the same key within ~1.2 s share one undo step (color pickers, spinners) */
  commit: (fn?: (d: Diagram) => void, opts?: { renamed?: Record<string, string>; coalesce?: string }) => void;
  undo: () => void;
  redo: () => void;

  // ---- selection / view
  setSelection: (sel: SelectionState) => void;
  selectNode: (id: string, additive?: boolean) => void;
  selectEdge: (id: string) => void;
  /** select the label of a connection (additive: toggle it in the current selection) */
  selectLabel: (edgeId: string, additive?: boolean) => void;
  /** select every piece of free text: text nodes and connection labels */
  selectAllText: () => void;
  clearSelection: () => void;
  setHover: (id: string | null) => void;
  setView: (v: ViewState) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  toggleCode: () => void;
  toggleFollowEdges: () => void;
  requestFocusLabel: () => void;

  // ---- high level edits
  addNode: (type: NodeType, at: { x: number; y: number }) => string;
  addEdge: (from: string, to: string, fromSide?: Side, toSide?: Side) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  /** DSL text of the selected nodes and the connections between them (for the clipboard) */
  copySelectionText: () => string;
  /** paste DSL text (from copySelectionText or any .bd snippet); returns false if nothing was pasted */
  pasteText: (text: string) => boolean;
  renameNode: (oldId: string, newId: string) => boolean;
  updateNode: (id: string, patch: Partial<DNode>, live?: boolean) => void;
  updateEdge: (id: string, patch: Partial<DEdge>, live?: boolean) => void;
  updateStyle: (patch: Partial<Diagram['style']>, live?: boolean) => void;
  nudgeSelection: (dx: number, dy: number) => void;
  /** split an edge at a point (nearest point on the line; the middle if omitted) by inserting a junction */
  insertJunctionOnEdge: (edgeId: string, at?: { x: number; y: number }) => string | null;
  alignSelection: (mode: AlignMode) => void;
  distributeSelection: (axis: 'x' | 'y') => void;
  /** give every selected shape the size of the reference shape (the last one selected, or `refId`) */
  sameSizeSelection: (refId?: string) => void;
  /** copy size and/or style from the reference node (the last one selected, or `refId`) to the rest of the selection */
  matchSelection: (what: MatchWhat, refId?: string) => void;
  /** remove the explicit size / style of everything selected so it follows the defaults again */
  resetSelection: () => void;
  /** change properties of everything selected (nodes, lines, line labels) in one undo step */
  updateSelection: (patch: SelectionPatch, live?: boolean) => void;
  /** bold / italic / underline for the selected text: on if any selected item lacks it, else off */
  toggleTextStyle: (key: 'bold' | 'italic' | 'underline') => void;
  /** turn the selected nodes by ±90° */
  rotateSelection: (delta: 90 | -90) => void;
}

export type MatchWhat = 'size' | 'style' | 'text' | 'all';

/** A bulk edit: node fields apply to the selected nodes, edge fields to selected lines and line labels. */
export interface SelectionPatch {
  node?: Partial<DNode>;
  edge?: Partial<DEdge>;
}

/** The node whose settings the "match" commands copy: the last one added to the selection. */
export function referenceNodeId(sel: SelectionState): string | undefined {
  return sel.nodes[sel.nodes.length - 1];
}

const NODE_SIZE_KEYS: (keyof DNode)[] = ['w', 'h'];
const NODE_LOOK_KEYS: (keyof DNode)[] = ['fill', 'stroke', 'strokeWidth', 'radius', 'dash'];
const NODE_TEXT_KEYS: (keyof DNode)[] = ['color', 'fontSize', 'bold', 'italic', 'underline', 'font', 'textAlign'];
const EDGE_TEXT_KEYS: (keyof DEdge)[] = ['fontSize', 'bold', 'italic', 'font', 'textAlign'];
const EDGE_STYLE_KEYS: (keyof DEdge)[] = ['color', 'width', 'dash', 'arrow', 'arrowSize', 'jump', ...EDGE_TEXT_KEYS];

function copyKeys<T extends object>(from: T, to: T, keys: (keyof T)[]): void {
  for (const k of keys) {
    if (from[k] === undefined) delete to[k];
    else (to as any)[k] = JSON.parse(JSON.stringify(from[k]));
  }
}

function assignPatch<T extends object>(target: T, patch: Partial<T>): void {
  for (const k of Object.keys(patch) as (keyof T)[]) {
    if (patch[k] === undefined) delete target[k];
    else (target as any)[k] = patch[k];
  }
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

function initialCode(): string {
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved && saved.trim()) return saved;
  } catch {
    /* ignore */
  }
  return EXAMPLES[0].code;
}

function initialAssets(): Assets {
  try {
    const saved = localStorage.getItem(ASSETS_KEY);
    if (saved) {
      const v = JSON.parse(saved);
      if (v && typeof v === 'object') return v as Assets;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** Parse the code and merge the separately stored images into the diagram. */
function parseWith(code: string, assets: Assets): ParseResult {
  const p = parse(code);
  p.diagram.assets = { ...p.diagram.assets, ...assets };
  return p;
}

const ASSET_MARKER_RE = /^\s*\/\/\s*-+\s*images\s*-+\s*$/i;

/** Split `asset` lines (and their "// --- images ---" marker) off a .bd text. */
export function splitAssets(text: string): { code: string; assets: Assets } {
  const p = parse(text);
  const drop = new Set<number>();
  for (const span of Object.values(p.assetSpans)) for (let i = span.start; i <= span.end; i++) drop.add(i);
  if (drop.size === 0) return { code: text, assets: {} };
  const lines = text.split('\n');
  const kept = lines.filter((l, i) => !drop.has(i) && !ASSET_MARKER_RE.test(l));
  // collapse the blank lines left behind at the end
  while (kept.length > 1 && kept[kept.length - 1].trim() === '' && kept[kept.length - 2].trim() === '') kept.pop();
  return { code: kept.join('\n'), assets: p.diagram.assets };
}

function sanitizeAssetName(name: string): string {
  let s = name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s || !/^[A-Za-z_]/.test(s)) s = 'img' + (s ? '_' + s : '');
  return s;
}

function readBool(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
}

let autosaveTimer: number | undefined;
let assetsTimer: number | undefined;
let lastCommit: { key: string | null; time: number } = { key: null, time: 0 };
let lastCopied: { text: string; pastes: number } | null = null;
function scheduleAutosave(code: string) {
  if (autosaveTimer) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, code);
    } catch {
      /* ignore */
    }
  }, 500);
}

export const useStore = create<StoreState>((set, get) => {
  const code0 = initialCode();
  const assets0 = initialAssets();
  const parse0 = parseWith(code0, assets0);

  function scheduleAssetsAutosave(assets: Assets) {
    if (assetsTimer) window.clearTimeout(assetsTimer);
    assetsTimer = window.setTimeout(() => {
      try {
        if (Object.keys(assets).length === 0) localStorage.removeItem(ASSETS_KEY);
        else localStorage.setItem(ASSETS_KEY, JSON.stringify(assets));
        if (get().autosaveWarning) set({ autosaveWarning: null });
      } catch {
        set({ autosaveWarning: '画像が大きいためブラウザには自動保存できません。ファイルに保存してください (Ctrl+S)' });
      }
    }, 500);
  }

  function pushHistory(prevCode: string) {
    const past = [...get().past, prevCode];
    if (past.length > MAX_HISTORY) past.shift();
    return past;
  }

  function applyCode(newCode: string, opts: { history?: boolean; fromEditor?: boolean; resetHistory?: boolean } = {}) {
    const st = get();
    const p = parseWith(newCode, st.assets);
    scheduleAutosave(newCode);
    set({
      code: newCode,
      parse: p,
      diagram: p.diagram,
      codeVersion: opts.fromEditor ? st.codeVersion : st.codeVersion + 1,
      past: opts.resetHistory ? [] : opts.history === false ? st.past : pushHistory(st.code),
      future: opts.resetHistory || opts.history !== false ? [] : st.future,
      dirty: opts.resetHistory ? false : true,
    });
  }

  return {
    code: code0,
    parse: parse0,
    diagram: parse0.diagram,
    assets: assets0,
    autosaveWarning: null,
    codeVersion: 0,
    selection: { nodes: [], edges: [], labels: [] },
    hoverNode: null,
    view: { x: 40, y: 40, zoom: 1 },
    showGrid: true,
    snap: true,
    showCode: true,
    followEdges: readBool('blockillustrator.followEdges', true),
    connectMode: false,
    setConnectMode(on) {
      set({ connectMode: on });
    },
    past: [],
    future: [],
    fileName: null,
    fileHandle: null,
    dirty: false,
    focusLabelRequest: 0,
    revealLine: null,

    setCodeFromEditor(code) {
      if (code === get().code) return;
      applyCode(code, { fromEditor: true });
      // drop selection of elements that vanished
      const d = get().diagram;
      const sel = get().selection;
      const nodes = sel.nodes.filter((id) => d.nodes.some((n) => n.id === id));
      const edges = sel.edges.filter((id) => d.edges.some((e) => e.id === id));
      const labels = sel.labels.filter((id) => d.edges.some((e) => e.id === id && e.label));
      if (nodes.length !== sel.nodes.length || edges.length !== sel.edges.length || labels.length !== sel.labels.length) set({ selection: { nodes, edges, labels } });
    },

    loadCode(text, file) {
      const { code, assets } = splitAssets(text);
      set({ assets });
      scheduleAssetsAutosave(assets);
      applyCode(code, { resetHistory: true });
      set({
        selection: { nodes: [], edges: [], labels: [] },
        fileName: file?.name ?? null,
        fileHandle: file?.handle ?? null,
        dirty: false,
      });
    },

    serialize() {
      const st = get();
      const inCode = new Set(Object.keys(st.parse.assetSpans));
      const names = [...usedAssets(st.diagram)].filter((n) => !inCode.has(n));
      let out = st.code.replace(/\s+$/, '') + '\n';
      if (names.length) out += '\n// --- images ---\n' + assetsToLines(st.diagram.assets, names).join('\n') + '\n';
      return out;
    },

    addAsset(name, data) {
      const st = get();
      const all = st.diagram.assets;
      for (const [k, v] of Object.entries(all)) if (v === data) return k; // same picture: reuse
      let n = sanitizeAssetName(name);
      if (all[n] !== undefined) {
        const base = n.replace(/_?\d+$/, '') || 'img';
        let i = 2;
        while (all[`${base}_${i}`] !== undefined) i++;
        n = `${base}_${i}`;
      }
      const assets = { ...st.assets, [n]: data };
      const p = parseWith(st.code, assets);
      set({ assets, parse: p, diagram: p.diagram, dirty: true });
      scheduleAssetsAutosave(assets);
      return n;
    },

    addImageNode(src, at, size) {
      const d = get().diagram;
      const id = nextId(d, TYPE_PREFIX.image);
      get().commit((dd) => {
        dd.nodes.push({ id, type: 'image', label: '', x: at.x, y: at.y, w: size.w, h: size.h, src });
      });
      set({ selection: { nodes: [id], edges: [], labels: [] } });
      return id;
    },

    markSaved(name, handle) {
      set({ fileName: name, fileHandle: handle, dirty: false });
    },

    liveUpdate(fn) {
      const d = cloneDiagram(get().diagram);
      fn(d);
      set({ diagram: d });
    },

    commit(fn, opts) {
      const st = get();
      const d = cloneDiagram(st.diagram);
      if (fn) fn(d);
      const newCode = syncCode(st.code, st.parse, d, { renamed: opts?.renamed });
      if (newCode === st.code) {
        // nothing changed textually; still make sure diagram is in sync with parse
        set({ diagram: st.parse.diagram });
        return;
      }
      const now = Date.now();
      const coalesce = !!opts?.coalesce && lastCommit.key === opts.coalesce && now - lastCommit.time < 1200;
      applyCode(newCode, { history: !coalesce });
      lastCommit = { key: opts?.coalesce ?? null, time: now };
      // keep selection consistent (edge ids may have been renumbered)
      const nd = get().diagram;
      const sel = get().selection;
      const nodes = sel.nodes.filter((id) => nd.nodes.some((n) => n.id === id));
      const edges = sel.edges.filter((id) => nd.edges.some((e) => e.id === id));
      const labels = sel.labels.filter((id) => nd.edges.some((e) => e.id === id && e.label));
      set({ selection: { nodes, edges, labels } });
    },

    undo() {
      const st = get();
      if (st.past.length === 0) return;
      const prev = st.past[st.past.length - 1];
      const p = parseWith(prev, st.assets);
      scheduleAutosave(prev);
      set({
        code: prev,
        parse: p,
        diagram: p.diagram,
        codeVersion: st.codeVersion + 1,
        past: st.past.slice(0, -1),
        future: [st.code, ...st.future],
        selection: { nodes: [], edges: [], labels: [] },
        dirty: true,
      });
    },

    redo() {
      const st = get();
      if (st.future.length === 0) return;
      const next = st.future[0];
      const p = parseWith(next, st.assets);
      scheduleAutosave(next);
      set({
        code: next,
        parse: p,
        diagram: p.diagram,
        codeVersion: st.codeVersion + 1,
        past: [...st.past, st.code],
        future: st.future.slice(1),
        selection: { nodes: [], edges: [], labels: [] },
        dirty: true,
      });
    },

    setSelection(sel) {
      set({ selection: sel });
      revealSelection(get, set, sel);
    },
    selectNode(id, additive) {
      const sel = get().selection;
      let nodes: string[];
      if (additive) nodes = sel.nodes.includes(id) ? sel.nodes.filter((n) => n !== id) : [...sel.nodes, id];
      else nodes = [id];
      const next = { nodes, edges: additive ? sel.edges : [], labels: additive ? sel.labels : [] };
      set({ selection: next });
      revealSelection(get, set, next);
    },
    selectEdge(id) {
      const next = { nodes: [], edges: [id], labels: [] };
      set({ selection: next });
      revealSelection(get, set, next);
    },
    selectLabel(id, additive) {
      const sel = get().selection;
      let labels: string[];
      if (additive) labels = sel.labels.includes(id) ? sel.labels.filter((n) => n !== id) : [...sel.labels, id];
      else labels = [id];
      const next = { nodes: additive ? sel.nodes : [], edges: [], labels };
      set({ selection: next });
      revealSelection(get, set, next);
    },
    selectAllText() {
      const d = get().diagram;
      const nodes = d.nodes.filter((n) => n.type === 'text').map((n) => n.id);
      const labels = d.edges.filter((e) => e.label).map((e) => e.id);
      set({ selection: { nodes, edges: [], labels } });
    },
    clearSelection() {
      set({ selection: { nodes: [], edges: [], labels: [] } });
    },
    setHover(id) {
      if (get().hoverNode !== id) set({ hoverNode: id });
    },
    setView(v) {
      set({ view: v });
    },
    toggleGrid() {
      set({ showGrid: !get().showGrid });
    },
    toggleSnap() {
      set({ snap: !get().snap });
    },
    toggleCode() {
      set({ showCode: !get().showCode });
    },
    toggleFollowEdges() {
      const v = !get().followEdges;
      set({ followEdges: v });
      try {
        localStorage.setItem('blockillustrator.followEdges', v ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
    requestFocusLabel() {
      set({ focusLabelRequest: get().focusLabelRequest + 1 });
    },

    addNode(type, at) {
      const d = get().diagram;
      const id = nextId(d, TYPE_PREFIX[type]);
      const label = type === 'block' || type === 'rounded' ? 'Block' : type === 'text' ? 'label' : type === 'gain' ? '$K$' : type === 'circle' || type === 'diamond' ? '' : '';
      get().commit((dd) => {
        dd.nodes.push({ id, type, label, x: at.x, y: at.y });
      });
      set({ selection: { nodes: [id], edges: [], labels: [] } });
      return id;
    },

    addEdge(from, to, fromSide, toSide) {
      const d = get().diagram;
      const id = `e${d.edges.length + 1}`;
      get().commit((dd) => {
        dd.edges.push({ id, from, to, fromSide, toSide, waypoints: [], route: 'auto' });
      });
      const nd = get().diagram;
      const last = nd.edges[nd.edges.length - 1];
      if (last) set({ selection: { nodes: [], edges: [last.id], labels: [] } });
    },

    deleteSelection() {
      const sel = get().selection;
      if (sel.nodes.length === 0 && sel.edges.length === 0 && sel.labels.length === 0) return;
      get().commit((d) => {
        const ns = new Set(sel.nodes);
        const es = new Set(sel.edges);
        const ls = new Set(sel.labels);
        d.nodes = d.nodes.filter((n) => !ns.has(n.id));
        d.edges = d.edges.filter((e) => !es.has(e.id) && !ns.has(e.from) && !ns.has(e.to));
        // deleting a selected label removes the text from its line (the line itself stays)
        for (const e of d.edges) {
          if (ls.has(e.id)) {
            delete e.label;
            delete e.labelOffset;
          }
        }
      });
      set({ selection: { nodes: [], edges: [], labels: [] } });
    },

    duplicateSelection() {
      const sel = get().selection;
      if (sel.nodes.length === 0) return;
      const newIds: string[] = [];
      get().commit((d) => {
        const map: Record<string, string> = {};
        for (const id of sel.nodes) {
          const n = d.nodes.find((x) => x.id === id);
          if (!n) continue;
          const nid = nextId({ ...d, nodes: [...d.nodes] }, TYPE_PREFIX[n.type]);
          map[id] = nid;
          d.nodes.push({ ...JSON.parse(JSON.stringify(n)), id: nid, x: n.x + 30, y: n.y + 30 });
          newIds.push(nid);
        }
        // duplicate edges among the duplicated nodes
        const count = d.edges.length;
        let k = 0;
        for (const e of [...d.edges]) {
          if (map[e.from] && map[e.to]) {
            k++;
            d.edges.push({ ...JSON.parse(JSON.stringify(e)), id: `e${count + k}`, from: map[e.from], to: map[e.to] });
          }
        }
      });
      set({ selection: { nodes: newIds, edges: [], labels: [] } });
    },

    renameNode(oldId, newId) {
      newId = newId.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newId)) return false;
      const d = get().diagram;
      if (d.nodes.some((n) => n.id === newId)) return false;
      get().commit(
        (dd) => {
          const n = dd.nodes.find((x) => x.id === oldId);
          if (n) n.id = newId;
          for (const e of dd.edges) {
            if (e.from === oldId) e.from = newId;
            if (e.to === oldId) e.to = newId;
          }
        },
        { renamed: { [newId]: oldId } },
      );
      set({ selection: { nodes: [newId], edges: [], labels: [] } });
      return true;
    },

    updateNode(id, patch, live) {
      const fn = (d: Diagram) => {
        const n = d.nodes.find((x) => x.id === id);
        if (!n) return;
        Object.assign(n, patch);
        for (const k of Object.keys(patch) as (keyof DNode)[]) if (patch[k] === undefined) delete n[k];
      };
      if (live) get().liveUpdate(fn);
      else get().commit(fn, { coalesce: `node:${id}:${Object.keys(patch).sort().join(',')}` });
    },

    updateEdge(id, patch, live) {
      const fn = (d: Diagram) => {
        const e = d.edges.find((x) => x.id === id);
        if (!e) return;
        Object.assign(e, patch);
        for (const k of Object.keys(patch) as (keyof DEdge)[]) if (patch[k] === undefined) delete e[k];
      };
      if (live) get().liveUpdate(fn);
      else get().commit(fn, { coalesce: `edge:${id}:${Object.keys(patch).sort().join(',')}` });
    },

    updateStyle(patch, live) {
      const fn = (d: Diagram) => {
        Object.assign(d.style, patch);
      };
      if (live) get().liveUpdate(fn);
      else get().commit(fn, { coalesce: `style:${Object.keys(patch).sort().join(',')}` });
    },

    copySelectionText() {
      const st = get();
      const ids = new Set(st.selection.nodes);
      if (ids.size === 0) return '';
      const lines: string[] = [];
      for (const n of st.diagram.nodes) if (ids.has(n.id)) lines.push(nodeToLine(n));
      for (const e of st.diagram.edges) if (ids.has(e.from) && ids.has(e.to)) lines.push(edgeToLine(e));
      // embedded images travel with their nodes so the text is self-contained
      const used = new Set<string>();
      for (const n of st.diagram.nodes) if (ids.has(n.id) && n.type === 'image' && n.src && st.diagram.assets[n.src] !== undefined) used.add(n.src);
      lines.push(...assetsToLines(st.diagram.assets, used));
      const text = lines.join('\n') + '\n';
      lastCopied = { text, pastes: 0 };
      return text;
    },

    pasteText(text) {
      const parsed = parse(text);
      if (parsed.diagram.nodes.length === 0) return false;
      const st = get();
      // repeated pastes of our own copy are offset so they do not land on top of the original
      const own = lastCopied !== null && lastCopied.text === text;
      const step = (st.diagram.style.grid || 10) * 3;
      const k = own ? ++lastCopied!.pastes : 0;
      const off = { x: step * k, y: step * k };
      const idMap: Record<string, string> = {};
      const newIds: string[] = [];
      // pasted images: merge into the asset store (identical data keeps its name, clashes are renamed)
      const assetMap: Record<string, string> = {};
      for (const [name, data] of Object.entries(parsed.diagram.assets)) assetMap[name] = get().addAsset(name, data);
      get().commit((d) => {
        const taken = new Set(d.nodes.map((n) => n.id));
        for (const n of parsed.diagram.nodes) {
          let id = n.id;
          if (taken.has(id)) {
            const base = id.replace(/\d+$/, '') || TYPE_PREFIX[n.type];
            let i = 2;
            while (taken.has(`${base}${i}`)) i++;
            id = `${base}${i}`;
          }
          taken.add(id);
          idMap[n.id] = id;
          newIds.push(id);
          const copy: DNode = { ...JSON.parse(JSON.stringify(n)), id, x: n.x + off.x, y: n.y + off.y };
          if (copy.src && assetMap[copy.src]) copy.src = assetMap[copy.src];
          d.nodes.push(copy);
        }
        let count = d.edges.length;
        for (const e of parsed.diagram.edges) {
          if (!idMap[e.from] || !idMap[e.to]) continue;
          count++;
          d.edges.push({
            ...JSON.parse(JSON.stringify(e)),
            id: `e${count}`,
            from: idMap[e.from],
            to: idMap[e.to],
            waypoints: e.waypoints.map((p) => ({ x: p.x + off.x, y: p.y + off.y })),
          });
        }
      });
      set({ selection: { nodes: newIds, edges: [], labels: [] } });
      return true;
    },

    insertJunctionOnEdge(edgeId, at) {
      const d = get().diagram;
      const lay = layoutDiagram(d);
      const el = lay.edges.find((x) => x.edge.id === edgeId);
      if (!el) return null;
      const pts = el.route.points;
      // nearest point on the polyline (or the middle)
      let best = { i: 0, p: pts[0], dist: Infinity };
      if (at) {
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const l2 = dx * dx + dy * dy;
          const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / l2));
          const p = { x: a.x + dx * t, y: a.y + dy * t };
          const dist = Math.hypot(at.x - p.x, at.y - p.y);
          if (dist < best.dist) best = { i, p, dist };
        }
      } else {
        const mid = polylineMid(pts);
        let acc = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
          if (acc + seg >= polylineLength(pts) / 2 - 1e-6) {
            best = { i, p: mid.p, dist: 0 };
            break;
          }
          acc += seg;
        }
      }
      // snap along the segment only (so the point stays on the line)
      const g = d.style.grid || 10;
      const a = pts[best.i];
      const b = pts[best.i + 1];
      let q = { x: Math.round(best.p.x * 10) / 10, y: Math.round(best.p.y * 10) / 10 };
      if (get().snap) {
        if (Math.abs(a.y - b.y) < 0.5) q = { x: Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), Math.round(q.x / g) * g)), y: a.y };
        else if (Math.abs(a.x - b.x) < 0.5) q = { x: a.x, y: Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), Math.round(q.y / g) * g)) };
      }
      const id = nextId(d, 'j');
      const round = (ps: { x: number; y: number }[]) => ps.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
      get().commit((dd) => {
        const idx = dd.edges.findIndex((x) => x.id === edgeId);
        if (idx < 0) return;
        const e = dd.edges[idx];
        dd.nodes.push({ id, type: 'junction', label: '', x: q.x, y: q.y });
        const interior = pts.slice(1, -1);
        const common = { arrow: e.arrow, width: e.width, color: e.color, dash: e.dash, fontSize: e.fontSize, route: e.route };
        const e1: DEdge = {
          id: e.id,
          from: e.from,
          to: id,
          fromSide: e.fromSide,
          label: e.label,
          labelOffset: e.labelOffset,
          waypoints: round(interior.slice(0, best.i)),
          ...common,
        };
        const e2: DEdge = {
          id: `e${dd.edges.length + 1}`,
          from: id,
          to: e.to,
          toSide: e.toSide,
          sign: e.sign,
          waypoints: round(interior.slice(best.i)),
          ...common,
        };
        for (const k of Object.keys(e1) as (keyof DEdge)[]) if (e1[k] === undefined) delete e1[k];
        for (const k of Object.keys(e2) as (keyof DEdge)[]) if (e2[k] === undefined) delete e2[k];
        dd.edges[idx] = e1;
        dd.edges.push(e2);
      });
      set({ selection: { nodes: [id], edges: [], labels: [] } });
      return id;
    },

    alignSelection(mode) {
      const items = selectedItems(get);
      if (items.length < 2) return;
      const left = Math.min(...items.map((b) => b.cx - b.w / 2));
      const right = Math.max(...items.map((b) => b.cx + b.w / 2));
      const top = Math.min(...items.map((b) => b.cy - b.h / 2));
      const bottom = Math.max(...items.map((b) => b.cy + b.h / 2));
      const hc = (left + right) / 2;
      const vc = (top + bottom) / 2;
      const targets = new Map<string, Point>();
      for (const b of items) {
        let cx = b.cx;
        let cy = b.cy;
        switch (mode) {
          case 'left':
            cx = left + b.w / 2;
            break;
          case 'right':
            cx = right - b.w / 2;
            break;
          case 'hcenter':
            cx = hc;
            break;
          case 'top':
            cy = top + b.h / 2;
            break;
          case 'bottom':
            cy = bottom - b.h / 2;
            break;
          case 'vcenter':
            cy = vc;
            break;
        }
        targets.set(b.kind + ':' + b.id, { x: cx, y: cy });
      }
      moveItems(get, items, targets);
    },

    distributeSelection(axis) {
      const items = selectedItems(get);
      if (items.length < 3) return;
      // equal gaps between boxes (PowerPoint-style), ordered along the axis
      const size = (b: AlignItem) => (axis === 'x' ? b.w : b.h);
      const pos = (b: AlignItem) => (axis === 'x' ? b.cx : b.cy);
      const sorted = [...items].sort((a, b) => pos(a) - pos(b));
      const start = pos(sorted[0]) - size(sorted[0]) / 2;
      const end = pos(sorted[sorted.length - 1]) + size(sorted[sorted.length - 1]) / 2;
      const total = sorted.reduce((a, b) => a + size(b), 0);
      const gap = (end - start - total) / (sorted.length - 1);
      const targets = new Map<string, Point>();
      let cursor = start;
      for (const b of sorted) {
        const target = Math.round((cursor + size(b) / 2) * 10) / 10;
        targets.set(b.kind + ':' + b.id, axis === 'x' ? { x: target, y: b.cy } : { x: b.cx, y: target });
        cursor += size(b) + gap;
      }
      moveItems(get, items, targets);
    },

    sameSizeSelection(refId) {
      get().matchSelection('size', refId);
    },

    matchSelection(what, refId) {
      const sel = get().selection;
      const ref = refId ?? referenceNodeId(sel);
      if (!ref || sel.nodes.length + sel.labels.length + sel.edges.length < 2) return;
      const d0 = get().diagram;
      const refNode = d0.nodes.find((n) => n.id === ref);
      if (!refNode) return;
      // sizes are copied as resolved values so a block at its default size is a valid reference
      const rs = resolveNode(refNode, d0.style);
      const lay = layoutDiagram(d0);
      const refBox = lay.boxes.get(ref);
      const size = what === 'size' || what === 'all';
      const style = what === 'style' || what === 'all';
      const text = what === 'text' || what === 'all';
      get().commit((d) => {
        for (const n of d.nodes) {
          if (n.id === ref || !sel.nodes.includes(n.id)) continue;
          if (size && n.type !== 'text' && refNode.type !== 'text' && refBox) {
            const r = ((n.rotate ?? 0) % 180 + 180) % 180;
            const [w, h] = r === 90 ? [refBox.h, refBox.w] : [refBox.w, refBox.h];
            if (n.type === 'sum' || n.type === 'junction') n.w = n.h = Math.min(w, h);
            else {
              n.w = w;
              n.h = h;
            }
          }
          if (style) {
            copyKeys(refNode, n, NODE_LOOK_KEYS);
            if (refNode.type === n.type) copyKeys(refNode, n, ['labelPos']);
          }
          if (text) copyKeys(refNode, n, NODE_TEXT_KEYS);
        }
        if (text) {
          for (const e of d.edges) {
            if (!sel.labels.includes(e.id) && !sel.edges.includes(e.id)) continue;
            // line labels follow the reference text (font size and style, not the color: that is the line color)
            const patch: Partial<DEdge> = {
              fontSize: refNode.fontSize ?? (refNode.type === 'text' ? undefined : rs.fontSize),
              bold: refNode.bold,
              italic: refNode.italic,
              font: refNode.font,
              textAlign: refNode.textAlign,
            };
            assignPatch(e, patch);
          }
        }
      });
    },

    resetSelection() {
      const sel = get().selection;
      if (sel.nodes.length + sel.edges.length + sel.labels.length === 0) return;
      get().commit((d) => {
        for (const n of d.nodes) {
          if (!sel.nodes.includes(n.id)) continue;
          for (const k of NODE_STYLE_KEYS) delete n[k];
          if (n.type === 'sum') delete n.sumStyle;
        }
        for (const e of d.edges) {
          if (sel.edges.includes(e.id)) for (const k of EDGE_STYLE_KEYS) delete e[k];
          else if (sel.labels.includes(e.id)) {
            for (const k of EDGE_TEXT_KEYS) delete e[k];
            delete e.labelOffset;
          }
        }
      });
    },

    updateSelection(patch, live) {
      const sel = get().selection;
      const fn = (d: Diagram) => {
        if (patch.node) for (const n of d.nodes) if (sel.nodes.includes(n.id)) assignPatch(n, patch.node);
        if (patch.edge) for (const e of d.edges) if (sel.edges.includes(e.id) || sel.labels.includes(e.id)) assignPatch(e, patch.edge);
      };
      if (live) get().liveUpdate(fn);
      else {
        const keys = [...Object.keys(patch.node ?? {}), ...Object.keys(patch.edge ?? {})].sort().join(',');
        get().commit(fn, { coalesce: `sel:${keys}` });
      }
    },

    toggleTextStyle(key) {
      const sel = get().selection;
      const d = get().diagram;
      const nodes = d.nodes.filter((n) => sel.nodes.includes(n.id));
      const edges = d.edges.filter((e) => sel.edges.includes(e.id) || sel.labels.includes(e.id));
      if (nodes.length + edges.length === 0) return;
      const allOn =
        nodes.every((n) => resolveNode(n, d.style)[key]) &&
        edges.every((e) => (key === 'underline' ? true : resolveEdgeText(e, d.style)[key]));
      const v = allOn ? false : true;
      get().commit((dd) => {
        for (const n of dd.nodes) {
          if (!sel.nodes.includes(n.id)) continue;
          const def = (dd.style.defaults[n.type] ?? {})[key === 'underline' ? 'bold' : key];
          // store the flag explicitly only when it differs from the type default
          if (key === 'underline') {
            if (v) n.underline = true;
            else delete n.underline;
          } else if (v === !!def) delete n[key];
          else n[key] = v;
        }
        if (key === 'underline') return;
        for (const e of dd.edges) {
          if (!sel.edges.includes(e.id) && !sel.labels.includes(e.id)) continue;
          const def = (dd.style.defaults.text ?? {})[key];
          if (v === !!def) delete e[key];
          else e[key] = v;
        }
      });
    },

    rotateSelection(delta) {
      const sel = get().selection;
      if (sel.nodes.length === 0) return;
      get().commit((d) => {
        for (const n of d.nodes) {
          if (!sel.nodes.includes(n.id)) continue;
          const r = (((n.rotate ?? 0) + delta) % 360 + 360) % 360;
          if (r === 0) delete n.rotate;
          else n.rotate = r;
        }
      });
    },

    nudgeSelection(dx, dy) {
      const sel = get().selection;
      if (sel.nodes.length === 0 && sel.edges.length === 0 && sel.labels.length === 0) return;
      const follow = get().followEdges;
      const labels = labelBoxes(layoutDiagram(get().diagram), sel.labels);
      get().commit((d) => {
        const moved = new Set(sel.nodes);
        for (const n of d.nodes) {
          if (moved.has(n.id)) {
            n.x += dx;
            n.y += dy;
          }
        }
        if (follow) followEdgesAfterMove(d.edges, moved, { x: dx, y: dy });
        for (const e of d.edges) {
          if (sel.edges.includes(e.id)) {
            for (const p of e.waypoints) {
              p.x += dx;
              p.y += dy;
            }
          }
        }
        placeEdgeLabels(d, new Map(labels.map((l) => [l.id, { x: l.cx + dx, y: l.cy + dy }])));
      });
    },
  };
});

/** The selected nodes and connection labels as alignable boxes. */
function selectedItems(get: () => StoreState): AlignItem[] {
  const sel = get().selection;
  const lay = layoutDiagram(get().diagram);
  const items: AlignItem[] = [];
  for (const id of sel.nodes) {
    const b = lay.boxes.get(id);
    if (b) items.push({ kind: 'node', id, cx: b.cx, cy: b.cy, w: b.w, h: b.h });
  }
  items.push(...labelBoxes(lay, sel.labels));
  return items;
}

/** Move items to their target centers (keys `kind:id`) in one undo step. */
function moveItems(get: () => StoreState, items: AlignItem[], targets: Map<string, Point>): void {
  const follow = get().followEdges;
  get().commit((d) => {
    const labelTargets = new Map<string, Point>();
    for (const b of items) {
      const tg = targets.get(b.kind + ':' + b.id);
      if (!tg) continue;
      if (b.kind === 'label') {
        labelTargets.set(b.id, tg);
        continue;
      }
      const n = d.nodes.find((x) => x.id === b.id);
      if (!n) continue;
      const delta = { x: tg.x - n.x, y: tg.y - n.y };
      n.x = tg.x;
      n.y = tg.y;
      if (follow && (delta.x || delta.y)) followEdgesAfterMove(d.edges, new Set([n.id]), delta);
    }
    placeEdgeLabels(d, labelTargets);
  });
}

function revealSelection(get: () => StoreState, set: (p: Partial<StoreState>) => void, sel: SelectionState) {
  const p = get().parse;
  let line: number | undefined;
  if (sel.nodes.length === 1 && sel.edges.length === 0) line = p.nodeSpans[sel.nodes[0]]?.start;
  else if (sel.edges.length === 1 && sel.nodes.length === 0) line = p.edgeSpans[sel.edges[0]]?.start;
  if (line !== undefined) set({ revealLine: { line, v: (get().revealLine?.v ?? 0) + 1 } });
}

export function useSelectionSets() {
  const sel = useStore((s) => s.selection);
  return { nodes: new Set(sel.nodes), edges: new Set(sel.edges) };
}
