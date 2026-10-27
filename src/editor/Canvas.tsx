import { useT } from '../i18n';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, SIDE_DIR, anchorOnSide, followEdgesAfterMove, pointInBox, sideToward } from '../geometry/geometry';
import { DEdge, Point, SIDES, Side } from '../model/types';
import { DiagramContent } from '../render/DiagramSvg';
import { DiagramLayout, EdgeLayout, layoutDiagram } from '../render/layout';
import { ViewState, useStore } from '../store/useStore';
import { importImageFiles } from '../io/images';
import { canvasApi } from './canvasApi';
import { codeEditorApi } from './CodePanel';

type Corner = 'nw' | 'ne' | 'sw' | 'se';

type Interaction =
  | { kind: 'none' }
  | { kind: 'pan'; startClient: Point; startView: ViewState }
  | { kind: 'marquee'; start: Point; additive: boolean }
  | {
      kind: 'dragNodes';
      start: Point;
      orig: Map<string, Point>;
      origWps: Map<string, Point[]>;
      primary: string;
      moved: boolean;
      /** alignment guide candidates from the nodes that are not being moved */
      guidesX: number[];
      guidesY: number[];
      /** bounding box of the moved group at drag start */
      group: { left: number; right: number; top: number; bottom: number };
    }
  /** `aspect` (w/h) is set for images, whose proportions are kept unless Shift is held */
  | { kind: 'resize'; id: string; corner: Corner; fixed: Point; moved: boolean; aspect?: number }
  /** drag a bend point. `bake` turns an auto-routed line into explicit waypoints on the first move */
  | { kind: 'waypoint'; edgeId: string; index: number; moved: boolean; bake?: Bake }
  /** drag an axis-aligned segment: moves its bend point(s) perpendicular to the segment */
  | { kind: 'segment'; edgeId: string; idx: number[]; axis: 'x' | 'y'; orig: number; start: Point; moved: boolean; bake: Bake }
  /** drag the line body: translate every waypoint (ends stay attached to their blocks) */
  | { kind: 'edgeMove'; edgeId: string; start: Point; moved: boolean; bake: Bake }
  | { kind: 'label'; edgeId: string; mid: Point; moved: boolean }
  | {
      kind: 'connect';
      /** fixed node (source for a new edge; the untouched end when reconnecting) */
      from: string;
      side: Side;
      start: Point;
      /** when set, the drag re-attaches one end of an existing edge instead of creating a new one */
      reconnect?: { edgeId: string; end: 'from' | 'to' };
    };

interface Transient {
  marquee?: { a: Point; b: Point };
  connect?: { from: Point; to: Point; target: string | null };
  /** smart alignment guides shown while dragging */
  guides?: { x?: number; y?: number };
}

const HANDLE = '#2b7de9';
const GUIDE = '#ff3d8a';

/** Explicit waypoints that reproduce the current (possibly auto-routed) shape of an edge. */
interface Bake {
  pts: Point[];
  fromSide?: Side;
  toSide?: Side;
  straight: boolean;
}

function round1(p: Point): Point {
  return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
}

/** Bake from the routed points: interior bends, or both anchors when the line has no bend. */
function makeBake(el: EdgeLayout, withAnchorsIfStraight: boolean): Bake {
  const pts = el.route.points;
  let wps = pts.slice(1, -1).map(round1);
  if (wps.length === 0 && withAnchorsIfStraight) wps = [round1(pts[0]), round1(pts[pts.length - 1])];
  return { pts: wps, fromSide: el.route.fromSide, toSide: el.route.toSide, straight: el.edge.route === 'straight' };
}

function applyBake(ed: DEdge, bake: Bake): void {
  ed.waypoints = bake.pts.map((p) => ({ ...p }));
  if (!bake.straight) {
    if (bake.fromSide) ed.fromSide = bake.fromSide;
    if (bake.toSide) ed.toSide = bake.toSide;
  }
}

/** Closest guide to any of `values` within `thr`; returns the shift needed to land on it. */
function bestGuide(values: number[], guides: number[], thr: number): { diff: number; guide: number } | null {
  let best: { diff: number; guide: number } | null = null;
  for (const v of values) {
    for (const g of guides) {
      const diff = g - v;
      if (Math.abs(diff) <= thr && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, guide: g };
    }
  }
  return best;
}

export function Canvas() {
  const t = useT();
  const diagram = useStore((s) => s.diagram);
  const selection = useStore((s) => s.selection);
  const hoverNode = useStore((s) => s.hoverNode);
  const view = useStore((s) => s.view);
  const showGrid = useStore((s) => s.showGrid);
  const snap = useStore((s) => s.snap);
  const errorCount = useStore((s) => s.parse.errors.length);
  const connectMode = useStore((s) => s.connectMode);

  const layout = useMemo(() => layoutDiagram(diagram), [diagram]);
  const layoutRef = useRef<DiagramLayout>(layout);
  layoutRef.current = layout;
  const selSets = useMemo(() => ({ nodes: new Set(selection.nodes), edges: new Set(selection.edges) }), [selection]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const inter = useRef<Interaction>({ kind: 'none' });
  const spaceDown = useRef(false);
  /** true until the user pans/zooms manually; while true the view re-fits on resize */
  const autoFit = useRef(true);
  const [transient, setTransient] = useState<Transient>({});
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  // ---------------------------------------------------------------- helpers
  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    const v = useStore.getState().view;
    return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom };
  }, []);

  const snapV = useCallback((v: number): number => {
    const st = useStore.getState();
    const g = st.diagram.style.grid || 10;
    return st.snap ? Math.round(v / g) * g : Math.round(v * 10) / 10;
  }, []);

  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const lay = layoutDiagram(useStore.getState().diagram);
    const b = lay.bounds;
    const rw = wrap.clientWidth;
    const rh = wrap.clientHeight;
    const margin = 60;
    const zoom = Math.max(0.1, Math.min(2.5, Math.min((rw - margin * 2) / Math.max(b.w, 1), (rh - margin * 2) / Math.max(b.h, 1))));
    useStore.getState().setView({ zoom, x: (rw - b.w * zoom) / 2 - b.x * zoom, y: (rh - b.h * zoom) / 2 - b.y * zoom });
  }, []);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    autoFit.current = false;
    const v = useStore.getState().view;
    const nz = Math.max(0.1, Math.min(8, v.zoom * factor));
    const wx = (px - v.x) / v.zoom;
    const wy = (py - v.y) / v.zoom;
    useStore.getState().setView({ zoom: nz, x: px - wx * nz, y: py - wy * nz });
  }, []);

  useEffect(() => {
    canvasApi.current = {
      fit,
      zoomBy: (f) => {
        const wrap = wrapRef.current!;
        zoomAt(f, wrap.clientWidth / 2, wrap.clientHeight / 2);
      },
      resetZoom: () => {
        const wrap = wrapRef.current!;
        const v = useStore.getState().view;
        zoomAt(1 / v.zoom, wrap.clientWidth / 2, wrap.clientHeight / 2);
      },
      viewportCenterWorld: () => {
        const wrap = wrapRef.current!;
        const v = useStore.getState().view;
        return { x: (wrap.clientWidth / 2 - v.x) / v.zoom, y: (wrap.clientHeight / 2 - v.y) / v.zoom };
      },
      focus: () => wrapRef.current?.focus(),
    };
    const wrap = wrapRef.current!;
    if (wrap.clientWidth > 50) fit();
    // keep fitting on resize until the user pans/zooms manually
    const ro = new ResizeObserver(() => {
      if (autoFit.current && wrap.clientWidth > 50) fit();
    });
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      canvasApi.current = null;
    };
  }, [fit, zoomAt]);

  // wheel: pan / zoom (non-passive)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0015);
        zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        autoFit.current = false;
        const v = useStore.getState().view;
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        useStore.getState().setView({ ...v, x: v.x - dx, y: v.y - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // space key for panning
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el || !el.tagName) return false;
      return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable || !!el.closest?.('.cm-editor');
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        if (!spaceDown.current) setCursor('grab');
        spaceDown.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false;
        setCursor(undefined);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const hitNode = (p: Point, exclude?: string): Box | null => {
    const boxes = [...layoutRef.current.boxes.values()];
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (b.node.id === exclude) continue;
      if (pointInBox(p, b, 6)) return b;
    }
    return null;
  };

  // ---------------------------------------------------------------- pointer
  // Double clicks are detected manually: with pointer capture active the
  // browser dispatches `dblclick` to the capturing <svg>, not the handle.
  const lastDown = useRef<{ t: number; x: number; y: number; key: string }>({ t: 0, x: 0, y: 0, key: '' });

  const handleDoubleClick = (key: string, target: Element, world: Point) => {
    const st = useStore.getState();
    const wpEl = target.closest('[data-waypoint]') as HTMLElement | null;
    if (wpEl) {
      // double-click on a bend: remove it (auto-routed bends are baked first so the rest keeps its shape)
      const edgeId = wpEl.dataset.waypointEdge!;
      const idx = Number(wpEl.dataset.waypoint);
      const el = layoutRef.current.edges.find((x) => x.edge.id === edgeId);
      if (!el) return;
      const bake = makeBake(el, false);
      st.commit((d) => {
        const ed = d.edges.find((x) => x.id === edgeId);
        if (!ed) return;
        applyBake(ed, bake);
        ed.waypoints = ed.waypoints.filter((_, i) => i !== idx);
      });
      return;
    }
    const nodeEl = target.closest('[data-node]') as HTMLElement | null;
    if (nodeEl) {
      st.selectNode(nodeEl.dataset.node!, false);
      st.requestFocusLabel();
      return;
    }
    const edgeEl = target.closest('[data-edge]') as HTMLElement | null;
    const midEl = target.closest('[data-midpoint]') as HTMLElement | null;
    const segEl = target.closest('[data-segment]') as HTMLElement | null;
    const edgeId = edgeEl?.dataset.edge ?? midEl?.dataset.midpointEdge ?? segEl?.dataset.segmentEdge;
    if (edgeId) {
      // double-click on a line: insert a branch point there
      st.insertJunctionOnEdge(edgeId, world);
      return;
    }
    if (key === 'bg') st.addNode('block', { x: snapV(world.x), y: snapV(world.y) });
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current!;
    wrapRef.current?.focus();
    codeEditorApi.flush?.();
    // once the user starts editing on the canvas, stop re-fitting the view on layout changes
    autoFit.current = false;
    const st = useStore.getState();
    const world = toWorld(e.clientX, e.clientY);
    const target = e.target as Element;

    if (e.button === 0 && !spaceDown.current && !e.altKey) {
      const hit =
        (target.closest('[data-waypoint]') as HTMLElement | null)?.dataset.waypointEdge !== undefined
          ? 'wp:' + (target.closest('[data-waypoint]') as HTMLElement).dataset.waypointEdge + ':' + (target.closest('[data-waypoint]') as HTMLElement).dataset.waypoint
          : (target.closest('[data-node]') as HTMLElement | null)?.dataset.node
            ? 'node:' + (target.closest('[data-node]') as HTMLElement).dataset.node
            : (target.closest('[data-edge]') as HTMLElement | null)?.dataset.edge
              ? 'edge:' + (target.closest('[data-edge]') as HTMLElement).dataset.edge
              : (target.closest('[data-midpoint],[data-segment]') as HTMLElement | null)
                ? // these handles appear under the cursor right after the first click selects the line
                  'edge:' +
                  ((target.closest('[data-midpoint]') as HTMLElement | null)?.dataset.midpointEdge ??
                    (target.closest('[data-segment]') as HTMLElement).dataset.segmentEdge)
                : target.closest('[data-edge-label],[data-port-node],[data-resize],[data-endpoint]')
                  ? 'other'
                  : 'bg';
      const now = performance.now();
      const ld = lastDown.current;
      const isDbl = now - ld.t < 450 && Math.hypot(e.clientX - ld.x, e.clientY - ld.y) < 6 && ld.key === hit && hit !== 'other';
      lastDown.current = { t: now, x: e.clientX, y: e.clientY, key: hit };
      if (isDbl) {
        lastDown.current.t = 0;
        handleDoubleClick(hit, target, world);
        return;
      }
    }

    if (e.button === 1 || (e.button === 0 && (spaceDown.current || e.altKey))) {
      autoFit.current = false;
      inter.current = { kind: 'pan', startClient: { x: e.clientX, y: e.clientY }, startView: { ...st.view } };
      svg.setPointerCapture(e.pointerId);
      setCursor('grabbing');
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    const portEl = target.closest('[data-port-node]') as HTMLElement | null;
    if (portEl) {
      const from = portEl.dataset.portNode!;
      const side = portEl.dataset.portSide as Side;
      const box = layoutRef.current.boxes.get(from)!;
      const start = anchorOnSide(box, side);
      inter.current = { kind: 'connect', from, side, start };
      setTransient({ connect: { from: start, to: world, target: null } });
      svg.setPointerCapture(e.pointerId);
      setCursor('crosshair');
      return;
    }

    // drag an endpoint of the selected edge to attach it to another node
    const endEl = target.closest('[data-endpoint]') as HTMLElement | null;
    if (endEl) {
      const edgeId = endEl.dataset.endpointEdge!;
      const end = endEl.dataset.endpoint as 'from' | 'to';
      const el = layoutRef.current.edges.find((x) => x.edge.id === edgeId);
      if (el) {
        const pts = el.route.points;
        const fixedNode = end === 'to' ? el.edge.from : el.edge.to;
        const fixedSide = (end === 'to' ? el.edge.fromSide ?? el.route.fromSide : el.edge.toSide ?? el.route.toSide) ?? 'right';
        const start = end === 'to' ? pts[0] : pts[pts.length - 1];
        inter.current = { kind: 'connect', from: fixedNode, side: fixedSide, start, reconnect: { edgeId, end } };
        setTransient({ connect: { from: start, to: world, target: null } });
        svg.setPointerCapture(e.pointerId);
        setCursor('crosshair');
      }
      return;
    }

    const resizeEl = target.closest('[data-resize]') as HTMLElement | null;
    if (resizeEl) {
      const id = resizeEl.dataset.resizeNode!;
      const corner = resizeEl.dataset.resize as Corner;
      const box = layoutRef.current.boxes.get(id)!;
      const fixed = {
        x: corner.includes('e') ? box.cx - box.w / 2 : box.cx + box.w / 2,
        y: corner.includes('s') ? box.cy - box.h / 2 : box.cy + box.h / 2,
      };
      const aspect = box.node.type === 'image' && box.h > 0 ? box.w / box.h : undefined;
      inter.current = { kind: 'resize', id, corner, fixed, moved: false, aspect };
      svg.setPointerCapture(e.pointerId);
      return;
    }

    // bend point (■): drag to move it; auto-routed bends are baked on the first move
    const wpEl = target.closest('[data-waypoint]') as HTMLElement | null;
    if (wpEl) {
      const edgeId = wpEl.dataset.waypointEdge!;
      const el = layoutRef.current.edges.find((x) => x.edge.id === edgeId);
      if (el) {
        inter.current = { kind: 'waypoint', edgeId, index: Number(wpEl.dataset.waypoint), moved: false, bake: makeBake(el, false) };
        svg.setPointerCapture(e.pointerId);
      }
      return;
    }

    // segment bar (▬): move the segment sideways (its bend points follow; ends slide along the block)
    const segEl = target.closest('[data-segment]') as HTMLElement | null;
    if (segEl) {
      const edgeId = segEl.dataset.segmentEdge!;
      const seg = Number(segEl.dataset.segment);
      const el = layoutRef.current.edges.find((x) => x.edge.id === edgeId);
      if (el) {
        const pts = el.route.points;
        const a = pts[seg];
        const b = pts[seg + 1];
        const axis: 'x' | 'y' = Math.abs(a.x - b.x) < 0.5 ? 'x' : 'y';
        const bake = makeBake(el, true);
        const interiorCount = pts.length - 2;
        const idx = interiorCount === 0 ? [0, 1] : [seg - 1, seg].filter((k) => k >= 0 && k < interiorCount);
        inter.current = { kind: 'segment', edgeId, idx, axis, orig: axis === 'x' ? a.x : a.y, start: world, moved: false, bake };
        svg.setPointerCapture(e.pointerId);
      }
      return;
    }

    const midEl = target.closest('[data-midpoint]') as HTMLElement | null;
    if (midEl) {
      const edgeId = midEl.dataset.midpointEdge!;
      const seg = Number(midEl.dataset.midpoint);
      const el = layoutRef.current.edges.find((x) => x.edge.id === edgeId);
      if (el) {
        const pts = el.route.points;
        const pt = { x: snapV(world.x), y: snapV(world.y) };
        st.liveUpdate((d) => {
          const ed = d.edges.find((x) => x.id === edgeId);
          if (!ed) return;
          const wps = pts.slice(1, -1).map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
          wps.splice(seg, 0, pt);
          ed.waypoints = wps;
          if (ed.route !== 'straight') {
            if (el.route.fromSide) ed.fromSide = el.route.fromSide;
            if (el.route.toSide) ed.toSide = el.route.toSide;
          }
        });
        inter.current = { kind: 'waypoint', edgeId, index: seg, moved: true };
        svg.setPointerCapture(e.pointerId);
      }
      return;
    }

    const labelEl = target.closest('[data-edge-label]') as HTMLElement | null;
    if (labelEl) {
      const edgeId = labelEl.dataset.edgeLabel!;
      const el = layoutRef.current.edges.find((x) => x.edge.id === edgeId);
      st.selectEdge(edgeId);
      if (el?.label) {
        inter.current = { kind: 'label', edgeId, mid: el.label.mid, moved: false };
        svg.setPointerCapture(e.pointerId);
      }
      return;
    }

    const nodeEl = target.closest('[data-node]') as HTMLElement | null;
    if (nodeEl && st.connectMode) {
      // connect mode: drag from anywhere on a node to another node
      const from = nodeEl.dataset.node!;
      const box = layoutRef.current.boxes.get(from)!;
      const side = sideToward(box, world);
      const start = anchorOnSide(box, side);
      inter.current = { kind: 'connect', from, side, start };
      setTransient({ connect: { from: start, to: world, target: null } });
      svg.setPointerCapture(e.pointerId);
      return;
    }
    if (nodeEl) {
      const id = nodeEl.dataset.node!;
      const additive = e.shiftKey;
      let selNodes = st.selection.nodes;
      if (additive) {
        st.selectNode(id, true);
        selNodes = useStore.getState().selection.nodes;
      } else if (!selNodes.includes(id)) {
        st.selectNode(id, false);
        selNodes = [id];
      } else if (st.selection.edges.length) {
        st.setSelection({ nodes: selNodes, edges: [] });
      }
      const orig = new Map<string, Point>();
      for (const nid of selNodes) {
        const n = st.diagram.nodes.find((x) => x.id === nid);
        if (n) orig.set(nid, { x: n.x, y: n.y });
      }
      if (orig.has(id)) {
        const origWps = new Map<string, Point[]>();
        for (const ed of st.diagram.edges) {
          if (orig.has(ed.from) || orig.has(ed.to)) origWps.set(ed.id, ed.waypoints.map((p) => ({ ...p })));
        }
        const guidesX: number[] = [];
        const guidesY: number[] = [];
        const group = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
        for (const b of layoutRef.current.boxes.values()) {
          if (orig.has(b.node.id)) {
            group.left = Math.min(group.left, b.cx - b.w / 2);
            group.right = Math.max(group.right, b.cx + b.w / 2);
            group.top = Math.min(group.top, b.cy - b.h / 2);
            group.bottom = Math.max(group.bottom, b.cy + b.h / 2);
          } else {
            guidesX.push(b.cx - b.w / 2, b.cx, b.cx + b.w / 2);
            guidesY.push(b.cy - b.h / 2, b.cy, b.cy + b.h / 2);
          }
        }
        inter.current = { kind: 'dragNodes', start: world, orig, origWps, primary: id, moved: false, guidesX, guidesY, group };
        svg.setPointerCapture(e.pointerId);
      }
      return;
    }

    const edgeEl = target.closest('[data-edge]') as HTMLElement | null;
    if (edgeEl) {
      const edgeId = edgeEl.dataset.edge!;
      st.selectEdge(edgeId);
      // dragging the line body moves the whole line (click without moving just selects)
      const el = layoutRef.current.edges.find((x) => x.edge.id === edgeId);
      if (el) {
        inter.current = { kind: 'edgeMove', edgeId, start: world, moved: false, bake: makeBake(el, true) };
        svg.setPointerCapture(e.pointerId);
      }
      return;
    }

    // background: marquee
    inter.current = { kind: 'marquee', start: world, additive: e.shiftKey };
    if (!e.shiftKey) st.clearSelection();
    svg.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const it = inter.current;
    const st = useStore.getState();
    if (it.kind === 'none') {
      const target = e.target as Element;
      const nodeEl = target.closest('[data-node]') as HTMLElement | null;
      const portEl = target.closest('[data-port-node]') as HTMLElement | null;
      const resizeEl = target.closest('[data-resize]') as HTMLElement | null;
      st.setHover(nodeEl?.dataset.node ?? portEl?.dataset.portNode ?? resizeEl?.dataset.resizeNode ?? null);
      return;
    }
    const world = toWorld(e.clientX, e.clientY);
    switch (it.kind) {
      case 'pan': {
        const dx = e.clientX - it.startClient.x;
        const dy = e.clientY - it.startClient.y;
        st.setView({ ...it.startView, x: it.startView.x + dx, y: it.startView.y + dy });
        break;
      }
      case 'marquee':
        setTransient({ marquee: { a: it.start, b: world } });
        break;
      case 'dragNodes': {
        const dx = world.x - it.start.x;
        const dy = world.y - it.start.y;
        if (!it.moved && Math.hypot(dx, dy) * st.view.zoom < 3) return;
        it.moved = true;
        const p0 = it.orig.get(it.primary)!;
        let ddx = e.shiftKey && Math.abs(dx) <= Math.abs(dy) ? 0 : dx;
        let ddy = e.shiftKey && Math.abs(dx) > Math.abs(dy) ? 0 : dy;
        // smart guides: snap the group's edges/center to other nodes' edges/centers
        const guides: { x?: number; y?: number } = {};
        const gb = it.group;
        const thr = 6 / st.view.zoom;
        const bestX = st.snap ? bestGuide([gb.left + ddx, (gb.left + gb.right) / 2 + ddx, gb.right + ddx], it.guidesX, thr) : null;
        const bestY = st.snap ? bestGuide([gb.top + ddy, (gb.top + gb.bottom) / 2 + ddy, gb.bottom + ddy], it.guidesY, thr) : null;
        ddx = bestX ? ddx + bestX.diff : snapV(p0.x + ddx) - p0.x;
        ddy = bestY ? ddy + bestY.diff : snapV(p0.y + ddy) - p0.y;
        if (bestX) guides.x = bestX.guide;
        if (bestY) guides.y = bestY.guide;
        setTransient(bestX || bestY ? { guides } : {});
        // Ctrl temporarily inverts the "edges follow" setting
        const follow = st.followEdges !== e.ctrlKey;
        st.liveUpdate((d) => {
          for (const n of d.nodes) {
            const o = it.orig.get(n.id);
            if (o) {
              n.x = o.x + ddx;
              n.y = o.y + ddy;
            }
          }
          for (const ed of d.edges) {
            const ow = it.origWps.get(ed.id);
            if (ow) ed.waypoints = ow.map((p) => ({ ...p }));
          }
          if (follow) followEdgesAfterMove(d.edges, new Set(it.orig.keys()), { x: ddx, y: ddy }, it.origWps);
        });
        break;
      }
      case 'resize': {
        it.moved = true;
        const sx = it.corner.includes('e') ? 1 : -1;
        const sy = it.corner.includes('s') ? 1 : -1;
        let w = Math.max(10, (snapV(world.x) - it.fixed.x) * sx);
        let h = Math.max(10, (snapV(world.y) - it.fixed.y) * sy);
        const node = st.diagram.nodes.find((n) => n.id === it.id);
        if (!node) return;
        if (node.type === 'sum' || node.type === 'junction' || (node.type === 'circle' && e.shiftKey)) {
          w = h = Math.max(w, h);
        } else if (it.aspect && !e.shiftKey) {
          // keep the picture's proportions; the larger relative change wins
          if (w / it.aspect >= h) h = Math.max(10, Math.round(w / it.aspect));
          else w = Math.max(10, Math.round(h * it.aspect));
        }
        const cx = it.fixed.x + (sx * w) / 2;
        const cy = it.fixed.y + (sy * h) / 2;
        st.liveUpdate((d) => {
          const n = d.nodes.find((x) => x.id === it.id);
          if (!n) return;
          n.x = cx;
          n.y = cy;
          n.w = w;
          n.h = h;
        });
        break;
      }
      case 'waypoint': {
        const first = !it.moved;
        it.moved = true;
        const p = { x: snapV(world.x), y: snapV(world.y) };
        st.liveUpdate((d) => {
          const ed = d.edges.find((x) => x.id === it.edgeId);
          if (!ed) return;
          if (first && it.bake) applyBake(ed, it.bake);
          if (ed.waypoints[it.index]) ed.waypoints[it.index] = p;
        });
        break;
      }
      case 'segment': {
        const first = !it.moved;
        it.moved = true;
        const v = snapV(it.orig + (it.axis === 'x' ? world.x - it.start.x : world.y - it.start.y));
        st.liveUpdate((d) => {
          const ed = d.edges.find((x) => x.id === it.edgeId);
          if (!ed) return;
          if (first) applyBake(ed, it.bake);
          for (const k of it.idx) {
            const p = ed.waypoints[k];
            if (!p) continue;
            if (it.axis === 'x') p.x = v;
            else p.y = v;
          }
        });
        break;
      }
      case 'edgeMove': {
        const dx = world.x - it.start.x;
        const dy = world.y - it.start.y;
        if (!it.moved && Math.hypot(dx, dy) * st.view.zoom < 4) return;
        it.moved = true;
        const p0 = it.bake.pts[0];
        const ddx = p0 ? snapV(p0.x + dx) - p0.x : dx;
        const ddy = p0 ? snapV(p0.y + dy) - p0.y : dy;
        st.liveUpdate((d) => {
          const ed = d.edges.find((x) => x.id === it.edgeId);
          if (!ed) return;
          applyBake(ed, it.bake);
          ed.waypoints = ed.waypoints.map((p) => ({ x: Math.round((p.x + ddx) * 10) / 10, y: Math.round((p.y + ddy) * 10) / 10 }));
        });
        break;
      }
      case 'label': {
        it.moved = true;
        const off = { x: Math.round(world.x - it.mid.x), y: Math.round(world.y - it.mid.y) };
        st.liveUpdate((d) => {
          const ed = d.edges.find((x) => x.id === it.edgeId);
          if (ed) ed.labelOffset = off;
        });
        break;
      }
      case 'connect': {
        let target: string | null = null;
        let to = world;
        const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const portEl = under?.closest('[data-port-node]') as HTMLElement | null;
        if (portEl && portEl.dataset.portNode !== it.from) {
          target = portEl.dataset.portNode!;
          to = anchorOnSide(layoutRef.current.boxes.get(target)!, portEl.dataset.portSide as Side);
        } else {
          const box = hitNode(world, it.from);
          if (box) {
            target = box.node.id;
            to = { x: box.cx, y: box.cy };
          }
        }
        st.setHover(target);
        setTransient({ connect: { from: it.start, to, target } });
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const it = inter.current;
    const st = useStore.getState();
    const svg = svgRef.current!;
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    inter.current = { kind: 'none' };
    setCursor(spaceDown.current ? 'grab' : undefined);
    switch (it.kind) {
      case 'marquee': {
        const world = toWorld(e.clientX, e.clientY);
        const x1 = Math.min(it.start.x, world.x);
        const x2 = Math.max(it.start.x, world.x);
        const y1 = Math.min(it.start.y, world.y);
        const y2 = Math.max(it.start.y, world.y);
        if (x2 - x1 > 2 || y2 - y1 > 2) {
          const ids: string[] = [];
          for (const b of layoutRef.current.boxes.values()) {
            const bx1 = b.cx - b.w / 2;
            const bx2 = b.cx + b.w / 2;
            const by1 = b.cy - b.h / 2;
            const by2 = b.cy + b.h / 2;
            if (bx1 <= x2 && bx2 >= x1 && by1 <= y2 && by2 >= y1) ids.push(b.node.id);
          }
          const prev = it.additive ? st.selection.nodes : [];
          st.setSelection({ nodes: [...new Set([...prev, ...ids])], edges: [] });
        }
        setTransient({});
        break;
      }
      case 'dragNodes':
        setTransient({});
        if (it.moved) st.commit();
        break;
      case 'resize':
      case 'waypoint':
      case 'segment':
      case 'edgeMove':
      case 'label':
        if (it.moved) st.commit();
        break;
      case 'connect': {
        const t = transient.connect?.target;
        if (t && t !== it.from) {
          const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
          const portEl = under?.closest('[data-port-node]') as HTMLElement | null;
          const dropSide = portEl && portEl.dataset.portNode === t ? (portEl.dataset.portSide as Side) : undefined;
          if (it.reconnect) {
            const { edgeId, end } = it.reconnect;
            st.updateEdge(edgeId, end === 'to' ? { to: t, toSide: dropSide } : { from: t, fromSide: dropSide });
          } else {
            st.addEdge(it.from, t, st.connectMode ? undefined : it.side, dropSide);
          }
        }
        st.setHover(null);
        setTransient({});
        setCursor(undefined);
        break;
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    // handled in onPointerDown (see handleDoubleClick)
    e.preventDefault();
  };

  // ---------------------------------------------------------------- render
  const s = diagram.style;
  const g = (s.grid || 10) * view.zoom;
  const z = view.zoom;
  const hs = 1 / z; // handle scale
  const bg = s.background && s.background !== 'transparent' && s.background !== 'none' ? s.background : '#ffffff';

  const singleNode = selection.nodes.length === 1 && selection.edges.length === 0 ? selection.nodes[0] : null;
  const portNodeIds = new Set<string>();
  if (hoverNode && inter.current.kind !== 'dragNodes') portNodeIds.add(hoverNode);
  if (singleNode) portNodeIds.add(singleNode);
  if (transient.connect?.target) portNodeIds.add(transient.connect.target);
  const singleEdge = selection.edges.length === 1 && selection.nodes.length === 0 ? layout.edges.find((x) => x.edge.id === selection.edges[0]) : undefined;

  // image files dropped onto the canvas become image nodes at the drop point
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.files?.length) return;
    e.preventDefault();
    const world = toWorld(e.clientX, e.clientY);
    void importImageFiles(e.dataTransfer.files, { x: snapV(world.x), y: snapV(world.y) });
  };

  return (
    <div className="canvas-wrap" ref={wrapRef} tabIndex={0} style={{ cursor: connectMode ? 'crosshair' : cursor }} onDragOver={onDragOver} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className="canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => inter.current.kind === 'none' && useStore.getState().setHover(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="grid" width={g} height={g} patternUnits="userSpaceOnUse" x={view.x % g} y={view.y % g}>
            <circle cx={0} cy={0} r={Math.min(1.2, 0.8 * Math.sqrt(z))} fill="#c3c9d2" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={bg} />
        {showGrid && <rect width="100%" height="100%" fill="url(#grid)" pointerEvents="none" />}
        <g transform={`translate(${view.x}, ${view.y}) scale(${z})`}>
          <DiagramContent layout={layout} mode="edit" selection={selSets} hoverNode={hoverNode} />
          {/* ---- overlay handles ---- */}
          <g className="overlay">
            {singleEdge && (
              <g>
                {singleEdge.route.points.slice(0, -1).map((p, i) => {
                  const pts = singleEdge.route.points;
                  const q = pts[i + 1];
                  if (Math.hypot(q.x - p.x, q.y - p.y) * z < 18) return null;
                  const mx = (p.x + q.x) / 2;
                  const my = (p.y + q.y) / 2;
                  const vertical = Math.abs(p.x - q.x) < 0.5;
                  const horizontal = Math.abs(p.y - q.y) < 0.5;
                  const segLen = Math.hypot(q.x - p.x, q.y - p.y) * z;
                  const insertHandle = (cx: number, cy: number) => (
                    <circle
                      key={'m' + i}
                      cx={cx}
                      cy={cy}
                      r={4.5 * hs}
                      fill="#fff"
                      stroke={HANDLE}
                      strokeWidth={1.5 * hs}
                      data-midpoint={i}
                      data-midpoint-edge={singleEdge.edge.id}
                      style={{ cursor: 'copy' }}
                    >
                      <title>{t('ドラッグで曲がり角（経由点）を追加（ダブルクリックで分岐点）')}</title>
                    </circle>
                  );
                  if (vertical || horizontal) {
                    // bar handle: drag to move the segment sideways; an insert handle sits at 1/4 on long segments
                    const L = 18 * hs;
                    const T = 7 * hs;
                    const HL = 28 * hs; // invisible, easier-to-grab hit area
                    const HT = 18 * hs;
                    return (
                      <React.Fragment key={'s' + i}>
                        {segLen > 70 && insertHandle(p.x + (q.x - p.x) * 0.25, p.y + (q.y - p.y) * 0.25)}
                        <g data-segment={i} data-segment-edge={singleEdge.edge.id} style={{ cursor: vertical ? 'ew-resize' : 'ns-resize' }}>
                          <title>{t('ドラッグでこの区間を平行移動（ダブルクリックで分岐点）')}</title>
                          <rect
                            x={mx - (vertical ? HT : HL) / 2}
                            y={my - (vertical ? HL : HT) / 2}
                            width={vertical ? HT : HL}
                            height={vertical ? HL : HT}
                            fill="transparent"
                            stroke="none"
                          />
                          <rect
                            x={mx - (vertical ? T : L) / 2}
                            y={my - (vertical ? L : T) / 2}
                            width={vertical ? T : L}
                            height={vertical ? L : T}
                            rx={2 * hs}
                            fill="#fff"
                            stroke={HANDLE}
                            strokeWidth={1.5 * hs}
                          />
                        </g>
                      </React.Fragment>
                    );
                  }
                  return insertHandle(mx, my);
                })}
                {/* bend points (auto-routed bends included; they become explicit `via` points when dragged) */}
                {singleEdge.route.points.slice(1, -1).map((p, k) => (
                  <rect
                    key={'w' + k}
                    x={p.x - 4.5 * hs}
                    y={p.y - 4.5 * hs}
                    width={9 * hs}
                    height={9 * hs}
                    fill={HANDLE}
                    stroke="#fff"
                    strokeWidth={1.5 * hs}
                    data-waypoint={k}
                    data-waypoint-edge={singleEdge.edge.id}
                    style={{ cursor: 'move' }}
                  >
                    <title>{t('ドラッグで曲がり角を移動（ダブルクリックで削除）')}</title>
                  </rect>
                ))}
                {(['from', 'to'] as const).map((end) => {
                  const pts = singleEdge.route.points;
                  const p = end === 'from' ? pts[0] : pts[pts.length - 1];
                  return (
                    <circle
                      key={end}
                      cx={p.x}
                      cy={p.y}
                      r={5.5 * hs}
                      fill={HANDLE}
                      stroke="#fff"
                      strokeWidth={1.5 * hs}
                      data-endpoint={end}
                      data-endpoint-edge={singleEdge.edge.id}
                      style={{ cursor: 'crosshair' }}
                    >
                      <title>{t('{end}をドラッグして別のブロックにつなぎ替え', { end: end === 'from' ? t('始点') : t('終点') })}</title>
                    </circle>
                  );
                })}
              </g>
            )}
            {[...portNodeIds].map((id) => {
              const box = layout.boxes.get(id);
              if (!box) return null;
              return (
                <g key={'ports-' + id}>
                  {SIDES.map((side) => {
                    const a = anchorOnSide(box, side);
                    const d = SIDE_DIR[side];
                    const off = 9 * hs;
                    return (
                      <circle
                        key={side}
                        cx={a.x + d.x * off}
                        cy={a.y + d.y * off}
                        r={5 * hs}
                        fill="#fff"
                        stroke={HANDLE}
                        strokeWidth={1.5 * hs}
                        data-port-node={id}
                        data-port-side={side}
                        style={{ cursor: 'crosshair' }}
                      />
                    );
                  })}
                </g>
              );
            })}
            {singleNode &&
              (() => {
                const box = layout.boxes.get(singleNode);
                if (!box) return null;
                const corners: { c: Corner; x: number; y: number; cur: string }[] = [
                  { c: 'nw', x: box.cx - box.w / 2, y: box.cy - box.h / 2, cur: 'nwse-resize' },
                  { c: 'ne', x: box.cx + box.w / 2, y: box.cy - box.h / 2, cur: 'nesw-resize' },
                  { c: 'sw', x: box.cx - box.w / 2, y: box.cy + box.h / 2, cur: 'nesw-resize' },
                  { c: 'se', x: box.cx + box.w / 2, y: box.cy + box.h / 2, cur: 'nwse-resize' },
                ];
                return corners.map((k) => (
                  <rect
                    key={k.c}
                    x={k.x - 4 * hs}
                    y={k.y - 4 * hs}
                    width={8 * hs}
                    height={8 * hs}
                    fill="#fff"
                    stroke={HANDLE}
                    strokeWidth={1.5 * hs}
                    data-resize={k.c}
                    data-resize-node={singleNode}
                    style={{ cursor: k.cur }}
                  />
                ));
              })()}
            {transient.connect && (
              <line
                x1={transient.connect.from.x}
                y1={transient.connect.from.y}
                x2={transient.connect.to.x}
                y2={transient.connect.to.y}
                stroke={HANDLE}
                strokeWidth={1.5 * hs}
                strokeDasharray={`${4 * hs} ${3 * hs}`}
                pointerEvents="none"
              />
            )}
            {transient.guides &&
              (() => {
                const ww = wrapRef.current?.clientWidth ?? 2000;
                const wh = wrapRef.current?.clientHeight ?? 2000;
                const x1 = -view.x / z;
                const y1 = -view.y / z;
                const x2 = (ww - view.x) / z;
                const y2 = (wh - view.y) / z;
                const gp = { stroke: GUIDE, strokeWidth: 1 * hs, strokeDasharray: `${4 * hs} ${3 * hs}`, pointerEvents: 'none' as const };
                return (
                  <>
                    {transient.guides.x !== undefined && <line x1={transient.guides.x} y1={y1} x2={transient.guides.x} y2={y2} {...gp} />}
                    {transient.guides.y !== undefined && <line x1={x1} y1={transient.guides.y} x2={x2} y2={transient.guides.y} {...gp} />}
                  </>
                );
              })()}
            {transient.marquee && (
              <rect
                x={Math.min(transient.marquee.a.x, transient.marquee.b.x)}
                y={Math.min(transient.marquee.a.y, transient.marquee.b.y)}
                width={Math.abs(transient.marquee.b.x - transient.marquee.a.x)}
                height={Math.abs(transient.marquee.b.y - transient.marquee.a.y)}
                fill="rgba(43,125,233,0.08)"
                stroke={HANDLE}
                strokeWidth={1 * hs}
                pointerEvents="none"
              />
            )}
          </g>
        </g>
      </svg>
      {errorCount > 0 && <div className="canvas-error-banner">{t('コードに {n} 件のエラーがあります（該当行は図に反映されません）', { n: errorCount })}</div>}
      <div className="canvas-hint" style={connectMode ? { color: '#1b57a8', background: 'rgba(230,240,253,0.95)', fontWeight: 600 } : undefined}>
        {connectMode
          ? '接続モード: 始点のブロックから終点のブロックへドラッグ（ポート○に落とすと辺を固定、Esc / C で終了）'
          : t('ドラッグ: 移動 ・ ポート○ / 「接続」(C): 線を引く ・ 線をダブルクリック: 分岐点を挿入 ・ 線の端点ドラッグ: つなぎ替え ・ 空白ダブルクリック: ブロック追加 ・ 画像はドロップ / Ctrl+V で追加')}
      </div>
      <div className="canvas-hud">
        <button className="btn" onClick={() => canvasApi.current?.zoomBy(1 / 1.2)} title={t('縮小')}>
          −
        </button>
        <span className="zoom">{Math.round(view.zoom * 100)}%</span>
        <button className="btn" onClick={() => canvasApi.current?.zoomBy(1.2)} title={t('拡大')}>
          +
        </button>
        <button className="btn" onClick={() => canvasApi.current?.resetZoom()} title="100%">
          1:1
        </button>
        <button className="btn" onClick={() => canvasApi.current?.fit()} title={t('全体表示')}>
          ⤢ 全体
        </button>
      </div>
    </div>
  );
}
