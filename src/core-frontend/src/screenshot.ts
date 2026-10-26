/**
 * «Скриншот страницы» for administrators: the browser's own screen capture of the current tab (getDisplayMedia), one
 * frame turned into a PNG. No library and nothing leaves the browser; the browser asks for permission each time.
 * Not available where the browser has no screen capture (phones).
 */

export const canCapture = (): boolean => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

const two = (n: number) => String(n).padStart(2, '0');

/** coregsm-admin-settings-updates-20261026-103500.png */
export function shotFileName(path: string, d: Date): string {
  const slug = path.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'home';
  return `coregsm-${slug}-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.png`;
}

/** an aborted permission prompt is not an error worth showing */
export const wasCancelled = (e: unknown): boolean => e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError');

/** asks the browser to share this tab, takes one frame, stops the sharing */
export async function captureTab(): Promise<Blob> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displayMaxFrameRate: 1 },
    audio: false,
    // Chrome / Edge: offer this tab first and skip the picker
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
  } as DisplayMediaStreamOptions);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    // the first frame of a fresh capture may be empty: wait until a real one is there
    await new Promise<void>((resolve) => {
      if ('requestVideoFrameCallback' in video) (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => void }).requestVideoFrameCallback(() => resolve());
      else window.setTimeout(resolve, 300);
    });
    await new Promise((r) => window.setTimeout(r, 120));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('empty frame'))), 'image/png'));
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyImage(blob: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
