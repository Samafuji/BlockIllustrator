import { useT } from '../i18n';
import React, { useEffect, useRef, useState } from 'react';
import {
  ARROW_KINDS,
  DEFAULT_STYLE,
  DEdge,
  DNode,
  DStyle,
  LABEL_POSITIONS,
  LabelPos,
  NODE_TYPES,
  NodeType,
  SIDES,
  Side,
  edgeTextDefaults,
  nodeSize,
  resolveNode,
} from '../model/types';
import { AlignMode, useStore } from '../store/useStore';
import { layoutDiagram } from '../render/layout';
import { fitNodeToImage, replaceNodeImage } from '../io/images';

// ---------------------------------------------------------------- fields

export function TextField({
  label,
  value,
  onCommit,
  placeholder,
  multiline,
  focusKey,
  mono,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  focusKey?: number;
  mono?: boolean;
}) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (focusKey) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [focusKey]);
  const commit = () => {
    if (v !== value) onCommit(v);
  };
  const common = {
    ref: ref as any,
    value: v,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (!multiline || e.ctrlKey)) {
        e.preventDefault();
        commit();
        (e.target as HTMLElement).blur();
      }
      if (e.key === 'Escape') {
        setV(value);
        (e.target as HTMLElement).blur();
      }
    },
    style: mono ? { fontFamily: 'Consolas, Menlo, monospace' } : undefined,
  };
  return (
    <div className="field">
      <label>{label}</label>
      {multiline ? <textarea {...common} /> : <input type="text" {...common} />}
    </div>
  );
}

export function NumField({
  label,
  value,
  onCommit,
  placeholder,
  step = 1,
  min,
}: {
  label: string;
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  placeholder?: string;
  step?: number;
  min?: number;
}) {
  const p = useNumInput(value, onCommit, placeholder, step, min);
  return (
    <div className="field">
      <label>{label}</label>
      <input type="number" {...p} />
    </div>
  );
}

/**
 * Shared behaviour for numeric inputs that may be empty (= "use the default",
 * shown as placeholder). Arrow keys and the spin buttons step from the default
 * value instead of from 0 when the field is empty, and step changes are
 * committed immediately; typed values are committed on blur / Enter.
 */
function useNumInput(value: number | undefined, onCommit: (v: number | undefined) => void, placeholder?: string, step = 1, min?: number) {
  const [v, setV] = useState(value === undefined ? '' : String(value));
  useEffect(() => setV(value === undefined ? '' : String(value)), [value]);
  const commit = () => {
    if (v.trim() === '') {
      if (value !== undefined) onCommit(undefined);
      return;
    }
    const n = Number(v);
    if (isNaN(n)) {
      setV(value === undefined ? '' : String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };
  const clampRound = (n: number) => {
    let r = Math.round(n * 1000) / 1000;
    if (min !== undefined && r < min) r = min;
    return r;
  };
  const stepBy = (dir: 1 | -1) => {
    const base = v.trim() === '' ? Number(placeholder) : Number(v);
    if (isNaN(base)) return;
    const n = clampRound(base + dir * step);
    setV(String(n));
    onCommit(n);
  };
  return {
    value: v,
    step,
    min,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputType = (e.nativeEvent as InputEvent).inputType;
      if (!inputType) {
        // spin buttons (no inputType): step from the default when empty, commit immediately
        if (v.trim() === '' && placeholder !== undefined && !isNaN(Number(placeholder))) {
          const n = Number(e.target.value);
          stepBy(n > (min ?? 0) || (min === undefined && n > 0) ? 1 : -1);
          return;
        }
        const n = Number(e.target.value);
        if (e.target.value !== '' && !isNaN(n)) {
          setV(String(n));
          onCommit(n);
          return;
        }
      }
      setV(e.target.value);
    },
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        stepBy(e.key === 'ArrowUp' ? 1 : -1);
        return;
      }
      if (e.key === 'Enter') {
        commit();
        (e.target as HTMLElement).blur();
      }
      if (e.key === 'Escape') {
        setV(value === undefined ? '' : String(value));
        (e.target as HTMLElement).blur();
      }
    },
  };
}

function toHex(c: string | undefined): string {
  if (!c) return '#000000';
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  if (/^#[0-9a-fA-F]{8}$/.test(c)) return c.slice(0, 7);
  // named colors: resolve through canvas
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.fillStyle = c;
      const s = ctx.fillStyle;
      if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    }
  } catch {
    /* ignore */
  }
  return '#000000';
}

export function ColorField({
  label,
  value,
  placeholder,
  onLive,
  onCommit,
  allowNone,
}: {
  label: string;
  value: string | undefined;
  placeholder?: string;
  onLive?: (v: string) => void;
  onCommit: (v: string | undefined) => void;
  allowNone?: boolean;
}) {
  const t = useT();
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const commitText = () => {
    const t = text.trim();
    if (t === '') {
      if (value !== undefined) onCommit(undefined);
    } else if (t !== value) onCommit(t);
  };
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row">
        <input
          type="color"
          value={toHex(value ?? placeholder)}
          onInput={(e) => onLive?.((e.target as HTMLInputElement).value)}
          onChange={(e) => onCommit(e.target.value)}
          title={t('色を選択')}
        />
        <input
          type="text"
          value={text}
          placeholder={placeholder ?? t('(既定)')}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitText();
              (e.target as HTMLElement).blur();
            }
          }}
        />
        {allowNone && (
          <button className="btn clear" title={t('なし (透明)')} onClick={() => onCommit('none')}>
            ∅
          </button>
        )}
        {value !== undefined && (
          <button className="btn clear" title={t('既定に戻す')} onClick={() => onCommit(undefined)}>
            ×
          </button>
        )}
      </div>
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onCommit: (v: T) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onCommit(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const TYPE_LABELS: Record<NodeType, string> = {
  block: 'ブロック',
  rounded: '角丸ブロック',
  circle: '円 / 楕円',
  diamond: 'ひし形',
  gain: 'ゲイン (三角)',
  sum: '加算点',
  junction: '分岐点',
  text: 'テキスト',
  image: '画像',
};

const SIDE_LABELS: Record<Side, string> = { left: '左', right: '右', top: '上', bottom: '下' };
export const LABEL_POS_LABELS: Record<LabelPos, string> = { center: '中央 (図形の中)', top: '上', bottom: '下', left: '左', right: '右' };
const ARROW_LABELS: Record<string, string> = {
  triangle: '三角 (塗り)',
  open: '開いた矢印',
  none: 'なし',
  dot: '点',
  both: '両方向',
};

const FONT_PRESETS: { value: string; label: string }[] = [
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial / Helvetica' },
  { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Georgia' },
  { value: "Cambria, Georgia, 'Times New Roman', serif", label: 'Cambria' },
  { value: "'Segoe UI', Meiryo, 'Yu Gothic UI', sans-serif", label: 'Segoe UI / Meiryo' },
  { value: "Meiryo, 'Yu Gothic', 'Hiragino Sans', sans-serif", label: 'メイリオ / 游ゴシック (日本語)' },
  { value: "'Yu Mincho', 'MS Mincho', 'Hiragino Mincho ProN', serif", label: '游明朝 / MS 明朝 (日本語)' },
  { value: "'Microsoft JhengHei', 'PingFang TC', 'Noto Sans CJK TC', sans-serif", label: '微軟正黑體 (繁體中文)' },
  { value: "'Noto Sans CJK JP', 'Noto Sans JP', 'Noto Sans TC', sans-serif", label: 'Noto Sans CJK' },
  { value: "Consolas, 'Courier New', monospace", label: 'Consolas / Courier New' },
];

const HELP_ITEMS: string[] = [
  'ノードをドラッグで移動、角のハンドルでサイズ変更',
  'ノード上の青い○ (ポート) から別ノードへドラッグで接続。または「接続」モード (C)',
  '線を選択 → ▬ で区間移動、■ で曲がり角移動、○ で曲がり角追加。線をダブルクリックで分岐点',
  '線ラベルはドラッグで位置調整',
  '空白ダブルクリックでブロック追加',
  'Shift+クリック / 範囲ドラッグで複数選択。整列はツールバーまたは Alt+A/H/D/W/V/S',
  'ホイール: スクロール / Ctrl+ホイール: ズーム / Space+ドラッグ・中ボタン: パン',
  'Delete 削除、Ctrl+D 複製、Ctrl+Z 元に戻す、矢印キーで微調整',
  'Ctrl+C / Ctrl+X / Ctrl+V でコピー・切り取り・貼り付け（別の図やテキストエディタにも貼れます）',
  'ラベル内の $...$ は LaTeX 数式（例: $G(s)=\\frac{1}{s+1}$）',
  '画像: パレットの「画像」、キャンバスへのドロップ、Ctrl+V（スクリーンショット）で追加。ラベルは画像の下にキャプションとして表示',
];

function ImageSection({ node }: { node: DNode }) {
  const t = useT();
  const assets = useStore((s) => s.diagram.assets);
  const href = node.src ? assets[node.src] ?? node.src : undefined;
  const embedded = !!node.src && assets[node.src] !== undefined;
  const kb = embedded ? Math.round(((assets[node.src!].length * 3) / 4) / 1024) : 0;
  return (
    <>
      <h3>{t('画像')}</h3>
      <div className="image-preview">
        {href ? <img src={href} alt="" /> : <span className="muted">{t('画像がありません')}</span>}
      </div>
      <div className="muted" style={{ marginBottom: 4 }}>
        {node.src ? (embedded ? t('埋め込み: {name} (約 {kb} KB)', { name: node.src, kb }) : t('URL: {v}', { v: node.src })) : t('(未設定)')}
      </div>
      <div className="btn-row">
        <button className="btn" onClick={() => void replaceNodeImage(node.id)}>
          {t('画像を変更…')}
        </button>
        <button className="btn" onClick={() => void fitNodeToImage(node.id)} disabled={!href} title={t('幅はそのままで、高さを画像の縦横比に合わせます')}>
          {t('縦横比を元に戻す')}
        </button>
      </div>
      <p className="muted">{t('角のハンドルは縦横比を保ってサイズ変更します（Shift で自由に変形）。ラベルは画像の下にキャプションとして表示されます。')}</p>
    </>
  );
}

// ---------------------------------------------------------------- node

function NodeInspector({ node }: { node: DNode }) {
  const t = useT();
  const style = useStore((s) => s.diagram.style);
  const focusReq = useStore((s) => s.focusLabelRequest);
  const upd = (patch: Partial<DNode>, live?: boolean) => useStore.getState().updateNode(node.id, patch, live);
  const size = nodeSize(node, style);
  const rs = resolveNode(node, style);
  const isShape = node.type !== 'text' && node.type !== 'junction';
  return (
    <div className="inspector">
      <h3>{t('ノード')}</h3>
      <TextField
        label="ID"
        value={node.id}
        mono
        onCommit={(v) => {
          if (!useStore.getState().renameNode(node.id, v)) {
            window.alert('ID は英字で始まる英数字・_ のみ、かつ重複不可です');
          }
        }}
      />
      <SelectField
        label={t('種類')}
        value={node.type}
        options={NODE_TYPES.map((ty) => ({ value: ty, label: t(TYPE_LABELS[ty]) }))}
        onCommit={(v) => upd({ type: v })}
      />
      <TextField
        label={node.type === 'image' ? t('キャプション') : t('ラベル')}
        value={node.label}
        multiline
        focusKey={focusReq}
        placeholder={t('テキスト。数式は $...$、改行可 (Ctrl+Enter で確定)')}
        onCommit={(v) => upd({ label: v })}
      />
      {node.type === 'image' && <ImageSection node={node} />}
      <SelectField
        label={node.type === 'image' ? t('キャプションの位置') : t('ラベルの位置')}
        value={node.labelPos ?? 'default'}
        options={[
          { value: 'default', label: t('既定 ({v})', { v: t(LABEL_POS_LABELS[rs.labelPos]) }) },
          ...LABEL_POSITIONS.map((p) => ({ value: p, label: t(LABEL_POS_LABELS[p]) })),
        ]}
        onCommit={(v) => upd({ labelPos: v === 'default' ? undefined : (v as LabelPos) })}
      />
      <h3>{t('位置・サイズ')}</h3>
      <div className="field">
        <label>{t('位置 (x, y)')}</label>
        <div className="pair">
          <NumFieldInline value={node.x} onCommit={(v) => upd({ x: v ?? node.x })} />
          <NumFieldInline value={node.y} onCommit={(v) => upd({ y: v ?? node.y })} />
        </div>
      </div>
      {node.type !== 'junction' && node.type !== 'sum' ? (
        <div className="field">
          <label>{t('サイズ (w, h)')}</label>
          <div className="pair">
            <NumFieldInline value={node.w} placeholder={String(Math.round(size.w))} onCommit={(v) => upd({ w: v })} />
            <NumFieldInline value={node.h} placeholder={String(Math.round(size.h))} onCommit={(v) => upd({ h: v })} />
          </div>
        </div>
      ) : (
        <NumField label={t('直径')} value={node.w} placeholder={String(size.w)} onCommit={(v) => upd({ w: v, h: v })} />
      )}
      {(node.type === 'block' || node.type === 'rounded' || node.type === 'image') && (
        <NumField label={t('角丸半径')} value={node.radius} placeholder={String(rs.radius)} onCommit={(v) => upd({ radius: v })} />
      )}
      {node.type === 'gain' && (
        <label className="check">
          <input type="checkbox" checked={!!node.flip} onChange={(e) => upd({ flip: e.target.checked || undefined })} />
          左向き (flip)
        </label>
      )}
      {node.type === 'junction' && (
        <SelectField
          label={t('点の表示')}
          value={node.hidden === true ? 'hidden' : node.hidden === false ? 'visible' : 'default'}
          options={[
            { value: 'default', label: t('全体設定に従う ({v})', { v: style.junctionStyle === 'none' ? t('点なし') : t('点あり') }) },
            { value: 'visible', label: t('点を描く') },
            { value: 'hidden', label: t('点なし（線のみで分岐）') },
          ]}
          onCommit={(v) => upd({ hidden: v === 'default' ? undefined : v === 'hidden' })}
        />
      )}
      {node.type === 'sum' && (
        <SelectField
          label={t('加算点の表示')}
          value={node.sumStyle ?? 'plain'}
          options={[
            { value: 'plain', label: t('円のみ') },
            { value: 'cross', label: t('円 + ×') },
            { value: 'sigma', label: t('円 + Σ') },
          ]}
          onCommit={(v) => upd({ sumStyle: v === 'plain' ? undefined : v })}
        />
      )}
      <h3>{t('スタイル (個別)')}</h3>
      {isShape && (
        <>
          <ColorField label={t('塗り')} value={node.fill} placeholder={rs.fill} allowNone onLive={(v) => upd({ fill: v }, true)} onCommit={(v) => upd({ fill: v })} />
          <ColorField label={t('枠線')} value={node.stroke} placeholder={rs.stroke} allowNone onLive={(v) => upd({ stroke: v }, true)} onCommit={(v) => upd({ stroke: v })} />
          <NumField label={t('枠線の太さ')} value={node.strokeWidth} placeholder={String(rs.strokeWidth)} step={0.5} min={0} onCommit={(v) => upd({ strokeWidth: v })} />
          <SelectField
            label={t('枠線の種類')}
            value={node.dash ?? 'solid'}
            options={[
              { value: 'solid', label: t('実線') },
              { value: 'dashed', label: t('破線') },
              { value: 'dotted', label: t('点線') },
            ]}
            onCommit={(v) => upd({ dash: v === 'solid' ? undefined : v })}
          />
        </>
      )}
      {node.type === 'junction' && (
        <ColorField label={t('色')} value={node.fill} placeholder={rs.fill} onLive={(v) => upd({ fill: v }, true)} onCommit={(v) => upd({ fill: v })} />
      )}
      <ColorField label={t('文字色')} value={node.color} placeholder={rs.color} onLive={(v) => upd({ color: v }, true)} onCommit={(v) => upd({ color: v })} />
      <NumField label={t('文字サイズ')} value={node.fontSize} placeholder={String(rs.fontSize)} min={1} onCommit={(v) => upd({ fontSize: v })} />
      <div className="btn-row">
        <button className="btn" onClick={() => useStore.getState().duplicateSelection()}>
          複製
        </button>
        <button
          className="btn"
          onClick={() => upd({ fill: undefined, stroke: undefined, color: undefined, fontSize: undefined, strokeWidth: undefined, radius: undefined })}
        >
          個別スタイルを解除
        </button>
        <button className="btn danger" onClick={() => useStore.getState().deleteSelection()}>
          {t('削除')}
        </button>
      </div>
      <p className="muted">
        接続を作るには、ノードにカーソルを合わせて現れる青い○（ポート）から別のノードへドラッグします。
      </p>
    </div>
  );
}

export function NumFieldInline({
  value,
  onCommit,
  placeholder,
  step = 1,
  min,
}: {
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  placeholder?: string;
  step?: number;
  min?: number;
}) {
  const p = useNumInput(value, onCommit, placeholder, step, min);
  return <input type="number" {...p} style={{ width: '100%', height: 28, padding: '3px 7px', border: '1px solid var(--border)', borderRadius: 6 }} />;
}

// ---------------------------------------------------------------- edge

function EdgeInspector({ edge }: { edge: DEdge }) {
  const t = useT();
  const diagram = useStore((s) => s.diagram);
  const style = diagram.style;
  const upd = (patch: Partial<DEdge>, live?: boolean) => useStore.getState().updateEdge(edge.id, patch, live);
  const nodeOpts = diagram.nodes.map((n) => ({ value: n.id, label: n.id + (n.label ? ` (${n.label.split('\n')[0]})` : '') }));
  const sideOpts: { value: Side | 'auto'; label: string }[] = [
    { value: 'auto', label: t('自動') },
    ...SIDES.map((s) => ({ value: s, label: t(SIDE_LABELS[s]) })),
  ];
  return (
    <div className="inspector">
      <h3>{t('接続線 {id}', { id: edge.id })}</h3>
      <SelectField label={t('接続元')} value={edge.from} options={nodeOpts} onCommit={(v) => upd({ from: v })} />
      <SelectField label={t('接続元の辺')} value={edge.fromSide ?? 'auto'} options={sideOpts} onCommit={(v) => upd({ fromSide: v === 'auto' ? undefined : v })} />
      <SelectField label={t('接続先')} value={edge.to} options={nodeOpts} onCommit={(v) => upd({ to: v })} />
      <SelectField label={t('接続先の辺')} value={edge.toSide ?? 'auto'} options={sideOpts} onCommit={(v) => upd({ toSide: v === 'auto' ? undefined : v })} />
      <div className="btn-row">
        <button
          className="btn"
          onClick={() =>
            upd({ from: edge.to, to: edge.from, fromSide: edge.toSide, toSide: edge.fromSide, waypoints: [...edge.waypoints].reverse() })
          }
        >
          ⇄ 向きを反転
        </button>
      </div>
      <h3>{t('ラベル')}</h3>
      <TextField label={t('ラベル')} value={edge.label ?? ''} placeholder={t('例: $u(t)$')} onCommit={(v) => upd({ label: v || undefined })} />
      {edge.labelOffset && (
        <div className="btn-row">
          <button className="btn" onClick={() => upd({ labelOffset: undefined })}>
            ラベル位置をリセット
          </button>
        </div>
      )}
      <TextField label={t('符号 (sign)')} value={edge.sign ?? ''} placeholder={t('+ / - (加算点用)')} onCommit={(v) => upd({ sign: v || undefined })} />
      <NumField label={t('文字サイズ')} value={edge.fontSize} placeholder={String(edgeTextDefaults(style).fontSize)} min={1} onCommit={(v) => upd({ fontSize: v })} />
      <h3>{t('線')}</h3>
      <SelectField
        label={t('矢印')}
        value={edge.arrow ?? 'default'}
        options={[{ value: 'default', label: t('既定 ({v})', { v: t(ARROW_LABELS[style.arrow]) }) }, ...ARROW_KINDS.map((a) => ({ value: a, label: t(ARROW_LABELS[a]) }))]}
        onCommit={(v) => upd({ arrow: v === 'default' ? undefined : (v as DEdge['arrow']) })}
      />
      <SelectField
        label={t('線種')}
        value={edge.dash ?? 'solid'}
        options={[
          { value: 'solid', label: t('実線') },
          { value: 'dashed', label: t('破線') },
          { value: 'dotted', label: t('点線') },
        ]}
        onCommit={(v) => upd({ dash: v === 'solid' ? undefined : v })}
      />
      <NumField label={t('太さ')} value={edge.width} placeholder={String(style.lineWidth)} step={0.5} min={0} onCommit={(v) => upd({ width: v })} />
      <ColorField label={t('色')} value={edge.color} placeholder={style.lineColor} onLive={(v) => upd({ color: v }, true)} onCommit={(v) => upd({ color: v })} />
      <h3>{t('経路')}</h3>
      <SelectField
        label={t('ルーティング')}
        value={edge.route}
        options={[
          { value: 'auto', label: t('直交 (自動)') },
          { value: 'straight', label: t('直線') },
        ]}
        onCommit={(v) => upd({ route: v })}
      />
      {edge.waypoints.length > 0 ? (
        <>
          <div className="muted">{t('経由点 (via)')}</div>
          {edge.waypoints.map((p, i) => (
            <div className="waypoint-row" key={i}>
              <input
                type="number"
                value={p.x}
                onChange={(e) => {
                  const w = edge.waypoints.map((q) => ({ ...q }));
                  w[i].x = Number(e.target.value);
                  upd({ waypoints: w }, true);
                }}
                onBlur={() => useStore.getState().commit()}
              />
              <input
                type="number"
                value={p.y}
                onChange={(e) => {
                  const w = edge.waypoints.map((q) => ({ ...q }));
                  w[i].y = Number(e.target.value);
                  upd({ waypoints: w }, true);
                }}
                onBlur={() => useStore.getState().commit()}
              />
              <button className="btn clear" title={t('削除')} onClick={() => upd({ waypoints: edge.waypoints.filter((_, k) => k !== i) })}>
                ×
              </button>
            </div>
          ))}
          <div className="btn-row">
            <button className="btn" onClick={() => upd({ waypoints: [] })}>
              経由点をすべて削除 (自動配線に戻す)
            </button>
          </div>
        </>
      ) : (
        <p className="muted">{t('線を選択すると現れる○ハンドルをドラッグすると経由点を追加できます。経由点はダブルクリックで削除。')}</p>
      )}
      <div className="btn-row">
        <button
          className="btn"
          onClick={() => useStore.getState().insertJunctionOnEdge(edge.id)}
          title={t('この線の中央に分岐点を挿入して 2 本に分けます（線をダブルクリックすると好きな位置に挿入できます）')}
        >
          ● 分岐点を挿入
        </button>
        <button className="btn danger" onClick={() => useStore.getState().deleteSelection()}>
          接続線を削除
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- multi

function MultiInspector({ ids }: { ids: string[] }) {
  const t = useT();
  const diagram = useStore((s) => s.diagram);
  const align = (mode: AlignMode) => useStore.getState().alignSelection(mode);
  const distribute = (axis: 'x' | 'y') => useStore.getState().distributeSelection(axis);
  const sameSize = () => useStore.getState().sameSizeSelection();
  const setAll = (patch: Partial<DNode>, live?: boolean) => {
    const fn = (d: DNode['type'] extends never ? never : any) => {
      for (const n of d.nodes) if (ids.includes(n.id)) Object.assign(n, patch);
    };
    if (live) useStore.getState().liveUpdate(fn);
    else useStore.getState().commit(fn);
  };
  return (
    <div className="inspector">
      <h3>{t('{n} 個のノードを選択中', { n: ids.length })}</h3>
      <div className="muted">{t('整列')}</div>
      <div className="btn-row">
        <button className="btn" onClick={() => align('left')}>
          左揃え
        </button>
        <button className="btn" onClick={() => align('hcenter')}>
          左右中央
        </button>
        <button className="btn" onClick={() => align('right')}>
          右揃え
        </button>
        <button className="btn" onClick={() => align('top')}>
          上揃え
        </button>
        <button className="btn" onClick={() => align('vcenter')}>
          上下中央
        </button>
        <button className="btn" onClick={() => align('bottom')}>
          下揃え
        </button>
      </div>
      <div className="muted">{t('等間隔配置 / サイズ')}</div>
      <div className="btn-row">
        <button className="btn" onClick={() => distribute('x')} disabled={ids.length < 3}>
          横に等間隔
        </button>
        <button className="btn" onClick={() => distribute('y')} disabled={ids.length < 3}>
          縦に等間隔
        </button>
        <button className="btn" onClick={sameSize}>
          サイズを揃える
        </button>
      </div>
      <h3>{t('一括スタイル')}</h3>
      <ColorField label={t('塗り')} value={undefined} onLive={(v) => setAll({ fill: v }, true)} onCommit={(v) => setAll({ fill: v })} allowNone />
      <ColorField label={t('枠線')} value={undefined} onLive={(v) => setAll({ stroke: v }, true)} onCommit={(v) => setAll({ stroke: v })} />
      <ColorField label={t('文字色')} value={undefined} onLive={(v) => setAll({ color: v }, true)} onCommit={(v) => setAll({ color: v })} />
      <NumField label={t('文字サイズ')} value={undefined} onCommit={(v) => setAll({ fontSize: v })} />
      <div className="btn-row">
        <button className="btn" onClick={() => useStore.getState().duplicateSelection()}>
          複製
        </button>
        <button className="btn danger" onClick={() => useStore.getState().deleteSelection()}>
          {t('削除')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- global style

function StylePanel() {
  const t = useT();
  const style = useStore((s) => s.diagram.style);
  const upd = (patch: Partial<DStyle>, live?: boolean) => useStore.getState().updateStyle(patch, live);
  const clearOverrides = () => {
    useStore.getState().commit((d) => {
      for (const n of d.nodes) {
        delete n.fill;
        delete n.stroke;
        delete n.color;
        delete n.fontSize;
        delete n.strokeWidth;
        delete n.radius;
      }
      for (const e of d.edges) {
        delete e.color;
        delete e.width;
        delete e.dash;
        delete e.fontSize;
        delete e.arrow;
      }
    });
  };
  const resetSizes = () => {
    useStore.getState().commit((d) => {
      for (const n of d.nodes) {
        if (n.type !== 'text') {
          delete n.w;
          delete n.h;
        }
      }
    });
  };
  return (
    <div className="inspector">
      <h3>{t('全体スタイル（一括変更）')}</h3>
      <p className="muted">{t('ここでの変更は図全体に適用され、コードの style ブロックに反映されます。図形の種類ごとの既定値（円だけ大きく、など）は左のパレットの各図形の ▸ から設定できます。')}</p>
      <SelectField
        label={t('フォント')}
        value={FONT_PRESETS.some((f) => f.value === style.font) ? style.font : 'custom'}
        options={[...FONT_PRESETS, { value: 'custom', label: t('カスタム…') }]}
        onCommit={(v) => {
          if (v !== 'custom') upd({ font: v });
        }}
      />
      <TextField label={t('フォント指定')} value={style.font} mono onCommit={(v) => upd({ font: v || DEFAULT_STYLE.font })} />
      <NumField label={t('文字サイズ')} value={style.fontSize} min={1} onCommit={(v) => upd({ fontSize: v ?? DEFAULT_STYLE.fontSize })} />
      <ColorField label={t('文字色')} value={style.textColor} onLive={(v) => upd({ textColor: v }, true)} onCommit={(v) => upd({ textColor: v ?? DEFAULT_STYLE.textColor })} />
      <h3>{t('線・矢印')}</h3>
      <NumField label={t('線の太さ')} value={style.lineWidth} step={0.5} min={0} onCommit={(v) => upd({ lineWidth: v ?? DEFAULT_STYLE.lineWidth })} />
      <ColorField label={t('線の色')} value={style.lineColor} onLive={(v) => upd({ lineColor: v }, true)} onCommit={(v) => upd({ lineColor: v ?? DEFAULT_STYLE.lineColor })} />
      <SelectField
        label={t('矢印の形')}
        value={style.arrow}
        options={ARROW_KINDS.filter((a) => a !== 'both').map((a) => ({ value: a, label: t(ARROW_LABELS[a]) }))}
        onCommit={(v) => upd({ arrow: v })}
      />
      <NumField label={t('矢印サイズ')} value={style.arrowSize} min={1} onCommit={(v) => upd({ arrowSize: v ?? DEFAULT_STYLE.arrowSize })} />
      <h3>{t('ブロック')}</h3>
      <div className="field">
        <label>{t('既定サイズ')}</label>
        <div className="pair">
          <NumFieldInline value={style.blockWidth} onCommit={(v) => upd({ blockWidth: v ?? DEFAULT_STYLE.blockWidth })} />
          <NumFieldInline value={style.blockHeight} onCommit={(v) => upd({ blockHeight: v ?? DEFAULT_STYLE.blockHeight })} />
        </div>
      </div>
      <ColorField label={t('塗り')} value={style.blockFill} allowNone onLive={(v) => upd({ blockFill: v }, true)} onCommit={(v) => upd({ blockFill: v ?? DEFAULT_STYLE.blockFill })} />
      <ColorField label={t('枠線')} value={style.blockStroke} onLive={(v) => upd({ blockStroke: v }, true)} onCommit={(v) => upd({ blockStroke: v ?? DEFAULT_STYLE.blockStroke })} />
      <NumField label={t('角丸半径')} value={style.cornerRadius} min={0} onCommit={(v) => upd({ cornerRadius: v ?? 0 })} />
      <NumField label={t('加算点の半径')} value={style.sumRadius} min={1} onCommit={(v) => upd({ sumRadius: v ?? DEFAULT_STYLE.sumRadius })} />
      <NumField label={t('分岐点の半径')} value={style.junctionRadius} min={0.5} step={0.5} onCommit={(v) => upd({ junctionRadius: v ?? DEFAULT_STYLE.junctionRadius })} />
      <SelectField
        label={t('分岐点の表示')}
        value={style.junctionStyle}
        options={[
          { value: 'dot', label: t('点を描く') },
          { value: 'none', label: t('点なし（線のみで分岐）') },
        ]}
        onCommit={(v) => upd({ junctionStyle: v })}
      />
      <h3>{t('キャンバス / 出力')}</h3>
      <label className="check" title={t('OFF のときは白背景で出力します。設定はコードの background に保存されます')}>
        <input
          type="checkbox"
          checked={style.background === 'transparent' || style.background === 'none'}
          onChange={(e) => upd({ background: e.target.checked ? 'transparent' : '#ffffff' })}
        />
        {t('背景を透明にする')}
      </label>
      <ColorField
        label={t('背景')}
        value={style.background === 'transparent' ? undefined : style.background}
        placeholder="transparent"
        onLive={(v) => upd({ background: v }, true)}
        onCommit={(v) => upd({ background: v ?? 'transparent' })}
      />
      <NumField label={t('余白 (export)')} value={style.padding} min={0} onCommit={(v) => upd({ padding: v ?? DEFAULT_STYLE.padding })} />
      <NumField label={t('グリッド間隔')} value={style.grid} min={1} onCommit={(v) => upd({ grid: v ?? DEFAULT_STYLE.grid })} />
      <div className="btn-row">
        <button className="btn" onClick={clearOverrides} title={t('ノード・線の個別スタイル (色・太さ・文字サイズ) をすべて解除し、全体スタイルに統一します')}>
          個別スタイルをすべて解除
        </button>
        <button className="btn" onClick={resetSizes} title={t('ブロックの個別サイズを解除して既定サイズに統一します')}>
          サイズを既定に統一
        </button>
      </div>
      <h3>{t('操作ガイド')}</h3>
      <ul className="help-list">
        {HELP_ITEMS.map((h, i) => (
          <li key={i}>{t(h)}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- root

export function Inspector() {
  const sel = useStore((s) => s.selection);
  const diagram = useStore((s) => s.diagram);
  if (sel.nodes.length === 1 && sel.edges.length === 0) {
    const node = diagram.nodes.find((n) => n.id === sel.nodes[0]);
    if (node) return <NodeInspector key={node.id} node={node} />;
  }
  if (sel.edges.length === 1 && sel.nodes.length === 0) {
    const edge = diagram.edges.find((e) => e.id === sel.edges[0]);
    if (edge) return <EdgeInspector key={edge.id} edge={edge} />;
  }
  if (sel.nodes.length > 1) return <MultiInspector ids={sel.nodes} />;
  return <StylePanel />;
}
