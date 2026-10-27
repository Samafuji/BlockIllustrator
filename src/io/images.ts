// Image import: files / clipboard / drag-and-drop -> embedded data URL assets + image nodes.

import { t } from '../i18n';
import { Point } from '../model/types';
import { useStore } from '../store/useStore';
import { canvasApi } from '../editor/canvasApi';

/** Longest side kept when embedding (bigger images are downscaled to keep .bd files small). */
export const MAX_EMBED_SIDE = 1600;
/** Longest side of a freshly placed image node (px in diagram units). */
export const DEFAULT_IMAGE_SIDE = 120;

export interface LoadedImage {
  data: string; // data URL
  w: number; // natural size
  h: number;
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t('画像を読み込めませんでした')));
    img.src = src;
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read error'));
    r.readAsDataURL(file);
  });
}

/** Natural size of an image given as a data URL (SVG without a size falls back to 100x100). */
export async function imageSize(data: string): Promise<{ w: number; h: number }> {
  const img = await loadImageElement(data);
  return { w: img.naturalWidth || img.width || 100, h: img.naturalHeight || img.height || 100 };
}

/** Read a file and embed it as a data URL; large rasters are downscaled. */
export async function fileToImage(file: Blob): Promise<LoadedImage> {
  const raw = await readAsDataUrl(file);
  if (!/^data:image\//i.test(raw)) throw new Error(t('画像ファイルではありません'));
  const isSvg = /^data:image\/svg\+xml/i.test(raw);
  const img = await loadImageElement(raw);
  let w = img.naturalWidth || img.width || 100;
  let h = img.naturalHeight || img.height || 100;
  if (isSvg || Math.max(w, h) <= MAX_EMBED_SIDE) return { data: raw, w, h };
  const k = MAX_EMBED_SIDE / Math.max(w, h);
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, cw, ch);
  const jpeg = /^data:image\/jpe?g/i.test(raw);
  const data = jpeg ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
  return { data, w: cw, h: ch };
}

/** Node size for an image with the given natural size: longest side = `side`, aspect kept. */
export function fitSize(w: number, h: number, side = DEFAULT_IMAGE_SIDE): { w: number; h: number } {
  const k = side / Math.max(w, h, 1);
  return { w: Math.max(10, Math.round(w * k)), h: Math.max(10, Math.round(h * k)) };
}

/** Asset name from a file name: "Robot Arm.png" -> "robot_arm". */
export function assetNameFromFile(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  let s = base.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s || !/^[A-Za-z_]/.test(s)) s = 'img' + (s ? '_' + s : '');
  return s;
}

function pickFiles(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/**
 * Embed the given image files and add one image node per file. The first node is
 * placed at `at` (viewport center if omitted); further ones are offset.
 */
export async function importImageFiles(files: File[] | FileList, at?: Point): Promise<string[]> {
  const list = Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f.name));
  if (list.length === 0) return [];
  const st = useStore.getState();
  const g = st.diagram.style.grid || 10;
  const c = at ?? canvasApi.current?.viewportCenterWorld() ?? { x: 200, y: 150 };
  const side = Math.max(st.diagram.style.blockWidth, st.diagram.style.blockHeight, DEFAULT_IMAGE_SIDE);
  const ids: string[] = [];
  let k = 0;
  for (const f of list) {
    const img = await fileToImage(f);
    const name = useStore.getState().addAsset(assetNameFromFile(f.name || 'image'), img.data);
    const size = fitSize(img.w, img.h, side);
    const x = Math.round((c.x + k * 30) / g) * g;
    const y = Math.round((c.y + k * 30) / g) * g;
    ids.push(useStore.getState().addImageNode(name, { x, y }, size));
    k++;
  }
  if (ids.length) useStore.getState().setSelection({ nodes: ids, edges: [] });
  canvasApi.current?.focus();
  return ids;
}

/** Toolbar / palette: choose image files and add them. */
export async function pickAndAddImages(at?: Point): Promise<void> {
  const files = await pickFiles(true);
  await importImageFiles(files, at);
}

/** Inspector: replace the picture of an existing image node (size follows the new aspect ratio). */
export async function replaceNodeImage(nodeId: string): Promise<void> {
  const [file] = await pickFiles(false);
  if (!file) return;
  const img = await fileToImage(file);
  const st = useStore.getState();
  const node = st.diagram.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const name = st.addAsset(assetNameFromFile(file.name || 'image'), img.data);
  const cur = st.diagram.nodes.find((n) => n.id === nodeId);
  const w = cur?.w ?? st.diagram.style.blockWidth;
  st.updateNode(nodeId, { src: name, w, h: Math.max(10, Math.round((w * img.h) / img.w)) });
}

/** Inspector: restore the natural aspect ratio of an image node (keeps its width). */
export async function fitNodeToImage(nodeId: string): Promise<void> {
  const st = useStore.getState();
  const node = st.diagram.nodes.find((n) => n.id === nodeId);
  const src = node?.src ? st.diagram.assets[node.src] ?? node.src : undefined;
  if (!node || !src) return;
  const { w, h } = await imageSize(src);
  const cw = node.w ?? st.diagram.style.blockWidth;
  st.updateNode(nodeId, { w: cw, h: Math.max(10, Math.round((cw * h) / w)) });
}

/** Clipboard: image files pasted from a screenshot / another app. */
export function imageFilesFromClipboard(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}
