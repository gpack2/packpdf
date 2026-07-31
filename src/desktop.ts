import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';

/** True when running inside the Tauri desktop shell rather than a browser. */
export const inDesktop = isTauri();

/**
 * Discard confirmation that works in both environments: window.confirm is a
 * no-op returning undefined inside Tauri's WKWebView, so the desktop build
 * needs the native ask dialog.
 */
export async function confirmDiscard(message: string): Promise<boolean> {
  if (!inDesktop) return window.confirm(message);
  return ask(message, { title: 'packPDF', kind: 'warning' });
}

/**
 * Native "Save As" flow. Resolves false when the user cancels the dialog
 * (not an error), true once the bytes are on disk.
 */
export async function saveWithDialog(bytes: Uint8Array, defaultName: string): Promise<boolean> {
  const path = await saveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!path) return false;
  await writeFile(path, bytes);
  return true;
}

/**
 * Delivers PDFs the OS asks the app to open (Finder "Open With", Dock drops):
 * once for files queued before the frontend booted, then live for opens while
 * the app is running.
 */
export function onOsFileOpen(cb: (file: File) => void): void {
  if (!inDesktop) return;
  const openPath = async (path: string) => {
    const bytes = await readFile(path);
    const name = path.split('/').pop() ?? 'document.pdf';
    cb(new File([bytes], name, { type: 'application/pdf' }));
  };
  void listen<string[]>('open-files', (e) => {
    if (e.payload[0]) void openPath(e.payload[0]);
  });
  void invoke<string[]>('take_pending_files').then((paths) => {
    if (paths[0]) void openPath(paths[0]);
  });
}

/**
 * beforeunload never fires for a native window close; intercept the close
 * request and ask before discarding unsaved annotations.
 */
export function guardWindowClose(isDirty: () => boolean): void {
  if (!inDesktop) return;
  void getCurrentWindow().onCloseRequested(async (event) => {
    if (!isDirty()) return;
    // A thrown error here would stop Tauri's wrapper from ever destroying
    // the window, making it uncloseable — on dialog failure, allow the close.
    try {
      const discard = await ask('Discard the annotations on the current PDF?', {
        title: 'packPDF',
        kind: 'warning',
      });
      if (!discard) event.preventDefault();
    } catch {
      // fall through: closing loses annotations, but never trap the window
    }
  });
}
