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
  ROTATIONS,
  SIDES,
  Side,
  TEXT_ALIGNS,
  TextAlign,
  edgeTextDefaults,
  nodeSize,
  resolveEdgeText,
  resolveNode,
} from '../model/types';
import { AlignMode, MatchWhat, referenceNodeId, useStore } from '../store/useStore';
import { fitNodeToImage, replaceNodeImage } from '../io/images';
import { ColorPopoverButton, toHex } from './ColorPicker';
import { FONT_PRESETS } from './fonts';
import { IcBackward, IcBold, IcForward, IcItalic, IcTextCenter, IcTextLeft, IcTextRight, IcToBack, IcToFront, IcUnderline } from './icons';

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

/** Wrap the selected part of a textarea's text in a markup tag (or insert an empty pair). */
function wrapSelection(el: HTMLTextAreaElement, open: string, close: string): string {
  const v = el.value;
  const a = el.selectionStart ?? v.length;
  const b = el.selectionEnd ?? a;
  const inner = v.slice(a, b);
  const next = v.slice(0, a) + open + inner + close + v.slice(b);
  window.setTimeout(() => {
    el.focus();
    el.setSelectionRange(a + open.length, a + open.length + inner.length);
  }, 0);
  return next;
}

/**
 * Multi-line label editor with buttons that format only the selected part of the
 * text (inline tags: <b> <i> <u> <small> <big> <color #hex>). Whole-label style
 * (bold for everything) is set on the node instead.
 */
export function MarkupTextField({
  label,
  value,
  onCommit,
  placeholder,
  focusKey,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  focusKey?: number;
}) {
  const t = useT();
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
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
  const wrap = (open: string, close: string) => {
    const el = ref.current;
    if (!el) return;
    const next = wrapSelection(el, open, close);
    setV(next);
    onCommit(next);
  };
  return (
    <div className="field">
      <label>{label}</label>
      <div>
        <div className="markup-tools" title={t('文字の一部を選択してから押すと、その部分だけに適用されます')}>
          <button type="button" className="btn icon" title={t('選択部分を太字')} onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('<b>', '</b>')}>
            <IcBold size={14} />
          </button>
          <button type="button" className="btn icon" title={t('選択部分を斜体')} onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('<i>', '</i>')}>
            <IcItalic size={14} />
          </button>
          <button type="button" className="btn icon" title={t('選択部分に下線')} onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('<u>', '</u>')}>
            <IcUnderline size={14} />
          </button>
          <button type="button" className="btn icon txt" title={t('選択部分を小さく')} onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('<small>', '</small>')}>
            <small>A</small>
          </button>
          <button type="button" className="btn icon txt" title={t('選択部分を大きく')} onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('<big>', '</big>')}>
            A
          </button>
          <ColorPopoverButton title={t('選択部分の色')} onPick={(c) => wrap(`<color ${c ?? '#000000'}>`, '</color>')}>
            <span className="txt">A</span>
            <span className="swatch-cur" style={{ background: 'linear-gradient(90deg,#d0353c,#f1c40f,#27ae60,#2b7de9)' }} />
          </ColorPopoverButton>
          <button type="button" className="btn icon txt" title={t('数式 $...$')} onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('$', '$')}>
            ∑
          </button>
        </div>
        <textarea
          ref={ref}
          value={v}
          placeholder={placeholder}
          onChange={(e) => setV(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault();
              commit();
              (e.target as HTMLElement).blur();
            }
            if (e.key === 'Escape') {
              setV(value);
              (e.target as HTMLElement).blur();
            }
          }}
        />
      </div>
    </div>
  );
}

/** Bold / italic / underline toggles and line alignment for a node or a line label. */
function TextStyleRow({
  bold,
  italic,
  underline,
  align,
  onToggle,
  onAlign,
}: {
  bold: boolean;
  italic: boolean;
  underline?: boolean;
  align: TextAlign;
  onToggle: (k: 'bold' | 'italic' | 'underline') => void;
  onAlign: (a: TextAlign) => void;
}) {
  const t = useT();
  return (
    <div className="field">
      <label>{t('文字スタイル')}</label>
      <div className="row">
        <div className="btn-group">
          <button type="button" className={'btn icon' + (bold ? ' active' : '')} title={t('太字') + ' (Ctrl+B)'} onClick={() => onToggle('bold')}>
            <IcBold />
          </button>
          <button type="button" className={'btn icon' + (italic ? ' active' : '')} title={t('斜体') + ' (Ctrl+I)'} onClick={() => onToggle('italic')}>
            <IcItalic />
          </button>
          {underline !== undefined && (
            <button type="button" className={'btn icon' + (underline ? ' active' : '')} title={t('下線') + ' (Ctrl+U)'} onClick={() => onToggle('underline')}>
              <IcUnderline />
            </button>
          )}
        </div>
        <div className="btn-group">
          {TEXT_ALIGNS.map((a) => (
            <button
              key={a}
              type="button"
              className={'btn icon' + (align === a ? ' active' : '')}
              title={a === 'left' ? t('文字を左揃え') : a === 'center' ? t('文字を中央揃え') : t('文字を右揃え')}
              onClick={() => onAlign(a)}
            >
              {a === 'left' ? <IcTextLeft /> : a === 'center' ? <IcTextCenter /> : <IcTextRight />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Drawing order of the selection (the order of the statements in the code). */
function ZOrderRow() {
  const t = useT();
  const go = (how: 'front' | 'back' | 'forward' | 'backward') => useStore.getState().reorderSelection(how);
  return (
    <div className="field">
      <label>{t('重なり順')}</label>
      <div className="btn-group">
        <button type="button" className="btn icon" title={t('最前面へ') + ' (Ctrl+Shift+])'} onClick={() => go('front')}>
          <IcToFront />
        </button>
        <button type="button" className="btn icon" title={t('前面へ（一段）') + ' (Ctrl+])'} onClick={() => go('forward')}>
          <IcForward />
        </button>
        <button type="button" className="btn icon" title={t('背面へ（一段）') + ' (Ctrl+[)'} onClick={() => go('backward')}>
          <IcBackward />
        </button>
        <button type="button" className="btn icon" title={t('最背面へ') + ' (Ctrl+Shift+[)'} onClick={() => go('back')}>
          <IcToBack />
        </button>
      </div>
    </div>
  );
}

function FontSelect({ value, placeholder, onCommit }: { value: string | undefined; placeholder: string; onCommit: (v: string | undefined) => void }) {
  const t = useT();
  const cur = value ?? 'default';
  const known = cur === 'default' || FONT_PRESETS.some((f) => f.value === cur);
  const base = FONT_PRESETS.find((f) => f.value === placeholder);
  return (
    <SelectField
      label={t('フォント')}
      value={known ? cur : 'custom'}
      options={[
        { value: 'default', label: t('既定 ({v})', { v: base ? t(base.label) : placeholder.split(',')[0] }) },
        ...FONT_PRESETS.map((f) => ({ value: f.value, label: t(f.label) })),
        ...(known ? [] : [{ value: 'custom', label: cur }]),
      ]}
      onCommit={(v) => {
        if (v === 'default') onCommit(undefined);
        else if (v !== 'custom') onCommit(v);
      }}
    />
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
        <ColorPopoverButton
          className="swatch-btn"
          title={t('色を選択（よく使う色）')}
          value={value ?? placeholder}
          allowNone={allowNone}
          allowDefault={value !== undefined}
          onLive={onLive}
          onPick={(c) => onCommit(c)}
        >
          <span className="swatch-cur" style={{ background: value === 'none' || placeholder === 'none' ? '#fff' : toHex(value ?? placeholder) }} />
        </ColorPopoverButton>
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

const HELP_ITEMS: string[] = [
  'ノードをドラッグで移動、角のハンドルでサイズ変更（辺のハンドルで幅・高さだけ変更）',
  '上の書式バー: 整列・サイズ/スタイルを基準に合わせる・既定に戻す・太字/斜体/下線 (Ctrl+B/I/U)・文字揃え・色・90° 回転',
  '複数選択では最後に選択した図形が「基準」（太い枠）。他の図形のサイズやスタイルを基準に揃えられます',
  'ラベルの一部だけ書式を変えるには、ラベル欄で文字を選択して B / I / U / 色のボタンを押します（<b>…</b> などのタグ）',
  '線が交差するところには自動でジャンプ（跨ぎ）が描かれます（全体スタイルのジャンプ半径で調整、0 で無効）',
  '重なり順: 書式バーの最前面/最背面ボタン、または Ctrl+] / Ctrl+[（Shift で最前面 / 最背面）。コードでは後に書いたものが前に描かれます',
  'Alt を押しながらドラッグするとグリッド・整列ガイド・角度のスナップを一時的に解除して自由に動かせます。矢印キーで 1px、Shift+矢印でグリッド単位の微調整',
  'ノード上の青い○ (ポート) から別ノードへドラッグで接続。または「接続」モード (C)',
  '線を選択 → ▬ で区間移動、■ で曲がり角移動、○ で曲がり角追加。線をダブルクリックで分岐点',
  '直線 (straight) の線と曲がり角の区間は 0 / 30 / 45 / 60 / 90° に自動で揃います（Alt で解除）',
  '線ラベルはドラッグで位置調整。クリックで選択、Shift+クリック / 範囲選択でテキストノードと一緒に複数選択して整列できます',
  'Ctrl+Shift+A でテキスト（テキストノード・線ラベル）をすべて選択',
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
            window.alert(t('ID は英字で始まる英数字・_ のみ、かつ重複不可です'));
          }
        }}
      />
      <SelectField
        label={t('種類')}
        value={node.type}
        options={NODE_TYPES.map((ty) => ({ value: ty, label: t(TYPE_LABELS[ty]) }))}
        onCommit={(v) => upd({ type: v })}
      />
      <MarkupTextField
        label={node.type === 'image' ? t('キャプション') : t('ラベル')}
        value={node.label}
        focusKey={focusReq}
        placeholder={t('テキスト。数式は $...$、改行可 (Ctrl+Enter で確定)')}
        onCommit={(v) => upd({ label: v })}
      />
      <TextStyleRow
        bold={rs.bold}
        italic={rs.italic}
        underline={rs.underline}
        align={rs.textAlign}
        onToggle={(k) => {
          const cur = rs[k];
          const def = k === 'underline' ? false : !!(style.defaults[node.type] ?? {})[k];
          upd({ [k]: !cur === def ? undefined : !cur });
        }}
        onAlign={(a) => upd({ textAlign: a === ((style.defaults[node.type] ?? {}).textAlign ?? 'center') ? undefined : a })}
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
      {node.labelOffset && (
        <div className="btn-row">
          <button className="btn" onClick={() => upd({ labelOffset: undefined })}>
            {t('ラベル位置をリセット')}
          </button>
        </div>
      )}
      <p className="muted">{t('選択中はラベルをドラッグして位置を動かせます（図形はそのまま）。')}</p>
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
          {t('左向き (flip)')}
        </label>
      )}
      <SelectField
        label={t('回転')}
        value={String(rs.rotate)}
        options={ROTATIONS.map((r) => ({ value: String(r), label: r === 0 ? t('なし') : `${r}°` }))}
        onCommit={(v) => upd({ rotate: Number(v) === 0 ? undefined : Number(v) })}
      />
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
      <FontSelect value={node.font} placeholder={(style.defaults[node.type] ?? {}).font ?? style.font} onCommit={(v) => upd({ font: v })} />
      <div className="btn-row">
        <button className="btn" onClick={() => useStore.getState().duplicateSelection()}>
          {t('複製')}
        </button>
        <button className="btn" onClick={() => useStore.getState().resetSelection()} title={t('サイズ・色・文字・回転の個別設定をすべて外して既定に戻します')}>
          {t('既定に戻す')}
        </button>
        <button className="btn danger" onClick={() => useStore.getState().deleteSelection()}>
          {t('削除')}
        </button>
      </div>
      <ZOrderRow />
      <p className="muted">{t('接続を作るには、ノードにカーソルを合わせて現れる青い○（ポート）から別のノードへドラッグします。')}</p>
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
  const et = resolveEdgeText(edge, style);
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
          {t('⇄ 向きを反転')}
        </button>
      </div>
      <h3>{t('ラベル')}</h3>
      <TextField label={t('ラベル')} value={edge.label ?? ''} placeholder={t('例: $u(t)$')} onCommit={(v) => upd({ label: v || undefined })} />
      {edge.labelOffset && (
        <div className="btn-row">
          <button className="btn" onClick={() => upd({ labelOffset: undefined })}>
            {t('ラベル位置をリセット')}
          </button>
        </div>
      )}
      <TextField label={t('符号 (sign)')} value={edge.sign ?? ''} placeholder={t('+ / - (加算点用)')} onCommit={(v) => upd({ sign: v || undefined })} />
      <TextStyleRow
        bold={et.bold}
        italic={et.italic}
        align={et.textAlign}
        onToggle={(k) => {
          if (k === 'underline') return;
          const def = !!(style.defaults.text ?? {})[k];
          upd({ [k]: !et[k] === def ? undefined : !et[k] });
        }}
        onAlign={(a) => upd({ textAlign: a === edgeTextDefaults(style).textAlign ? undefined : a })}
      />
      <NumField label={t('文字サイズ')} value={edge.fontSize} placeholder={String(edgeTextDefaults(style).fontSize)} min={1} onCommit={(v) => upd({ fontSize: v })} />
      <FontSelect value={edge.font} placeholder={edgeTextDefaults(style).font} onCommit={(v) => upd({ font: v })} />
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
      <NumField label={t('矢印サイズ')} value={edge.arrowSize} placeholder={String(style.arrowSize)} min={1} onCommit={(v) => upd({ arrowSize: v })} />
      <NumField label={t('太さ')} value={edge.width} placeholder={String(style.lineWidth)} step={0.5} min={0} onCommit={(v) => upd({ width: v })} />
      <ColorField label={t('色')} value={edge.color} placeholder={style.lineColor} onLive={(v) => upd({ color: v }, true)} onCommit={(v) => upd({ color: v })} />
      <SelectField
        label={t('交差のジャンプ')}
        value={edge.jump === undefined ? 'default' : edge.jump ? 'on' : 'off'}
        options={[
          { value: 'default', label: t('全体設定に従う ({v})', { v: style.jumpSize > 0 ? 'ON' : 'OFF' }) },
          { value: 'on', label: t('跨ぐ（この線が上）') },
          { value: 'off', label: t('跨がない') },
        ]}
        onCommit={(v) => upd({ jump: v === 'default' ? undefined : v === 'on' })}
      />
      <p className="muted">{t('後に書いた線が先に書いた線を跨ぎます。ジャンプの大きさは全体スタイルで変えられます。')}</p>
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
              {t('経由点をすべて削除 (自動配線に戻す)')}
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
          {t('● 分岐点を挿入')}
        </button>
        <button className="btn danger" onClick={() => useStore.getState().deleteSelection()}>
          {t('接続線を削除')}
        </button>
      </div>
      <ZOrderRow />
    </div>
  );
}

// ---------------------------------------------------------------- multi

function MultiInspector({ ids, labelIds }: { ids: string[]; labelIds: string[] }) {
  const t = useT();
  const sel = useStore((s) => s.selection);
  const diagram = useStore((s) => s.diagram);
  const style = diagram.style;
  const align = (mode: AlignMode) => useStore.getState().alignSelection(mode);
  const distribute = (axis: 'x' | 'y') => useStore.getState().distributeSelection(axis);
  const total = ids.length + labelIds.length;
  const [refId, setRefId] = useState<string | undefined>(undefined);
  const ref = refId && ids.includes(refId) ? refId : referenceNodeId(sel);
  const refNode = ref ? diagram.nodes.find((n) => n.id === ref) : undefined;
  const refSize = refNode ? nodeSize(refNode, style) : undefined;
  const match = (what: MatchWhat) => useStore.getState().matchSelection(what, ref);
  const setAll = (node: Partial<DNode>, edge?: Partial<DEdge>, live?: boolean) => useStore.getState().updateSelection({ node, edge }, live);
  const shapes = ids.filter((id) => {
    const n = diagram.nodes.find((x) => x.id === id);
    return n && n.type !== 'text' && n.type !== 'junction';
  });
  return (
    <div className="inspector">
      <h3>{labelIds.length > 0 ? t('{n} 個を選択中（ノード {a}・線ラベル {b}）', { n: total, a: ids.length, b: labelIds.length }) : t('{n} 個のノードを選択中', { n: total })}</h3>
      <div className="muted">{t('整列')}</div>
      <div className="btn-row">
        <button className="btn" onClick={() => align('left')}>
          {t('左揃え')}
        </button>
        <button className="btn" onClick={() => align('hcenter')}>
          {t('左右中央')}
        </button>
        <button className="btn" onClick={() => align('right')}>
          {t('右揃え')}
        </button>
        <button className="btn" onClick={() => align('top')}>
          {t('上揃え')}
        </button>
        <button className="btn" onClick={() => align('vcenter')}>
          {t('上下中央')}
        </button>
        <button className="btn" onClick={() => align('bottom')}>
          {t('下揃え')}
        </button>
      </div>
      <div className="muted">{t('等間隔配置')}</div>
      <div className="btn-row">
        <button className="btn" onClick={() => distribute('x')} disabled={total < 3}>
          {t('横に等間隔')}
        </button>
        <button className="btn" onClick={() => distribute('y')} disabled={total < 3}>
          {t('縦に等間隔')}
        </button>
      </div>
      {labelIds.length > 0 && <p className="muted">{t('線ラベルは位置 (offset) を変えて揃えます。ドラッグでまとめて動かすこともできます。')}</p>}
      {ids.length > 0 && (
        <>
          <h3>{t('基準に合わせる')}</h3>
          <SelectField
            label={t('基準の図形')}
            value={ref ?? ''}
            options={ids.map((id) => {
              const n = diagram.nodes.find((x) => x.id === id);
              return { value: id, label: id + (n?.label ? ` (${n.label.split('\n')[0]})` : '') };
            })}
            onCommit={(v) => setRefId(v)}
          />
          <p className="muted">
            {t('既定では最後に選択した図形が基準です（太い枠）。')}
            {refSize && refNode && refNode.type !== 'text' ? ` ${t('サイズ')}: ${Math.round(refSize.w)} × ${Math.round(refSize.h)}` : ''}
          </p>
          <div className="btn-row">
            <button className="btn" onClick={() => match('size')} disabled={ids.length < 2} title={t('他の図形の幅・高さを基準の図形と同じにします')}>
              {t('サイズを揃える')}
            </button>
            <button className="btn" onClick={() => match('style')} disabled={ids.length < 2} title={t('塗り・枠線・太さ・角丸・線種を基準の図形からコピーします')}>
              {t('図形スタイルを揃える')}
            </button>
            <button className="btn" onClick={() => match('text')} disabled={total < 2} title={t('文字色・文字サイズ・太字/斜体・フォント・文字揃えを基準の図形からコピーします')}>
              {t('文字スタイルを揃える')}
            </button>
            <button className="btn" onClick={() => match('all')} disabled={total < 2}>
              {t('すべて揃える')}
            </button>
          </div>
        </>
      )}
      <h3>{t('一括変更')}</h3>
      {shapes.length > 0 && (
        <div className="field">
          <label>{t('サイズ (w, h)')}</label>
          <div className="pair">
            <NumFieldInline value={undefined} placeholder={t('幅')} onCommit={(v) => setAll({ w: v })} />
            <NumFieldInline value={undefined} placeholder={t('高さ')} onCommit={(v) => setAll({ h: v })} />
          </div>
        </div>
      )}
      {shapes.length > 0 && (
        <>
          <ColorField label={t('塗り')} value={undefined} onLive={(v) => setAll({ fill: v }, undefined, true)} onCommit={(v) => setAll({ fill: v })} allowNone />
          <ColorField label={t('枠線')} value={undefined} onLive={(v) => setAll({ stroke: v }, undefined, true)} onCommit={(v) => setAll({ stroke: v })} />
          <NumField label={t('枠線の太さ')} value={undefined} placeholder={String(style.lineWidth)} step={0.5} min={0} onCommit={(v) => setAll({ strokeWidth: v })} />
          <NumField label={t('角丸半径')} value={undefined} placeholder={String(style.cornerRadius)} min={0} onCommit={(v) => setAll({ radius: v })} />
        </>
      )}
      {ids.length > 0 && <ColorField label={t('文字色')} value={undefined} onLive={(v) => setAll({ color: v }, undefined, true)} onCommit={(v) => setAll({ color: v })} />}
      <NumField label={t('文字サイズ')} value={undefined} placeholder={String(style.fontSize)} min={1} onCommit={(v) => setAll({ fontSize: v }, { fontSize: v })} />
      <FontSelect value={undefined} placeholder={style.font} onCommit={(v) => setAll({ font: v }, { font: v })} />
      <TextStyleRow
        bold={!!refNode && resolveNode(refNode, style).bold}
        italic={!!refNode && resolveNode(refNode, style).italic}
        underline={ids.length > 0 ? !!refNode && resolveNode(refNode, style).underline : undefined}
        align={refNode ? resolveNode(refNode, style).textAlign : 'center'}
        onToggle={(k) => useStore.getState().toggleTextStyle(k)}
        onAlign={(a) => setAll({ textAlign: a === 'center' ? undefined : a }, { textAlign: a === 'center' ? undefined : a })}
      />
      <div className="btn-row">
        {ids.length > 0 && (
          <>
            <button className="btn" onClick={() => useStore.getState().rotateSelection(-90)} title={t('左に 90° 回転')}>
              ↺ 90°
            </button>
            <button className="btn" onClick={() => useStore.getState().rotateSelection(90)} title={t('右に 90° 回転')}>
              ↻ 90°
            </button>
            <button className="btn" onClick={() => useStore.getState().duplicateSelection()}>
              {t('複製')}
            </button>
          </>
        )}
        <button className="btn" onClick={() => useStore.getState().resetSelection()} title={t('サイズ・色・文字・回転の個別設定をすべて外して既定に戻します')}>
          {t('既定に戻す')}
        </button>
        <button className="btn danger" onClick={() => useStore.getState().deleteSelection()} title={labelIds.length > 0 ? t('選択した線ラベルは文字が消えます（線は残ります）') : undefined}>
          {t('削除')}
        </button>
      </div>
      <ZOrderRow />
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
        options={[...FONT_PRESETS.map((f) => ({ value: f.value, label: t(f.label) })), { value: 'custom', label: t('カスタム…') }]}
        onCommit={(v) => {
          if (v !== 'custom') upd({ font: v });
        }}
      />
      <TextField label={t('フォント指定')} value={style.font} mono onCommit={(v) => upd({ font: v || DEFAULT_STYLE.font })} />
      <NumField
        label={t('文字サイズ')}
        value={style.fontSize}
        min={1}
        onCommit={(v) => {
          // All text that is still "at default" follows this value: per-type font-size
          // defaults are dropped so blocks, text nodes and line labels end up the same size.
          // Font sizes set on individual nodes / lines are left untouched.
          const next = v ?? DEFAULT_STYLE.fontSize;
          useStore.getState().commit(
            (d) => {
              d.style.fontSize = next;
              for (const ty of Object.keys(d.style.defaults) as NodeType[]) delete d.style.defaults[ty]?.fontSize;
            },
            { coalesce: 'style:fontSize' },
          );
        }}
      />
      <p className="muted" style={{ marginTop: -2 }}>
        {t('既定値のままの文字（ブロック・テキスト・線ラベル）はすべてこのサイズになります。個別に指定した文字サイズはそのままです。')}
      </p>
      <div className="btn-row">
        <button
          className="btn"
          title={t('種類ごとの既定値・ノード・線ラベルに付いた個別の文字サイズをすべて外し、全体の文字サイズに統一します')}
          onClick={() =>
            useStore.getState().commit((d) => {
              for (const ty of Object.keys(d.style.defaults) as NodeType[]) delete d.style.defaults[ty]?.fontSize;
              for (const n of d.nodes) delete n.fontSize;
              for (const e of d.edges) delete e.fontSize;
            })
          }
        >
          {t('文字サイズを全体の値に統一')}
        </button>
      </div>
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
      <NumField
        label={t('交差のジャンプ')}
        value={style.jumpSize}
        min={0}
        step={1}
        placeholder="0"
        onCommit={(v) => upd({ jumpSize: v ?? 0 })}
      />
      <p className="muted" style={{ marginTop: -2 }}>
        {t('線が交差する所に描くジャンプ（跨ぎ）の半径。0 で無効。後に書いた線が先の線を跨ぎます。')}
      </p>
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
          {t('個別スタイルをすべて解除')}
        </button>
        <button className="btn" onClick={resetSizes} title={t('ブロックの個別サイズを解除して既定サイズに統一します')}>
          {t('サイズを既定に統一')}
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
  if (sel.nodes.length === 1 && sel.edges.length === 0 && sel.labels.length === 0) {
    const node = diagram.nodes.find((n) => n.id === sel.nodes[0]);
    if (node) return <NodeInspector key={node.id} node={node} />;
  }
  // a single connection, or the label of a single connection: edit that connection
  const edgeId = sel.nodes.length === 0 && sel.edges.length + sel.labels.length === 1 ? sel.edges[0] ?? sel.labels[0] : undefined;
  if (edgeId) {
    const edge = diagram.edges.find((e) => e.id === edgeId);
    if (edge) return <EdgeInspector key={edge.id} edge={edge} />;
  }
  if (sel.nodes.length + sel.labels.length > 1) return <MultiInspector ids={sel.nodes} labelIds={sel.labels} />;
  return <StylePanel />;
}
