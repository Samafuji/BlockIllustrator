import React, { useEffect } from 'react';
import { Canvas } from './editor/Canvas';
import { CodePanel } from './editor/CodePanel';
import { Inspector } from './editor/Inspector';
import { Toolbar } from './editor/Toolbar';
import { Palette } from './editor/TypeDefaults';
import { useT } from './i18n';
import { openDiagram, saveDiagram, useToast } from './io/actions';
import { useStore } from './store/useStore';

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable || !!el.closest?.('.cm-editor');
}

function StatusBar() {
  const t = useT();
  const nodes = useStore((s) => s.diagram.nodes.length);
  const edges = useStore((s) => s.diagram.edges.length);
  const errors = useStore((s) => s.parse.errors.length);
  const sel = useStore((s) => s.selection);
  const zoom = useStore((s) => s.view.zoom);
  const snap = useStore((s) => s.snap);
  const selText = sel.nodes.length > 0 ? sel.nodes.join(', ') : sel.edges.length > 0 ? sel.edges.join(', ') : t('なし');
  return (
    <div className="status">
      <span>{t('ノード {n} ・ 接続 {m}', { n: nodes, m: edges })}</span>
      <span>{t('選択: {v}', { v: selText })}</span>
      {errors > 0 ? <span className="err">{t('構文エラー {n} 件', { n: errors })}</span> : <span className="ok">{t('構文 OK')}</span>}
      <span>{t('ズーム {v}%', { v: Math.round(zoom * 100) })}</span>
      <span>{t('スナップ {v}', { v: snap ? 'ON' : 'OFF' })}</span>
      <span style={{ marginLeft: 'auto' }}>{t('ブラウザに自動保存中 (ローカル)')}</span>
    </div>
  );
}

function Toast() {
  const msg = useToast((s) => s.msg);
  const kind = useToast((s) => s.kind);
  if (!msg) return null;
  return <div className={'toast' + (kind === 'error' ? ' error' : '')}>{msg}</div>;
}

export function App() {
  const showCode = useStore((s) => s.showCode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const typing = isTyping(e.target);
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        void saveDiagram(e.shiftKey);
        return;
      }
      if (mod && key === 'o') {
        e.preventDefault();
        void openDiagram();
        return;
      }
      if (typing) return;
      if (e.altKey && !mod) {
        // alignment shortcuts (Figma-like): Alt+A/D/W/S edges, Alt+H/V centers, Alt+Shift+H/V distribute
        const actions: Record<string, () => void> = {
          a: () => st.alignSelection('left'),
          d: () => st.alignSelection('right'),
          w: () => st.alignSelection('top'),
          s: () => st.alignSelection('bottom'),
          h: () => (e.shiftKey ? st.distributeSelection('x') : st.alignSelection('hcenter')),
          v: () => (e.shiftKey ? st.distributeSelection('y') : st.alignSelection('vcenter')),
        };
        if (actions[key]) {
          e.preventDefault();
          actions[key]();
          return;
        }
      }
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        st.duplicateSelection();
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        st.setSelection({ nodes: st.diagram.nodes.map((n) => n.id), edges: [] });
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        st.deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        if (st.connectMode) st.setConnectMode(false);
        else st.clearSelection();
        return;
      }
      if (!mod && !e.altKey && key === 'c') {
        st.setConnectMode(!st.connectMode);
        return;
      }
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (arrows[e.key]) {
        e.preventDefault();
        const step = e.shiftKey ? st.diagram.style.grid || 10 : 1;
        st.nudgeSelection(arrows[e.key][0] * step, arrows[e.key][1] * step);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ctrl+C / Ctrl+X / Ctrl+V: nodes (and the connections between them) travel as DSL text,
  // so they can also be pasted into another diagram, window or a text editor.
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const text = useStore.getState().copySelectionText();
      if (!text) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const text = useStore.getState().copySelectionText();
      if (!text) return;
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
      useStore.getState().deleteSelection();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const text = e.clipboardData?.getData('text/plain');
      if (text && useStore.getState().pasteText(text)) e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty && useStore.getState().fileName) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className={'main' + (showCode ? '' : ' no-code')}>
        {showCode && (
          <div className="panel left">
            <CodePanel />
          </div>
        )}
        <Palette />
        <Canvas />
        <div className="panel right">
          <Inspector />
        </div>
      </div>
      <StatusBar />
      <Toast />
    </div>
  );
}
