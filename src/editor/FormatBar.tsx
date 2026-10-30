import React from 'react';
import { useT } from '../i18n';
import { TextAlign, resolveEdgeText, resolveNode } from '../model/types';
import { AlignMode, referenceNodeId, useStore } from '../store/useStore';
import { ColorPopoverButton } from './ColorPicker';
import { FONT_PRESETS } from './fonts';
import {
  IcAlignBottom,
  IcAlignHCenter,
  IcAlignLeft,
  IcAlignRight,
  IcAlignTop,
  IcAlignVCenter,
  IcBold,
  IcDistributeH,
  IcDistributeV,
  IcFillColor,
  IcFontLarger,
  IcFontSmaller,
  IcItalic,
  IcLineColor,
  IcMatchStyle,
  IcReset,
  IcRotateLeft,
  IcRotateRight,
  IcSameSize,
  IcTextCenter,
  IcTextColor,
  IcTextLeft,
  IcTextRight,
  IcUnderline,
} from './icons';

function IconBtn({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={'btn icon' + (active ? ' active' : '')} title={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/**
 * Icon toolbar under the main one: alignment, size / style matching, text style,
 * colors and rotation for whatever is selected (nodes, lines, line labels).
 */
export function FormatBar() {
  const t = useT();
  const sel = useStore((s) => s.selection);
  const diagram = useStore((s) => s.diagram);
  const st = useStore.getState;
  const nNodes = sel.nodes.length;
  const nItems = nNodes + sel.labels.length;
  const anything = nItems + sel.edges.length > 0;
  const textish = nItems + sel.edges.length > 0;
  const ref = referenceNodeId(sel);
  const refNode = ref ? diagram.nodes.find((n) => n.id === ref) : undefined;

  // current state (for the toggle buttons / fields): the reference node, or the single line
  const node = refNode;
  const edgeId = sel.edges[0] ?? sel.labels[0];
  const edge = edgeId ? diagram.edges.find((e) => e.id === edgeId) : undefined;
  const rs = node ? resolveNode(node, diagram.style) : undefined;
  const et = !node && edge ? resolveEdgeText(edge, diagram.style) : undefined;
  const bold = rs?.bold ?? et?.bold ?? false;
  const italic = rs?.italic ?? et?.italic ?? false;
  const underline = rs?.underline ?? false;
  const textAlign: TextAlign | undefined = rs?.textAlign ?? et?.textAlign;
  const fontSize = rs?.fontSize ?? et?.fontSize;
  const font = rs?.font ?? et?.font ?? diagram.style.font;
  const fontValue = FONT_PRESETS.some((f) => f.value === font) ? font : 'custom';
  const textColor = rs?.color ?? diagram.style.textColor;
  const fill = rs?.fill ?? diagram.style.blockFill;
  const lineColor = edge?.color ?? diagram.style.lineColor;
  const canShapeStyle = nNodes > 0;

  const align = (m: AlignMode) => st().alignSelection(m);
  const setText = (patch: { fontSize?: number; font?: string; textAlign?: TextAlign }) =>
    st().updateSelection({ node: patch, edge: patch });
  const stepFont = (dir: 1 | -1) => {
    const base = fontSize ?? diagram.style.fontSize;
    const next = Math.max(4, Math.round(base + dir * (base >= 20 ? 2 : 1)));
    setText({ fontSize: next });
  };
  const setAlign = (a: TextAlign) => setText({ textAlign: a === 'center' ? undefined : a });

  return (
    <div className="formatbar">
      <div className="btn-group" title={t('整列 (2 つ以上選択)')}>
        <IconBtn title={t('左揃え') + ' (Alt+A)'} onClick={() => align('left')} disabled={nItems < 2}>
          <IcAlignLeft />
        </IconBtn>
        <IconBtn title={t('左右中央揃え') + ' (Alt+H)'} onClick={() => align('hcenter')} disabled={nItems < 2}>
          <IcAlignHCenter />
        </IconBtn>
        <IconBtn title={t('右揃え') + ' (Alt+D)'} onClick={() => align('right')} disabled={nItems < 2}>
          <IcAlignRight />
        </IconBtn>
        <IconBtn title={t('上揃え') + ' (Alt+W)'} onClick={() => align('top')} disabled={nItems < 2}>
          <IcAlignTop />
        </IconBtn>
        <IconBtn title={t('上下中央揃え') + ' (Alt+V)'} onClick={() => align('vcenter')} disabled={nItems < 2}>
          <IcAlignVCenter />
        </IconBtn>
        <IconBtn title={t('下揃え') + ' (Alt+S)'} onClick={() => align('bottom')} disabled={nItems < 2}>
          <IcAlignBottom />
        </IconBtn>
      </div>
      <div className="btn-group">
        <IconBtn title={t('横に等間隔') + ' (Alt+Shift+H)'} onClick={() => st().distributeSelection('x')} disabled={nItems < 3}>
          <IcDistributeH />
        </IconBtn>
        <IconBtn title={t('縦に等間隔') + ' (Alt+Shift+V)'} onClick={() => st().distributeSelection('y')} disabled={nItems < 3}>
          <IcDistributeV />
        </IconBtn>
      </div>
      <span className="sep" />
      <div className="btn-group">
        <IconBtn
          title={t('サイズを基準の図形に揃える（最後に選択した図形が基準。太い枠で表示）')}
          onClick={() => st().matchSelection('size')}
          disabled={nNodes < 2}
        >
          <IcSameSize />
        </IconBtn>
        <IconBtn
          title={t('スタイルを基準の図形に揃える（色・枠線・文字の設定をコピー）')}
          onClick={() => st().matchSelection('all')}
          disabled={nNodes < 2 && !(nNodes === 1 && nItems + sel.edges.length > 1)}
        >
          <IcMatchStyle />
        </IconBtn>
        <IconBtn title={t('選択したものを既定の設定に戻す（サイズ・色・文字・回転）')} onClick={() => st().resetSelection()} disabled={!anything}>
          <IcReset />
        </IconBtn>
      </div>
      <span className="sep" />
      <div className="btn-group">
        <IconBtn title={t('太字') + ' (Ctrl+B)'} onClick={() => st().toggleTextStyle('bold')} disabled={!textish} active={textish && bold}>
          <IcBold />
        </IconBtn>
        <IconBtn title={t('斜体') + ' (Ctrl+I)'} onClick={() => st().toggleTextStyle('italic')} disabled={!textish} active={textish && italic}>
          <IcItalic />
        </IconBtn>
        <IconBtn title={t('下線') + ' (Ctrl+U)'} onClick={() => st().toggleTextStyle('underline')} disabled={nNodes === 0} active={nNodes > 0 && underline}>
          <IcUnderline />
        </IconBtn>
      </div>
      <div className="btn-group">
        <IconBtn title={t('文字を左揃え')} onClick={() => setAlign('left')} disabled={!textish} active={textish && textAlign === 'left'}>
          <IcTextLeft />
        </IconBtn>
        <IconBtn title={t('文字を中央揃え')} onClick={() => setAlign('center')} disabled={!textish} active={textish && textAlign === 'center'}>
          <IcTextCenter />
        </IconBtn>
        <IconBtn title={t('文字を右揃え')} onClick={() => setAlign('right')} disabled={!textish} active={textish && textAlign === 'right'}>
          <IcTextRight />
        </IconBtn>
      </div>
      <div className="btn-group">
        <IconBtn title={t('文字を小さく')} onClick={() => stepFont(-1)} disabled={!textish}>
          <IcFontSmaller />
        </IconBtn>
        <input
          className="fmt-size"
          type="number"
          min={4}
          step={1}
          disabled={!textish}
          value={fontSize !== undefined ? Math.round(fontSize * 10) / 10 : ''}
          placeholder={String(diagram.style.fontSize)}
          title={t('文字サイズ')}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (e.target.value !== '' && !isNaN(v) && v >= 4) setText({ fontSize: v });
          }}
        />
        <IconBtn title={t('文字を大きく')} onClick={() => stepFont(1)} disabled={!textish}>
          <IcFontLarger />
        </IconBtn>
      </div>
      <select
        className="fmt-font"
        disabled={!textish}
        value={fontValue}
        title={t('フォント（選択した図形・文字だけに適用。全体のフォントは右パネル）')}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'default') setText({ font: undefined });
          else if (v !== 'custom') setText({ font: v });
        }}
      >
        <option value="default">{t('フォント: 既定')}</option>
        {FONT_PRESETS.map((f) => (
          <option key={f.value} value={f.value}>
            {t(f.label)}
          </option>
        ))}
        {fontValue === 'custom' && <option value="custom">{font}</option>}
      </select>
      <span className="sep" />
      <div className="btn-group">
        <ColorPopoverButton
          title={t('文字色')}
          disabled={nNodes === 0}
          value={textColor}
          allowDefault
          onLive={(c) => st().updateSelection({ node: { color: c } }, true)}
          onPick={(c) => st().updateSelection({ node: { color: c } })}
        >
          <IcTextColor color={textColor} />
        </ColorPopoverButton>
        <ColorPopoverButton
          title={t('塗り')}
          disabled={!canShapeStyle}
          value={fill}
          allowNone
          allowDefault
          onLive={(c) => st().updateSelection({ node: { fill: c } }, true)}
          onPick={(c) => st().updateSelection({ node: { fill: c } })}
        >
          <IcFillColor color={fill} />
        </ColorPopoverButton>
        <ColorPopoverButton
          title={t('線の色（選択した接続線・線ラベル）')}
          disabled={sel.edges.length + sel.labels.length === 0}
          value={lineColor}
          allowDefault
          onLive={(c) => st().updateSelection({ edge: { color: c } }, true)}
          onPick={(c) => st().updateSelection({ edge: { color: c } })}
        >
          <IcLineColor color={lineColor} />
        </ColorPopoverButton>
      </div>
      <span className="sep" />
      <div className="btn-group">
        <IconBtn title={t('左に 90° 回転')} onClick={() => st().rotateSelection(-90)} disabled={nNodes === 0}>
          <IcRotateLeft />
        </IconBtn>
        <IconBtn title={t('右に 90° 回転')} onClick={() => st().rotateSelection(90)} disabled={nNodes === 0}>
          <IcRotateRight />
        </IconBtn>
      </div>
      <span className="fmt-hint muted">
        {anything
          ? refNode && nNodes > 1
            ? t('基準: {id}（最後に選択した図形）', { id: refNode.id })
            : ''
          : t('図形・線・文字を選択すると、ここで整列や書式を変更できます')}
      </span>
    </div>
  );
}
