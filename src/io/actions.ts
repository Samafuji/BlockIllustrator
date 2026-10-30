import { t } from '../i18n';
import { create } from 'zustand';
import { EXAMPLES } from '../examples';
import { useStore } from '../store/useStore';
import { canvasApi } from '../editor/canvasApi';
import { hasFsAccess, openFile, save, saveAs, saveExport, saveToHandle } from './files';
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

/**
 * Export a picture and keep the diagram file in step with it:
 *  - a diagram that has no file yet is saved first (so the picture can go next to it;
 *    cancelling that still exports),
 *  - the picture's save dialog opens in the diagram's folder,
 *  - afterwards unsaved changes of the diagram are written to its file.
 */
async function exportPicture(run: (deliver: (blob: Blob, fileName: string) => Promise<void>) => Promise<void>) {
  await guard(async () => {
    let st = useStore.getState();
    if (!st.fileHandle && hasFsAccess()) {
      const ref = await saveAs(st.serialize(), st.fileName ?? 'diagram.bd');
      if (ref) {
        st.markSaved(ref.name, ref.handle);
        toast(t('{name} に保存しました', { name: ref.name }));
      }
      st = useStore.getState();
    }
    const handle = st.fileHandle;
    let outcome: { saved: boolean; picked: boolean } | null = null;
    await run(async (blob, fileName) => {
      outcome = await saveExport(blob, fileName, handle);
      if (outcome.saved) toast(outcome.picked ? t('{name} に保存しました', { name: fileName }) : t('{name} をダウンロードしました', { name: fileName }));
    });
    // the diagram file follows its exports
    const after = useStore.getState();
    if (outcome && (outcome as { saved: boolean }).saved && after.fileHandle && after.dirty) {
      await saveToHandle(after.fileHandle, after.serialize());
      after.markSaved(after.fileName ?? 'diagram.bd', after.fileHandle);
    }
  });
}

export const exportActions = {
  svg: () => exportPicture((deliver) => exportSvgFile(useStore.getState().diagram, name(), deliver)),
  png: (scale: number) => exportPicture((deliver) => exportPngFile(useStore.getState().diagram, name(), scale, deliver)),
  pdf: () => exportPicture((deliver) => exportPdfFile(useStore.getState().diagram, name(), deliver)),
  eps: () => exportPicture((deliver) => exportEpsFile(useStore.getState().diagram, name(), deliver)),
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
