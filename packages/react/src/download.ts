import type { ClientExportResult } from './client.js';

/** Saves exported bytes through a temporary object URL. No-op outside the browser. */
export function triggerDownload(file: Pick<ClientExportResult, 'bytes' | 'mimeType' | 'filename'>): void {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  )
    return;
  const blob = new Blob([file.bytes.slice()], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
