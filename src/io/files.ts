// File save / open using the File System Access API when available,
// falling back to download / <input type=file>.

const PICKER_TYPES = [
  {
    description: 'Block diagram',
    accept: { 'text/plain': ['.bd', '.txt'] },
  },
];

export interface FileRef {
  name: string;
  handle: FileSystemFileHandle | null;
}

function hasFsAccess(): boolean {
  return typeof (window as any).showSaveFilePicker === 'function';
}

export async function saveToHandle(handle: FileSystemFileHandle, code: string): Promise<void> {
  const writable = await (handle as any).createWritable();
  await writable.write(code);
  await writable.close();
}

/** Save As. Returns the file reference, or null if cancelled. */
export async function saveAs(code: string, suggestedName: string): Promise<FileRef | null> {
  if (hasFsAccess()) {
    try {
      const handle: FileSystemFileHandle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: PICKER_TYPES,
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

export async function save(code: string, current: FileRef | null, suggestedName: string): Promise<FileRef | null> {
  if (current?.handle) {
    await saveToHandle(current.handle, code);
    return current;
  }
  return saveAs(code, current?.name ?? suggestedName);
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
