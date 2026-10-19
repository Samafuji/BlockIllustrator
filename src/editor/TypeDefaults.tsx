import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { NodeType, TYPE_DEFAULT_KEYS, TypeDefaults, resolveNode } from '../model/types';
import { useStore } from '../store/useStore';
import { canvasApi } from './canvasApi';
import { ColorField, NumField, NumFieldInline, SelectField } from './Inspector';

/** Palette entries (labels are Japanese dictionary keys, translated at render time). */
export const PALETTE_ITEMS: { type: NodeType; label: string; icon: string }[] = [
  { type: 'block', label: 'ブロック', icon: '▭' },
  { type: 'rounded', label: '角丸', icon: '▢' },
  { type: 'sum', label: '加算点', icon: '⊕' },
  { type: 'junction', label: '分岐点', icon: '●' },
  { type: 'gain', label: 'ゲイン', icon: '▷' },
  { type: 'circle', label: '円', icon: '○' },
  { type: 'diamond', label: 'ひし形', icon: '◇' },
  { type: 'text', label: 'テキスト', icon: 'T' },
];

/**
 * Per-type default appearance editor. Values are stored in the diagram style
 * (`style { circle: size (60, 60) fill #eef }`), so every node of that type
 * without an explicit override follows them automatically.
 */
export function TypeDefaultsPanel({ type, label }: { type: NodeType; label: string }) {
  const t = useT();
  const style = useStore((s) => s.diagram.style);
  const nodes = useStore((s) => s.diagram.nodes);
  const d: TypeDefaults = style.defaults[type] ?? {};
  // values that apply when no type default is set (placeholders)
  const base = resolveNode({ id: '_', type, label: '', x: 0, y: 0 }, { ...style, defaults: { ...style.defaults, [type]: {} } });

  const upd = (patch: Partial<TypeDefaults>, live?: boolean) => {
    const next: TypeDefaults = { ...d, ...patch };
    for (const k of Object.keys(patch) as (keyof TypeDefaults)[]) if (patch[k] === undefined) delete next[k];
    useStore.getState().updateStyle({ defaults: { ...style.defaults, [type]: next } }, live);
  };
  const edges = useStore((s) => s.diagram.edges);
  const ofType = nodes.filter((n) => n.type === type);
  const labeledEdges = type === 'text' ? edges.filter((e) => e.label || e.sign) : [];
  const overriddenEdges = labeledEdges.filter((e) => e.fontSize !== undefined || e.color !== undefined).length;
  const overridden = ofType.filter((n) => TYPE_DEFAULT_KEYS.some((k) => (n as any)[k] !== undefined)).length + overriddenEdges;
  const clearOverrides = () => {
    useStore.getState().commit((dd) => {
      for (const n of dd.nodes) {
        if (n.type !== type) continue;
        for (const k of TYPE_DEFAULT_KEYS) delete (n as any)[k];
      }
      if (type === 'text') {
        for (const e of dd.edges) {
          delete e.fontSize;
          delete e.color;
        }
      }
    });
  };
  const resetDefaults = () => {
    const nd = { ...style.defaults };
    delete nd[type];
    useStore.getState().updateStyle({ defaults: nd });
  };
  const isRound = type === 'sum' || type === 'junction';
  const isShape = type !== 'text' && type !== 'junction';
  const hasDefaults = Object.keys(d).length > 0;

  return (
    <div className="defaults-panel">
      <div className="panel-head">
        <span>{t('{label} の既定値', { label })}</span>
        <span className="muted">
          {t('{n} 個', { n: ofType.length })}
          {type === 'text' && labeledEdges.length > 0 ? ' ' + t('+ 線ラベル {n}', { n: labeledEdges.length }) : ''}
          {overridden > 0 ? t('（個別設定あり {n}）', { n: overridden }) : ''}
        </span>
      </div>
      {isRound ? (
        <NumField label={t('直径')} value={d.w} placeholder={String(base.w)} min={1} onCommit={(v) => upd({ w: v, h: v })} />
      ) : type !== 'text' ? (
        <div className="field">
          <label>{t('サイズ (w, h)')}</label>
          <div className="pair">
            <NumFieldInline value={d.w} placeholder={String(base.w)} onCommit={(v) => upd({ w: v })} />
            <NumFieldInline value={d.h} placeholder={String(base.h)} onCommit={(v) => upd({ h: v })} />
          </div>
        </div>
      ) : null}
      {isShape && (
        <>
          <ColorField label={t('塗り')} value={d.fill} placeholder={base.fill} allowNone onLive={(v) => upd({ fill: v }, true)} onCommit={(v) => upd({ fill: v })} />
          <ColorField label={t('枠線')} value={d.stroke} placeholder={base.stroke} allowNone onLive={(v) => upd({ stroke: v }, true)} onCommit={(v) => upd({ stroke: v })} />
          <NumField label={t('枠線の太さ')} value={d.strokeWidth} placeholder={String(base.strokeWidth)} step={0.5} min={0} onCommit={(v) => upd({ strokeWidth: v })} />
          <SelectField
            label={t('枠線の種類')}
            value={d.dash ?? 'solid'}
            options={[
              { value: 'solid', label: t('実線') },
              { value: 'dashed', label: t('破線') },
              { value: 'dotted', label: t('点線') },
            ]}
            onCommit={(v) => upd({ dash: v === 'solid' ? undefined : v })}
          />
        </>
      )}
      {(type === 'block' || type === 'rounded') && (
        <NumField label={t('角丸半径')} value={d.radius} placeholder={String(base.radius)} min={0} onCommit={(v) => upd({ radius: v })} />
      )}
      {type === 'junction' && (
        <>
          <SelectField
            label={t('点の表示')}
            value={style.junctionStyle}
            options={[
              { value: 'dot', label: t('点を描く') },
              { value: 'none', label: t('点なし（線のみで分岐）') },
            ]}
            onCommit={(v) => useStore.getState().updateStyle({ junctionStyle: v })}
          />
          <ColorField label={t('色')} value={d.fill} placeholder={base.fill} onLive={(v) => upd({ fill: v }, true)} onCommit={(v) => upd({ fill: v })} />
        </>
      )}
      {type === 'text' && (
        <p className="muted" style={{ margin: '2px 0' }}>
          {t('ここでの文字サイズ・文字色は、テキストノードに加えて接続線のラベル・符号にも適用されます（線ごとの個別指定が優先）。')}
        </p>
      )}
      {type === 'sum' && (
        <SelectField
          label={t('表示形式')}
          value={d.sumStyle ?? 'plain'}
          options={[
            { value: 'plain', label: t('円のみ') },
            { value: 'cross', label: t('円 + ×') },
            { value: 'sigma', label: t('円 + Σ') },
          ]}
          onCommit={(v) => upd({ sumStyle: v === 'plain' ? undefined : v })}
        />
      )}
      {type !== 'junction' && (
        <>
          <ColorField label={t('文字色')} value={d.color} placeholder={base.color} onLive={(v) => upd({ color: v }, true)} onCommit={(v) => upd({ color: v })} />
          <NumField label={t('文字サイズ')} value={d.fontSize} placeholder={String(base.fontSize)} min={1} onCommit={(v) => upd({ fontSize: v })} />
        </>
      )}
      <div className="btn-row">
        <button className="btn" onClick={clearOverrides} disabled={overridden === 0} title={t('この種類の図形に付いている個別のサイズ・色などを外し、すべて既定値に揃えます')}>
          {t('個別設定を解除して揃える')}
          {overridden > 0 ? ` (${overridden})` : ''}
        </button>
        <button className="btn" onClick={resetDefaults} disabled={!hasDefaults} title={t('この種類の既定値を削除し、全体スタイルに戻します')}>
          {t('既定値をリセット')}
        </button>
      </div>
      <p className="muted">
        {t('個別設定のない図形は自動で追従します。コードでは')}{' '}
        <code>
          style {'{'} {type}: size (…) fill … {'}'}
        </code>{' '}
        {t('として保存されます。')}
      </p>
    </div>
  );
}

/** One row of the shape palette: click to add, ▸ opens the defaults panel. */
function PaletteItem({ type, label, icon }: { type: NodeType; label: string; icon: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | undefined>(undefined);
  // place the panel next to this row (relative to the palette) and keep it inside the window
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !ref.current) return;
    const rowTop = ref.current.offsetTop;
    const r = panelRef.current.getBoundingClientRect();
    const pal = (ref.current.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    const palTop = pal ? pal.top : 0;
    const overflow = palTop + rowTop + r.height - (window.innerHeight - 8);
    setTop(Math.max(0, rowTop - Math.max(0, overflow)));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const add = () => {
    const st = useStore.getState();
    const c = canvasApi.current?.viewportCenterWorld() ?? { x: 200, y: 150 };
    const g = st.diagram.style.grid || 10;
    st.addNode(type, { x: Math.round(c.x / g) * g, y: Math.round(c.y / g) * g });
    canvasApi.current?.focus();
  };
  const name = t(label);
  return (
    <div className="pal-row" ref={ref}>
      <button className="pal-item" onClick={add} title={t('{label}を追加', { label: name })}>
        <span className="pal-ico">{icon}</span>
        <span className="pal-label">{name}</span>
      </button>
      <button className={'pal-caret' + (open ? ' active' : '')} onClick={() => setOpen(!open)} title={t('{label}の既定値（サイズ・色・文字）を設定', { label: name })}>
        ▸
      </button>
      {open && (
        <div className="menu-list panel side" ref={panelRef} style={{ top }}>
          <TypeDefaultsPanel type={type} label={name} />
        </div>
      )}
    </div>
  );
}

/** Vertical shape palette shown at the left edge of the canvas. */
export function Palette() {
  const t = useT();
  const connectMode = useStore((s) => s.connectMode);
  return (
    <div className="palette">
      <button
        className={'pal-item tool' + (connectMode ? ' active' : '')}
        onClick={() => useStore.getState().setConnectMode(!connectMode)}
        title={t('接続モード (C): ブロックからブロックへドラッグして線を引きます。Esc で終了')}
      >
        <span className="pal-ico">⟶</span>
        <span className="pal-label">{t('接続')}</span>
      </button>
      <div className="pal-sep" />
      {PALETTE_ITEMS.map((it) => (
        <PaletteItem key={it.type} type={it.type} label={it.label} icon={it.icon} />
      ))}
    </div>
  );
}
