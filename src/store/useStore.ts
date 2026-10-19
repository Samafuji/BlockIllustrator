import { create } from 'zustand';
import { syncCode } from '../dsl/generator';
import { ParseResult, parse } from '../dsl/parser';
import {
  DEdge,
  DNode,
  Diagram,
  NodeType,
  Side,
  TYPE_PREFIX,
  cloneDiagram,
  nextId,
} from '../model/types';
import { EXAMPLES } from '../examples';
import { followEdgesAfterMove, polylineLength, polylineMid } from '../geometry/geometry';
import { layoutDiagram } from '../render/layout';

export interface SelectionState {
  nodes: string[];
  edges: string[];
}

export interface ViewState {
  x: number;
  y: number;
  zoom: number;
}

const AUTOSAVE_KEY = 'blockillustrator.autosave.v1';
const MAX_HISTORY = 200;

export interface StoreState {
  code: string;
  parse: ParseResult;
  diagram: Diagram;
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

  // ---- GUI side
  liveUpdate: (fn: (d: Diagram) => void) => void;
  commit: (fn?: (d: Diagram) => void, opts?: { renamed?: Record<string, string> }) => void;
  undo: () => void;
  redo: () => void;

  // ---- selection / view
  setSelection: (sel: SelectionState) => void;
  selectNode: (id: string, additive?: boolean) => void;
  selectEdge: (id: string) => void;
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
  renameNode: (oldId: string, newId: string) => boolean;
  updateNode: (id: string, patch: Partial<DNode>, live?: boolean) => void;
  updateEdge: (id: string, patch: Partial<DEdge>, live?: boolean) => void;
  updateStyle: (patch: Partial<Diagram['style']>, live?: boolean) => void;
  nudgeSelection: (dx: number, dy: number) => void;
  /** split an edge at a point (nearest point on the line; the middle if omitted) by inserting a junction */
  insertJunctionOnEdge: (edgeId: string, at?: { x: number; y: number }) => string | null;
  alignSelection: (mode: AlignMode) => void;
  distributeSelection: (axis: 'x' | 'y') => void;
  sameSizeSelection: () => void;
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

function readBool(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
}

let autosaveTimer: number | undefined;
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
  const parse0 = parse(code0);

  function pushHistory(prevCode: string) {
    const past = [...get().past, prevCode];
    if (past.length > MAX_HISTORY) past.shift();
    return past;
  }

  function applyCode(newCode: string, opts: { history?: boolean; fromEditor?: boolean; resetHistory?: boolean } = {}) {
    const st = get();
    const p = parse(newCode);
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
    codeVersion: 0,
    selection: { nodes: [], edges: [] },
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
      if (nodes.length !== sel.nodes.length || edges.length !== sel.edges.length) set({ selection: { nodes, edges } });
    },

    loadCode(code, file) {
      applyCode(code, { resetHistory: true });
      set({
        selection: { nodes: [], edges: [] },
        fileName: file?.name ?? null,
        fileHandle: file?.handle ?? null,
        dirty: false,
      });
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
      applyCode(newCode, { history: true });
      // keep selection consistent (edge ids may have been renumbered)
      const nd = get().diagram;
      const sel = get().selection;
      const nodes = sel.nodes.filter((id) => nd.nodes.some((n) => n.id === id));
      const edges = sel.edges.filter((id) => nd.edges.some((e) => e.id === id));
      set({ selection: { nodes, edges } });
    },

    undo() {
      const st = get();
      if (st.past.length === 0) return;
      const prev = st.past[st.past.length - 1];
      const p = parse(prev);
      scheduleAutosave(prev);
      set({
        code: prev,
        parse: p,
        diagram: p.diagram,
        codeVersion: st.codeVersion + 1,
        past: st.past.slice(0, -1),
        future: [st.code, ...st.future],
        selection: { nodes: [], edges: [] },
        dirty: true,
      });
    },

    redo() {
      const st = get();
      if (st.future.length === 0) return;
      const next = st.future[0];
      const p = parse(next);
      scheduleAutosave(next);
      set({
        code: next,
        parse: p,
        diagram: p.diagram,
        codeVersion: st.codeVersion + 1,
        past: [...st.past, st.code],
        future: st.future.slice(1),
        selection: { nodes: [], edges: [] },
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
      const next = { nodes, edges: additive ? sel.edges : [] };
      set({ selection: next });
      revealSelection(get, set, next);
    },
    selectEdge(id) {
      const next = { nodes: [], edges: [id] };
      set({ selection: next });
      revealSelection(get, set, next);
    },
    clearSelection() {
      set({ selection: { nodes: [], edges: [] } });
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
      set({ selection: { nodes: [id], edges: [] } });
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
      if (last) set({ selection: { nodes: [], edges: [last.id] } });
    },

    deleteSelection() {
      const sel = get().selection;
      if (sel.nodes.length === 0 && sel.edges.length === 0) return;
      get().commit((d) => {
        const ns = new Set(sel.nodes);
        const es = new Set(sel.edges);
        d.nodes = d.nodes.filter((n) => !ns.has(n.id));
        d.edges = d.edges.filter((e) => !es.has(e.id) && !ns.has(e.from) && !ns.has(e.to));
      });
      set({ selection: { nodes: [], edges: [] } });
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
      set({ selection: { nodes: newIds, edges: [] } });
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
      set({ selection: { nodes: [newId], edges: [] } });
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
      else get().commit(fn);
    },

    updateEdge(id, patch, live) {
      const fn = (d: Diagram) => {
        const e = d.edges.find((x) => x.id === id);
        if (!e) return;
        Object.assign(e, patch);
        for (const k of Object.keys(patch) as (keyof DEdge)[]) if (patch[k] === undefined) delete e[k];
      };
      if (live) get().liveUpdate(fn);
      else get().commit(fn);
    },

    updateStyle(patch, live) {
      const fn = (d: Diagram) => {
        Object.assign(d.style, patch);
      };
      if (live) get().liveUpdate(fn);
      else get().commit(fn);
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
      set({ selection: { nodes: [id], edges: [] } });
      return id;
    },

    alignSelection(mode) {
      const ids = get().selection.nodes;
      if (ids.length < 2) return;
      const lay = layoutDiagram(get().diagram);
      const boxes = ids.map((id) => lay.boxes.get(id)!).filter(Boolean);
      const left = Math.min(...boxes.map((b) => b.cx - b.w / 2));
      const right = Math.max(...boxes.map((b) => b.cx + b.w / 2));
      const top = Math.min(...boxes.map((b) => b.cy - b.h / 2));
      const bottom = Math.max(...boxes.map((b) => b.cy + b.h / 2));
      const hc = (left + right) / 2;
      const vc = (top + bottom) / 2;
      const follow = get().followEdges;
      get().commit((d) => {
        for (const b of boxes) {
          const n = d.nodes.find((x) => x.id === b.node.id);
          if (!n) continue;
          let nx = n.x;
          let ny = n.y;
          switch (mode) {
            case 'left':
              nx = left + b.w / 2;
              break;
            case 'right':
              nx = right - b.w / 2;
              break;
            case 'hcenter':
              nx = hc;
              break;
            case 'top':
              ny = top + b.h / 2;
              break;
            case 'bottom':
              ny = bottom - b.h / 2;
              break;
            case 'vcenter':
              ny = vc;
              break;
          }
          const delta = { x: nx - n.x, y: ny - n.y };
          n.x = nx;
          n.y = ny;
          if (follow && (delta.x || delta.y)) followEdgesAfterMove(d.edges, new Set([n.id]), delta);
        }
      });
    },

    distributeSelection(axis) {
      const ids = get().selection.nodes;
      if (ids.length < 3) return;
      const lay = layoutDiagram(get().diagram);
      const boxes = ids.map((id) => lay.boxes.get(id)!).filter(Boolean);
      // equal gaps between boxes (PowerPoint-style), ordered along the axis
      const size = (b: (typeof boxes)[number]) => (axis === 'x' ? b.w : b.h);
      const pos = (b: (typeof boxes)[number]) => (axis === 'x' ? b.cx : b.cy);
      const sorted = [...boxes].sort((a, b) => pos(a) - pos(b));
      const start = pos(sorted[0]) - size(sorted[0]) / 2;
      const end = pos(sorted[sorted.length - 1]) + size(sorted[sorted.length - 1]) / 2;
      const total = sorted.reduce((a, b) => a + size(b), 0);
      const gap = (end - start - total) / (sorted.length - 1);
      const follow = get().followEdges;
      get().commit((d) => {
        let cursor = start;
        for (const b of sorted) {
          const n = d.nodes.find((x) => x.id === b.node.id);
          if (!n) continue;
          const target = Math.round((cursor + size(b) / 2) * 10) / 10;
          const delta = axis === 'x' ? { x: target - n.x, y: 0 } : { x: 0, y: target - n.y };
          if (axis === 'x') n.x = target;
          else n.y = target;
          if (follow && (delta.x || delta.y)) followEdgesAfterMove(d.edges, new Set([n.id]), delta);
          cursor += size(b) + gap;
        }
      });
    },

    sameSizeSelection() {
      const ids = get().selection.nodes;
      if (ids.length < 2) return;
      const lay = layoutDiagram(get().diagram);
      const first = lay.boxes.get(ids[0]);
      if (!first) return;
      get().commit((d) => {
        for (const id of ids.slice(1)) {
          const n = d.nodes.find((x) => x.id === id);
          if (n && n.type !== 'text') {
            n.w = first.w;
            n.h = first.h;
          }
        }
      });
    },

    nudgeSelection(dx, dy) {
      const sel = get().selection;
      if (sel.nodes.length === 0 && sel.edges.length === 0) return;
      const follow = get().followEdges;
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
      });
    },
  };
});

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
