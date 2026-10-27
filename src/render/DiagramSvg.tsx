import React from 'react';
import { Box, perpLeft } from '../geometry/geometry';
import { ArrowKind, Assets, DEdge, DStyle, Point, edgeTextDefaults, resolveNode, resolveSrc } from '../model/types';
import { LabelSvg } from './label';
import { DiagramLayout, EdgeLayout, junctionDotVisible, nodeLabelPos } from './layout';

export interface Selection {
  nodes: Set<string>;
  edges: Set<string>;
}

export interface DiagramSvgProps {
  layout: DiagramLayout;
  mode: 'edit' | 'export';
  selection?: Selection;
  hoverNode?: string | null;
  /** extra overlay (handles) rendered on top, edit mode only */
  overlay?: React.ReactNode;
}

const SEL_COLOR = '#2b7de9';

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function NodeShape({
  box,
  style,
  assets,
  selected,
  hover,
  edit,
}: {
  box: Box;
  style: DStyle;
  assets: Assets;
  selected: boolean;
  hover: boolean;
  edit: boolean;
}) {
  const n = box.node;
  const { cx, cy, w, h } = box;
  const rs = resolveNode(n, style);
  const fill = rs.fill;
  const stroke = rs.stroke;
  const sw = rs.strokeWidth;
  const dashArr = rs.dash === 'dashed' ? `${sw * 5} ${sw * 3}` : rs.dash === 'dotted' ? `${sw} ${sw * 2}` : undefined;
  const common = { fill, stroke, strokeWidth: sw, strokeDasharray: dashArr } as const;
  const x = cx - w / 2;
  const y = cy - h / 2;
  let shape: React.ReactNode = null;
  switch (n.type) {
    case 'block':
      shape = <rect x={x} y={y} width={w} height={h} rx={rs.radius} {...common} />;
      break;
    case 'rounded':
      shape = <rect x={x} y={y} width={w} height={h} rx={rs.radius} {...common} />;
      break;
    case 'circle':
      shape = <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} {...common} />;
      break;
    case 'diamond':
      shape = <polygon points={`${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`} {...common} />;
      break;
    case 'gain': {
      const pts = n.flip
        ? `${x + w},${y} ${x},${cy} ${x + w},${y + h}`
        : `${x},${y} ${x + w},${cy} ${x},${y + h}`;
      shape = <polygon points={pts} strokeLinejoin="round" {...common} />;
      break;
    }
    case 'sum': {
      const r = w / 2;
      const k = r * Math.SQRT1_2;
      shape = (
        <>
          <circle cx={cx} cy={cy} r={r} {...common} />
          {rs.sumStyle === 'cross' && (
            <>
              <line x1={cx - k} y1={cy - k} x2={cx + k} y2={cy + k} stroke={stroke} strokeWidth={sw} />
              <line x1={cx + k} y1={cy - k} x2={cx - k} y2={cy + k} stroke={stroke} strokeWidth={sw} />
            </>
          )}
        </>
      );
      break;
    }
    case 'junction':
      if (junctionDotVisible(n, style)) {
        shape = <circle cx={cx} cy={cy} r={w / 2} fill={rs.fill} stroke="none" />;
      } else if (edit) {
        // invisible branch point: show a faint hint + hit area in the editor only
        shape = (
          <>
            <circle cx={cx} cy={cy} r={7} fill="transparent" stroke="none" />
            <circle cx={cx} cy={cy} r={4} fill="none" stroke="#9aa4b2" strokeWidth={1} strokeDasharray="2 2" pointerEvents="none" vectorEffect="non-scaling-stroke" />
          </>
        );
      }
      break;
    case 'text':
      // hit area for the editor only. Never export it: PowerPoint's SVG renderer does not
      // understand fill="transparent" and paints such rectangles black.
      shape = edit ? <rect x={x} y={y} width={w} height={h} fill="transparent" stroke="none" /> : null;
      break;
    case 'image': {
      const href = resolveSrc(n.src, assets);
      shape = (
        <>
          {fill !== 'none' && fill !== 'transparent' && <rect x={x} y={y} width={w} height={h} rx={rs.radius} fill={fill} stroke="none" />}
          {href ? (
            <image x={x} y={y} width={w} height={h} href={href} xlinkHref={href} preserveAspectRatio="xMidYMid meet" />
          ) : (
            // missing picture: show a placeholder so the problem is visible (also in exports)
            <>
              <rect x={x} y={y} width={w} height={h} fill="#f3f4f6" stroke="#9aa4b2" strokeWidth={1} strokeDasharray="4 3" />
              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(12, h / 3)} fill="#6b7280">
                {n.src ? n.src : 'image'}
              </text>
            </>
          )}
          {edit && <rect x={x} y={y} width={w} height={h} fill="transparent" stroke="none" />}
          {stroke !== 'none' && stroke !== 'transparent' && (
            <rect x={x} y={y} width={w} height={h} rx={rs.radius} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={dashArr} />
          )}
        </>
      );
      break;
    }
  }
  return (
    <>
      {shape}
      {(selected || hover) && (
        <rect
          x={x - 3}
          y={y - 3}
          width={w + 6}
          height={h + 6}
          fill="none"
          stroke={SEL_COLOR}
          strokeWidth={selected ? 1.5 : 1}
          strokeDasharray={selected ? undefined : '3 3'}
          opacity={selected ? 1 : 0.6}
          pointerEvents="none"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

function arrowKind(e: DEdge, s: DStyle, toJunction: boolean): ArrowKind {
  if (e.arrow !== undefined) return e.arrow;
  return toJunction ? 'none' : s.arrow;
}

function ArrowHead({ tip, dir, kind, size, color, lineWidth }: { tip: Point; dir: Point; kind: ArrowKind; size: number; color: string; lineWidth: number }) {
  if (kind === 'none') return null;
  const perp = perpLeft(dir);
  const L = size;
  const hw = size * 0.4;
  const base = { x: tip.x - dir.x * L, y: tip.y - dir.y * L };
  const p1 = { x: base.x + perp.x * hw, y: base.y + perp.y * hw };
  const p2 = { x: base.x - perp.x * hw, y: base.y - perp.y * hw };
  if (kind === 'open') {
    return (
      <polyline
        points={`${p1.x},${p1.y} ${tip.x},${tip.y} ${p2.x},${p2.y}`}
        fill="none"
        stroke={color}
        strokeWidth={lineWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  if (kind === 'dot') {
    const r = size * 0.35;
    return <circle cx={tip.x - dir.x * r} cy={tip.y - dir.y * r} r={r} fill={color} />;
  }
  return <polygon points={`${tip.x},${tip.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`} fill={color} stroke="none" />;
}

function shorten(points: Point[], startBy: number, endBy: number): Point[] {
  const pts = points.map((p) => ({ ...p }));
  if (pts.length < 2) return pts;
  if (endBy > 0) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.min(endBy, l * 0.9) / l;
    pts[pts.length - 1] = { x: b.x - (b.x - a.x) * t, y: b.y - (b.y - a.y) * t };
  }
  if (startBy > 0) {
    const a = pts[0];
    const b = pts[1];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.min(startBy, l * 0.9) / l;
    pts[0] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return pts;
}

function pathD(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
}

function EdgeShape({ el, style, selected, edit }: { el: EdgeLayout; style: DStyle; selected: boolean; edit: boolean }) {
  const e = el.edge;
  const color = e.color ?? style.lineColor;
  const lw = e.width ?? style.lineWidth;
  const kind = arrowKind(e, style, el.toJunction);
  const size = style.arrowSize;
  const endKind: ArrowKind = kind === 'both' ? 'triangle' : kind;
  const startKind: ArrowKind = kind === 'both' ? 'triangle' : 'none';
  const shortenBy = (k: ArrowKind) => (k === 'triangle' ? size * 0.7 : k === 'dot' ? size * 0.35 : 0);
  const pts = el.route.points;
  const drawn = shorten(pts, shortenBy(startKind), shortenBy(endKind));
  const dash = e.dash === 'dashed' ? `${lw * 5} ${lw * 3}` : e.dash === 'dotted' ? `${lw} ${lw * 2}` : undefined;
  const d = pathD(drawn);
  const start = pts[0];
  const end = pts[pts.length - 1];
  return (
    <g data-edge-group={e.id}>
      {edit && selected && <path d={pathD(pts)} fill="none" stroke={SEL_COLOR} strokeWidth={lw + 6} opacity={0.25} strokeLinejoin="round" />}
      <path d={d} fill="none" stroke={color} strokeWidth={lw} strokeDasharray={dash} strokeLinejoin="round" strokeLinecap={dash ? 'butt' : 'round'} />
      <ArrowHead tip={end} dir={el.route.endDir} kind={endKind} size={size} color={color} lineWidth={lw} />
      <ArrowHead tip={start} dir={{ x: -el.route.startDir.x, y: -el.route.startDir.y }} kind={startKind} size={size} color={color} lineWidth={lw} />
      {edit && <path d={pathD(pts)} fill="none" stroke="transparent" strokeWidth={Math.max(12, lw + 8)} data-edge={e.id} style={{ cursor: 'move' }} />}
      {el.label && (
        <LabelSvg
          layout={el.label.layout}
          x={el.label.pos.x}
          y={el.label.pos.y}
          color={e.color ?? edgeTextDefaults(style).color}
          dataAttrs={edit ? { 'data-edge-label': e.id } : undefined}
          className={edit ? 'edge-label' : undefined}
        />
      )}
      {el.sign && <LabelSvg layout={el.sign.layout} x={el.sign.pos.x} y={el.sign.pos.y} color={edgeTextDefaults(style).color} />}
      {edit && el.label && (
        <rect
          x={el.label.pos.x - el.label.layout.w / 2 - 3}
          y={el.label.pos.y - el.label.layout.h / 2 - 2}
          width={el.label.layout.w + 6}
          height={el.label.layout.h + 4}
          fill="transparent"
          stroke={selected ? SEL_COLOR : 'none'}
          strokeDasharray="2 2"
          strokeWidth={1}
          data-edge-label={e.id}
          style={{ cursor: 'move' }}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Diagram
// ---------------------------------------------------------------------------

export function DiagramContent({ layout, mode, selection, hoverNode }: DiagramSvgProps) {
  const { diagram, boxes, labels, edges } = layout;
  const s = diagram.style;
  const edit = mode === 'edit';
  return (
    <>
      <g className="edges">
        {edges.map((el) => (
          <EdgeShape key={el.edge.id} el={el} style={s} selected={!!selection?.edges.has(el.edge.id)} edit={edit} />
        ))}
      </g>
      <g className="nodes">
        {diagram.nodes.map((n) => {
          const box = boxes.get(n.id)!;
          const lay = labels.get(n.id)!;
          const selected = !!selection?.nodes.has(n.id);
          const lp = nodeLabelPos(box, lay, s);
          return (
            <g key={n.id} data-node={n.id} style={edit ? { cursor: 'move' } : undefined}>
              <NodeShape box={box} style={s} assets={diagram.assets} selected={selected} hover={edit && hoverNode === n.id && !selected} edit={edit} />
              {(n.label !== '' || n.type === 'sum') && (
                <LabelSvg layout={lay} x={lp.x} y={lp.y} color={n.color ?? s.textColor} />
              )}
              {edit && selected && n.label !== '' && (
                // drag handle for the label of the selected node (moves the label, not the node)
                <rect
                  x={lp.x - lay.w / 2 - 3}
                  y={lp.y - lay.h / 2 - 2}
                  width={lay.w + 6}
                  height={lay.h + 4}
                  fill="transparent"
                  stroke={SEL_COLOR}
                  strokeDasharray="2 2"
                  strokeWidth={1}
                  opacity={0.7}
                  data-node-label={n.id}
                  style={{ cursor: 'move' }}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          );
        })}
      </g>
    </>
  );
}

/** Standalone SVG document used for export. */
export function ExportSvg({ layout }: { layout: DiagramLayout }) {
  const s = layout.diagram.style;
  const pad = s.padding;
  const b = layout.bounds;
  const x = Math.floor(b.x - pad);
  const y = Math.floor(b.y - pad);
  const w = Math.ceil(b.w + pad * 2);
  const h = Math.ceil(b.h + pad * 2);
  const bg = s.background && s.background !== 'transparent' && s.background !== 'none' ? s.background : undefined;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      width={w}
      height={h}
      viewBox={`${x} ${y} ${w} ${h}`}
      fontFamily={s.font}
    >
      {bg && <rect x={x} y={y} width={w} height={h} fill={bg} />}
      <DiagramContent layout={layout} mode="export" />
    </svg>
  );
}

export function exportSize(layout: DiagramLayout): { x: number; y: number; w: number; h: number } {
  const pad = layout.diagram.style.padding;
  const b = layout.bounds;
  return { x: Math.floor(b.x - pad), y: Math.floor(b.y - pad), w: Math.ceil(b.w + pad * 2), h: Math.ceil(b.h + pad * 2) };
}
