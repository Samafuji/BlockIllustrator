import React, { useEffect, useRef } from 'react';
import { EditorView, keymap, Decoration, DecorationSet } from '@codemirror/view';
import { EditorState, StateEffect, StateField, Annotation } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { lintGutter, setDiagnostics, Diagnostic } from '@codemirror/lint';
import { indentWithTab } from '@codemirror/commands';
import { blockDiagramLanguage } from '../dsl/language';
import { useStore } from '../store/useStore';
import { useT } from '../i18n';

/** Flush a pending (debounced) editor -> store update. Called before GUI edits. */
export const codeEditorApi: { flush: (() => void) | null } = { flush: null };

const External = Annotation.define<boolean>();
const setReveal = StateEffect.define<number | null>();
const revealField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setReveal)) {
        if (e.value == null) return Decoration.none;
        const ln = Math.max(1, Math.min(e.value, tr.state.doc.lines));
        const line = tr.state.doc.line(ln);
        return Decoration.set([Decoration.line({ class: 'cm-reveal-line' }).range(line.from)]);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-content': { padding: '8px 0' },
  '.cm-gutters': { background: '#f8fafc', borderRight: '1px solid #e5e7eb', color: '#9ca3af' },
  '.cm-activeLineGutter': { background: '#eef2f7' },
  '.cm-activeLine': { background: 'rgba(43,125,233,0.05)' },
});

export function CodePanel() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const codeVersion = useStore((s) => s.codeVersion);
  const errors = useStore((s) => s.parse.errors);
  const revealLine = useStore((s) => s.revealLine);

  useEffect(() => {
    if (!ref.current) return;
    const flush = () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = undefined;
        const v = viewRef.current;
        if (v) useStore.getState().setCodeFromEditor(v.state.doc.toString());
      }
    };
    const listener = EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      if (u.transactions.some((t) => t.annotation(External))) return;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        useStore.getState().setCodeFromEditor(u.view.state.doc.toString());
      }, 300);
    });
    const view = new EditorView({
      state: EditorState.create({
        doc: useStore.getState().code,
        extensions: [basicSetup, keymap.of([indentWithTab]), blockDiagramLanguage, lintGutter(), revealField, theme, listener],
      }),
      parent: ref.current,
    });
    viewRef.current = view;
    codeEditorApi.flush = flush;
    return () => {
      codeEditorApi.flush = null;
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // store -> editor (GUI edits, undo/redo, file load)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const code = useStore.getState().code;
    const cur = view.state.doc.toString();
    if (cur === code) return;
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    view.dispatch({
      changes: { from: 0, to: cur.length, insert: code },
      annotations: External.of(true),
      selection: { anchor: Math.min(view.state.selection.main.anchor, code.length) },
    });
  }, [codeVersion]);

  // diagnostics
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const doc = view.state.doc;
    const diags: Diagnostic[] = errors.map((e) => {
      const ln = Math.max(1, Math.min(e.line, doc.lines));
      const line = doc.line(ln);
      return { from: line.from, to: line.to, severity: 'error', message: e.message };
    });
    view.dispatch(setDiagnostics(view.state, diags));
  }, [errors, codeVersion]);

  // reveal selected element's line
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !revealLine) return;
    const ln = Math.max(1, Math.min(revealLine.line + 1, view.state.doc.lines));
    const line = view.state.doc.line(ln);
    view.dispatch({ effects: [setReveal.of(ln), EditorView.scrollIntoView(line.from, { y: 'center' })] });
    const t = window.setTimeout(() => viewRef.current?.dispatch({ effects: setReveal.of(null) }), 1500);
    return () => window.clearTimeout(t);
  }, [revealLine]);

  const goto = (line: number) => {
    const view = viewRef.current;
    if (!view) return;
    const ln = Math.max(1, Math.min(line, view.state.doc.lines));
    const l = view.state.doc.line(ln);
    view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
    view.focus();
  };

  return (
    <>
      <div className="panel-title">
        {t('コード')}
        <span className="hint">{t('編集すると図に反映（双方向）')}</span>
      </div>
      <div className="code-editor" ref={ref} />
      {errors.length > 0 ? (
        <div className="code-errors">
          {errors.map((e, i) => (
            <div key={i} className="err" onClick={() => goto(e.line)}>
              <b>{t('{n}行:', { n: e.line })}</b> {e.message}
            </div>
          ))}
        </div>
      ) : (
        <div className="code-ok">{t('✓ エラーなし')}</div>
      )}
    </>
  );
}
