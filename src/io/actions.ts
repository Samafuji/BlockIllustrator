import { t } from '../i18n';
import { create } from 'zustand';
import { EXAMPLES } from '../examples';
import { FileInfo, useStore } from '../store/useStore';
import { canvasApi } from '../editor/canvasApi';
import { codeEditorApi } from '../editor/CodePanel';
import { hasFsAccess, openFiles, save, saveAs, saveExport, saveToHandle } from './files';
import {
  baseName,
  copyPngToClipboard,
  copySvgToClipboard,
  copySvgForPowerPoint,
  exportEpsFile,
  exportPdfFile,
  exportPngFile,
  exportSvgFile,
  printDiagram,
} from './export';
import { exportPptxFile } from './pptx';
import { diagramsFromPptx, diagramFromPowerPointSvg, isPowerPointSvg } from './pptImport';
import { edgeToLine, generate, nodeToLine } from '../dsl/generator';

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

/** Pending editor changes must reach the store before the document is swapped out. */
function flushEditor() {
  codeEditorApi.flush?.();
}

function fitSoon() {
  setTimeout(() => canvasApi.current?.fit(), 0);
}

// ---------------------------------------------------------------- tabs / documents
/** File > New: an empty document in a new tab. */
export function newDiagram() {
  flushEditor();
  useStore.getState().newTab();
  fitSoon();
}

export function loadExample(index: number) {
  flushEditor();
  useStore.getState().newTab(EXAMPLES[index].code);
  fitSoon();
}

export function switchTab(id: string) {
  flushEditor();
  useStore.getState().switchTab(id);
}

/** Close a tab, asking first when it has unsaved changes. Returns false if the user kept it. */
export function closeTabAsk(id: string): boolean {
  flushEditor();
  const st = useStore.getState();
  const tab = st.tabs.find((x) => x.id === id);
  if (!tab) return true;
  if (tab.dirty && !window.confirm(t('未保存の変更があります。このタブを閉じますか？'))) return false;
  st.closeTab(id);
  return true;
}

export function closeActiveTab() {
  closeTabAsk(useStore.getState().activeTab);
}

/** Switch to the neighbouring tab (Ctrl+Alt+Left / Right, Ctrl+Tab in the installed app). */
export function cycleTab(delta: number) {
  const st = useStore.getState();
  const idx = st.tabs.findIndex((x) => x.id === st.activeTab);
  if (idx < 0 || st.tabs.length < 2) return;
  switchTab(st.tabs[(idx + delta + st.tabs.length) % st.tabs.length].id);
}

/**
 * Show a document: in the tab that already has this file, in the active tab when that is
 * a new untouched document, otherwise in a new tab.
 */
export async function openDocument(text: string, file: FileInfo): Promise<void> {
  flushEditor();
  const st = useStore.getState();
  const existing = file.name ? await st.findTab(file.name, file.handle) : null;
  if (existing) {
    st.switchTab(existing);
    // a file that was changed on disk is reloaded unless the tab has edits of its own
    if (!useStore.getState().dirty) useStore.getState().loadCode(text, file);
    else toast(t('{name} は既に開いています', { name: file.name ?? '' }));
  } else if (st.isPristine()) st.loadCode(text, file);
  else st.newTab(text, file);
  fitSoon();
}

export async function openDiagram() {
  await guard(async () => {
    const files = await openFiles();
    if (!files.length) return;
    await openLoadedFiles(files.map((f) => ({ name: f.ref.name, handle: f.ref.handle, blob: f.blob })));
  });
}

export interface LoadedFile {
  name: string;
  handle: FileSystemFileHandle | null;
  blob: Blob;
}

const DIAGRAM_EXT = /\.(bd|txt)$/i;
const PPTX_EXT = /\.pptx$/i;
const SVG_EXT = /\.svg$/i;

/** A file this app can open as a document (dropped, picked, or double-clicked in the file manager). */
export function isDocumentFile(name: string, type = ''): boolean {
  return DIAGRAM_EXT.test(name) || PPTX_EXT.test(name) || SVG_EXT.test(name) || /^text\/plain$/i.test(type);
}

/** Open the given files as documents: .bd / .txt as they are, .pptx and PowerPoint .svg converted. */
export async function openLoadedFiles(files: LoadedFile[]): Promise<void> {
  await guard(async () => {
    let opened = 0;
    for (const f of files) {
      if (PPTX_EXT.test(f.name)) {
        const diagrams = await diagramsFromPptx(f.blob);
        if (diagrams.length === 0) throw new Error(t('{name} に取り込める図形がありません', { name: f.name }));
        const stem = f.name.replace(/\.pptx$/i, '');
        for (const d of diagrams) {
          const name = diagrams.length > 1 ? `${stem} (${d.title}).bd` : `${stem}.bd`;
          await openDocument(generate(d.diagram), { name, handle: null });
          opened++;
        }
        continue;
      }
      const text = await f.blob.text();
      if (SVG_EXT.test(f.name) || /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) {
        if (!isPowerPointSvg(text)) throw new Error(t('{name} は PowerPoint から保存した SVG ではないようです。画像として使うにはキャンバスにドロップしてください', { name: f.name }));
        const d = diagramFromPowerPointSvg(text);
        await openDocument(generate(d), { name: f.name.replace(/\.svg$/i, '') + '.bd', handle: null });
        opened++;
        continue;
      }
      await openDocument(text, { name: f.name, handle: f.handle });
      opened++;
    }
    if (opened === 1) toast(t('{name} を開きました', { name: files[0].name }));
    else if (opened > 1) toast(t('{n} 個のファイルを開きました', { n: opened }));
  });
}

/** Files dropped onto the window (not pictures dropped on the canvas: those become image nodes). */
export function openDroppedFiles(dt: DataTransfer): boolean {
  const items = Array.from(dt.items ?? []).filter((it) => it.kind === 'file');
  const picks: { file: File; handle: Promise<FileSystemFileHandle | null> }[] = [];
  for (const it of items) {
    const file = it.getAsFile();
    if (!file || !isDocumentFile(file.name, file.type)) continue;
    // the handle lets Ctrl+S write back to the dropped file (Chrome / Edge)
    const getHandle = (it as any).getAsFileSystemHandle as (() => Promise<FileSystemHandle | null>) | undefined;
    const handle: Promise<FileSystemFileHandle | null> = getHandle
      ? getHandle.call(it).then((h) => (h && h.kind === 'file' ? (h as FileSystemFileHandle) : null)).catch(() => null)
      : Promise.resolve(null);
    picks.push({ file, handle });
  }
  if (picks.length === 0) return false;
  void (async () => {
    const files: LoadedFile[] = [];
    for (const p of picks) files.push({ name: p.file.name, handle: DIAGRAM_EXT.test(p.file.name) ? await p.handle : null, blob: p.file });
    await openLoadedFiles(files);
  })();
  return true;
}

/** Files handed over by the OS (double-click on a .bd when the app is installed). */
export async function openFileHandles(handles: FileSystemFileHandle[]): Promise<void> {
  const files: LoadedFile[] = [];
  for (const h of handles) {
    try {
      files.push({ name: h.name, handle: DIAGRAM_EXT.test(h.name) ? h : null, blob: await h.getFile() });
    } catch (e) {
      console.error(e);
    }
  }
  if (files.length) await openLoadedFiles(files);
}

export async function saveDiagram(forceAs = false) {
  await guard(async () => {
    flushEditor();
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

// ---------------------------------------------------------------- install (PWA)
interface InstallState {
  /** the deferred `beforeinstallprompt` event, when the browser offers to install the app */
  prompt: (() => Promise<void>) | null;
  installed: boolean;
}
export const useInstall = create<InstallState>(() => ({
  prompt: null,
  installed: typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches,
}));

export function watchInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    const ev = e as Event & { prompt: () => Promise<void> };
    useInstall.setState({
      prompt: async () => {
        await ev.prompt();
        useInstall.setState({ prompt: null });
      },
    });
  });
  window.addEventListener('appinstalled', () => useInstall.setState({ prompt: null, installed: true }));
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
    flushEditor();
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
  pptx: () => exportPicture((deliver) => exportPptxFile(useStore.getState().diagram, name(), deliver)),
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
  /** SVG (+ PNG fallback) on the clipboard: PowerPoint pastes it as a graphic that "Convert to Shape" makes editable */
  copyForPowerPoint: (selectionOnly: boolean) =>
    guard(async () => {
      const st = useStore.getState();
      let d = st.diagram;
      if (selectionOnly) {
        const ids = new Set(st.selection.nodes);
        if (ids.size === 0) throw new Error(t('コピーする図形を選択してください'));
        d = { ...d, nodes: d.nodes.filter((n) => ids.has(n.id)), edges: d.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
      }
      await copySvgForPowerPoint(d);
      toast(t('PowerPoint 用にコピーしました。PowerPoint で Ctrl+V → 右クリック →「図形に変換」で編集できます'));
    }),
};

/** Paste from PowerPoint: the SVG it puts on the clipboard becomes blocks and lines. */
export async function pasteFromPowerPoint(): Promise<boolean> {
  let done = false;
  await guard(async () => {
    if (!navigator.clipboard?.read) throw new Error(t('このブラウザはクリップボードの読み取りに対応していません'));
    const items = await navigator.clipboard.read();
    let svg: string | null = null;
    for (const it of items) {
      if (it.types.includes('image/svg+xml')) {
        svg = await (await it.getType('image/svg+xml')).text();
        break;
      }
    }
    if (!svg) throw new Error(t('クリップボードに PowerPoint の図形がありません。PowerPoint で図形を選択してコピーしてください'));
    const d = diagramFromPowerPointSvg(svg);
    if (d.nodes.length === 0) throw new Error(t('取り込める図形がありませんでした'));
    const st = useStore.getState();
    // nodes and lines only (no style block): they join the current diagram like a Ctrl+V of .bd text
    const lines = [...d.nodes.map(nodeToLine), ...d.edges.map(edgeToLine)];
    if (!st.pasteText(lines.join('\n') + '\n')) throw new Error(t('取り込める図形がありませんでした'));
    toast(t('PowerPoint の図形を取り込みました ({n} 個)', { n: d.nodes.length }));
    done = true;
  });
  return done;
}
