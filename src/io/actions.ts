import { t } from '../i18n';
import { create } from 'zustand';
import { EXAMPLES } from '../examples';
import { useStore } from '../store/useStore';
import { canvasApi } from '../editor/canvasApi';
import { openFile, save, saveAs } from './files';
import {
  baseName,
  copyPngToClipboard,
  copySvgToClipboard,
  exportEpsFile,
  exportPdfFile,
  exportPngFile,
  exportSvgFile,
  printDiagram,
} from './export';

// ---------------------------------------------------------------- toast
interface ToastState {
  msg: string | null;
  kind: 'info' | 'error';
  show: (msg: string, kind?: 'info' | 'error') => void;
}
let toastTimer: number | undefined;
export const useToast = create<ToastState>((set) => ({
  msg: null,
  kind: 'info',
  show(msg, kind = 'info') {
    set({ msg, kind });
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => set({ msg: null }), kind === 'error' ? 5000 : 2200);
  },
}));

export function toast(msg: string, kind: 'info' | 'error' = 'info') {
  useToast.getState().show(msg, kind);
}

async function guard(fn: () => Promise<void> | void) {
  try {
    await fn();
  } catch (e) {
    console.error(e);
    toast((e as Error).message || String(e), 'error');
  }
}

// ---------------------------------------------------------------- files
export function newDiagram() {
  const st = useStore.getState();
  if (st.dirty && !window.confirm(t('未保存の変更があります。破棄して新規作成しますか？'))) return;
  st.loadCode(EXAMPLES[EXAMPLES.length - 1].code);
  setTimeout(() => canvasApi.current?.fit(), 0);
}

export function loadExample(index: number) {
  const st = useStore.getState();
  if (st.dirty && !window.confirm(t('未保存の変更があります。破棄してサンプルを開きますか？'))) return;
  st.loadCode(EXAMPLES[index].code);
  setTimeout(() => canvasApi.current?.fit(), 0);
}

export async function openDiagram() {
  await guard(async () => {
    const st = useStore.getState();
    if (st.dirty && !window.confirm(t('未保存の変更があります。破棄してファイルを開きますか？'))) return;
    const res = await openFile();
    if (!res) return;
    st.loadCode(res.code, { name: res.ref.name, handle: res.ref.handle });
    setTimeout(() => canvasApi.current?.fit(), 0);
    toast(t('{name} を開きました', { name: res.ref.name }));
  });
}

export async function saveDiagram(forceAs = false) {
  await guard(async () => {
    const st = useStore.getState();
    const current = st.fileName ? { name: st.fileName, handle: st.fileHandle } : null;
    const suggested = st.fileName ?? 'diagram.bd';
    const text = st.serialize();
    const ref = forceAs ? await saveAs(text, suggested) : await save(text, current, suggested);
    if (!ref) return;
    st.markSaved(ref.name, ref.handle);
    toast(ref.handle ? t('{name} に保存しました', { name: ref.name }) : t('{name} をダウンロードしました', { name: ref.name }));
  });
}

// ---------------------------------------------------------------- export
function name(): string {
  return baseName(useStore.getState().fileName);
}

export const exportActions = {
  svg: () => guard(() => exportSvgFile(useStore.getState().diagram, name())),
  png: (scale: number) => guard(() => exportPngFile(useStore.getState().diagram, name(), scale)),
  pdf: () => guard(() => exportPdfFile(useStore.getState().diagram, name())),
  eps: () => guard(() => exportEpsFile(useStore.getState().diagram, name())),
  print: () => guard(() => printDiagram(useStore.getState().diagram, name())),
  copyPng: (scale: number) =>
    guard(async () => {
      await copyPngToClipboard(useStore.getState().diagram, scale);
      toast(t('PNG をクリップボードにコピーしました'));
    }),
  copySvg: () =>
    guard(async () => {
      await copySvgToClipboard(useStore.getState().diagram);
      toast(t('SVG をクリップボードにコピーしました'));
    }),
};
