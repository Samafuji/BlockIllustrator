// File save / open using the File System Access API when available,
// falling back to download / <input type=file>.

const PICKER_TYPES = [
  {
    description: 'Block diagram',
    accept: { 'text/plain': ['.bd', '.txt'] },
  },
];

/** Picker file types for exported pictures, by extension. */
const EXPORT_TYPES: Record<string, { description: string; accept: Record<string, string[]> }> = {
  svg: { description: 'SVG image', accept: { 'image/svg+xml': ['.svg'] } },
  png: { description: 'PNG image', accept: { 'image/png': ['.png'] } },
  pdf: { description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } },
  eps: { description: 'EPS (PostScript)', accept: { 'application/postscript': ['.eps'] } },
};

export interface FileRef {
  name: string;
  handle: FileSystemFileHandle | null;
}

export function hasFsAccess(): boolean {
  return typeof (window as any).showSaveFilePicker === 'function';
}

/** The file behind a handle was deleted, moved or is no longer writable. */
function fileGone(e: unknown): boolean {
  const n = (e as Error)?.name;
  return n === 'NotFoundError' || n === 'NotAllowedError' || n === 'InvalidStateError' || n === 'NoModificationAllowedError';
}

export async function saveToHandle(handle: FileSystemFileHandle, code: string): Promise<void> {
  const writable = await (handle as any).createWritable();
  await writable.write(code);
  await writable.close();
}

/** Save As. Returns the file reference, or null if cancelled. `startIn`: open the dialog next to this file. */
export async function saveAs(code: string, suggestedName: string, startIn?: FileSystemHandle | null): Promise<FileRef | null> {
  if (hasFsAccess()) {
    try {
      const handle: FileSystemFileHandle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: PICKER_TYPES,
        startIn: startIn ?? undefined,
      });
      await saveToHandle(handle, code);
      return { name: handle.name, handle };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      throw e;
    }
  }
  const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { name: suggestedName, handle: null };
}

/**
 * Save to the current file. When that file no longer exists at its place (deleted,
 * moved, drive gone) or there is no file yet, the Save As dialog opens instead.
 */
export async function save(code: string, current: FileRef | null, suggestedName: string): Promise<FileRef | null> {
  if (current?.handle) {
    try {
      await saveToHandle(current.handle, code);
      return current;
    } catch (e) {
      if (!fileGone(e)) throw e;
    }
  }
  return saveAs(code, current?.name ?? suggestedName, current?.handle);
}

/**
 * Save an exported picture. With the File System Access API the dialog opens in the
 * folder of the diagram file (`startIn`), so pictures land next to the .bd; otherwise
 * the browser downloads the file. Returns false when the user cancelled.
 */
export async function saveExport(blob: Blob, fileName: string, startIn?: FileSystemHandle | null): Promise<{ saved: boolean; picked: boolean }> {
  const ext = fileName.replace(/^.*\./, '').toLowerCase();
  if (hasFsAccess() && EXPORT_TYPES[ext]) {
    try {
      const handle: FileSystemFileHandle = await (window as any).showSaveFilePicker({
        suggestedName: fileName,
        types: [EXPORT_TYPES[ext]],
        startIn: startIn ?? undefined,
      });
      const writable = await (handle as any).createWritable();
      await writable.write(blob);
      await writable.close();
      return { saved: true, picked: true };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return { saved: false, picked: true };
      // no user gesture left (e.g. a slow render): fall back to a download
      if ((e as Error).name !== 'SecurityError') throw e;
    }
  }
  downloadBlob(blob, fileName);
  return { saved: true, picked: false };
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Open a file. Returns null if cancelled. */
export async function openFile(): Promise<{ code: string; ref: FileRef } | null> {
  if (typeof (window as any).showOpenFilePicker === 'function') {
    try {
      const [handle]: FileSystemFileHandle[] = await (window as any).showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
      const file = await handle.getFile();
      const code = await file.text();
      return { code, ref: { name: handle.name, handle } };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bd,.txt,text/plain';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const code = await f.text();
      resolve({ code, ref: { name: f.name, handle: null } });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
