import React, { useEffect, useRef, useState } from 'react';
import { EXAMPLES } from '../examples';
import { LANGS, Lang, useLang, useT } from '../i18n';
import { exportActions, loadExample, newDiagram, openDiagram, saveDiagram } from '../io/actions';
import { useStore } from '../store/useStore';
import { canvasApi } from './canvasApi';

export function Menu({
  label,
  children,
  right,
  title,
  disabled,
  keepOpen,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  right?: boolean;
  title?: string;
  disabled?: boolean;
  /** keep the menu open after clicking an item (toggle lists) */
  keepOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
  return (
    <div className="menu" ref={ref}>
      <button className={'btn' + (open ? ' active' : '')} onClick={() => setOpen(!open)} title={title} disabled={disabled}>
        {label} ▾
      </button>
      {open && (
        <div className={'menu-list' + (right ? ' right' : '')} onClick={() => !keepOpen && setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

function Check({ on }: { on: boolean }) {
  return <span className="check-mark">{on ? '✓' : ''}</span>;
}

export function Toolbar() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const setLang = useLang((s) => s.setLang);
  const fileName = useStore((s) => s.fileName);
  const dirty = useStore((s) => s.dirty);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const showGrid = useStore((s) => s.showGrid);
  const snap = useStore((s) => s.snap);
  const showCode = useStore((s) => s.showCode);
  const followEdges = useStore((s) => s.followEdges);
  const hasSel = useStore((s) => s.selection.nodes.length + s.selection.edges.length > 0);
  const selCount = useStore((s) => s.selection.nodes.length);
  const st = useStore.getState;

  return (
    <div className="toolbar">
      <span className="brand">Block Illustrator</span>
      <Menu label={t('ファイル')}>
        <button className="menu-item" onClick={newDiagram}>
          {t('新規作成')}
        </button>
        <button className="menu-item" onClick={openDiagram}>
          {t('開く…')} <small>Ctrl+O</small>
        </button>
        <button className="menu-item" onClick={() => saveDiagram(false)}>
          {t('保存')} <small>Ctrl+S</small>
        </button>
        <button className="menu-item" onClick={() => saveDiagram(true)}>
          {t('名前を付けて保存…')}
        </button>
        <div className="menu-sep" />
        {EXAMPLES.map((ex, i) => (
          <button key={i} className="menu-item" onClick={() => loadExample(i)}>
            {t('サンプル')}: {t(ex.name)}
          </button>
        ))}
      </Menu>
      <button className="btn" onClick={() => saveDiagram(false)} title={t('保存 (Ctrl+S)')}>
        <span className="ico">💾</span>
        {t('保存')}
      </button>
      <span className="filename" title={fileName ?? t('未保存')}>
        {fileName ?? t('(無題)')}
        {/* fixed-width marker so the toolbar does not reflow (and the canvas does not re-fit) on the first edit */}
        <span className="dirty-mark" title={dirty ? t('未保存の変更があります') : ''}>
          {dirty ? '●' : ''}
        </span>
      </span>
      <span className="sep" />
      <div className="btn-group">
        <button className="btn" disabled={!canUndo} onClick={() => st().undo()} title={t('元に戻す (Ctrl+Z)')}>
          ↶
        </button>
        <button className="btn" disabled={!canRedo} onClick={() => st().redo()} title={t('やり直す (Ctrl+Y)')}>
          ↷
        </button>
      </div>
      <div className="btn-group">
        <button className="btn danger" disabled={!hasSel} onClick={() => st().deleteSelection()} title={t('削除 (Delete)')}>
          🗑
        </button>
        <button className="btn" disabled={!hasSel} onClick={() => st().duplicateSelection()} title={t('複製 (Ctrl+D)')}>
          ⧉
        </button>
      </div>
      <Menu label={t('整列')} disabled={selCount < 2} title={t('複数のノード (Shift+クリック / 範囲選択) を揃えます')}>
        <button className="menu-item" onClick={() => st().alignSelection('left')}>
          ⇤ {t('左揃え')} <small>Alt+A</small>
        </button>
        <button className="menu-item" onClick={() => st().alignSelection('hcenter')}>
          ⇹ {t('左右中央揃え')} <small>Alt+H</small>
        </button>
        <button className="menu-item" onClick={() => st().alignSelection('right')}>
          ⇥ {t('右揃え')} <small>Alt+D</small>
        </button>
        <div className="menu-sep" />
        <button className="menu-item" onClick={() => st().alignSelection('top')}>
          ⤒ {t('上揃え')} <small>Alt+W</small>
        </button>
        <button className="menu-item" onClick={() => st().alignSelection('vcenter')}>
          ⇳ {t('上下中央揃え')} <small>Alt+V</small>
        </button>
        <button className="menu-item" onClick={() => st().alignSelection('bottom')}>
          ⤓ {t('下揃え')} <small>Alt+S</small>
        </button>
        <div className="menu-sep" />
        <button className="menu-item" onClick={() => st().distributeSelection('x')} disabled={selCount < 3}>
          {t('横に等間隔')} <small>Alt+Shift+H</small>
        </button>
        <button className="menu-item" onClick={() => st().distributeSelection('y')} disabled={selCount < 3}>
          {t('縦に等間隔')} <small>Alt+Shift+V</small>
        </button>
        <button className="menu-item" onClick={() => st().sameSizeSelection()}>
          {t('サイズを最初の図形に揃える')}
        </button>
      </Menu>
      <span className="sep" />
      <Menu label={t('表示')} keepOpen>
        <button className="menu-item" onClick={() => st().toggleGrid()} title={t('グリッド表示')}>
          <Check on={showGrid} /> {t('グリッド')}
        </button>
        <button className="menu-item" onClick={() => st().toggleSnap()} title={t('グリッドにスナップ（整列ガイドも有効）')}>
          <Check on={snap} /> {t('スナップ')}
        </button>
        <button className="menu-item" onClick={() => st().toggleFollowEdges()} title={t('ON: ブロックを動かすと接続線の経由点 (via) も一緒に動きます。Ctrl を押しながらドラッグすると一時的に反転します')}>
          <Check on={followEdges} /> {t('線を追従')}
        </button>
        <button className="menu-item" onClick={() => st().toggleCode()} title={t('コードパネル表示')}>
          <Check on={showCode} /> {t('コードパネル')}
        </button>
        <div className="menu-sep" />
        <button className="menu-item" onClick={() => canvasApi.current?.fit()}>
          <Check on={false} /> {t('全体表示')}
        </button>
      </Menu>
      <span className="spacer" />
      <label className="lang-select" title={t('言語')}>
        🌐
        <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <Menu label={'📤 ' + t('エクスポート')} right>
        <button className="menu-item" onClick={exportActions.svg}>
          {t('SVG をダウンロード')}
        </button>
        <button className="menu-item" onClick={() => exportActions.png(2)}>
          {t('PNG をダウンロード')} <small>2x</small>
        </button>
        <button className="menu-item" onClick={() => exportActions.png(4)}>
          {t('PNG をダウンロード')} <small>4x ({t('高解像度')})</small>
        </button>
        <button className="menu-item" onClick={exportActions.pdf}>
          {t('PDF をダウンロード')} <small>{t('欧文フォントのみ')}</small>
        </button>
        <button className="menu-item" onClick={exportActions.eps}>
          {t('EPS をダウンロード')} <small>{t('欧文フォントのみ')}</small>
        </button>
        <button className="menu-item" onClick={exportActions.print}>
          {t('PDF (ブラウザ印刷)')} <small>{t('日本語・中国語フォント対応')}</small>
        </button>
        <div className="menu-sep" />
        <button className="menu-item" onClick={() => exportActions.copyPng(3)}>
          {t('PNG をクリップボードにコピー')} <small>{t('PowerPoint 等に貼り付け')}</small>
        </button>
        <button className="menu-item" onClick={exportActions.copySvg}>
          {t('SVG コードをコピー')}
        </button>
      </Menu>
    </div>
  );
}
