// Sends images to the scanning worker. Falls back to scanning on the main
// thread if workers aren't available or the worker fails to start.
import type { ScanOptions, ScanResult } from './engine';

type Pending = { resolve: (r: ScanResult[]) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let broken = typeof Worker === 'undefined';
let seq = 0;
const pending = new Map<number, Pending>();

async function onMainThread(image: ImageData, opts: ScanOptions): Promise<ScanResult[]> {
  const { scanImage } = await import('./engine');
  return scanImage(image, opts);
}

function start(): Worker | null {
  if (broken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<{ id: number; results?: ScanResult[]; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data.results ?? []);
  };
  worker.onerror = () => {
    // The worker couldn't load: scan on the main thread from now on.
    broken = true;
    worker?.terminate();
    worker = null;
    for (const [id, p] of pending) {
      pending.delete(id);
      p.reject(new Error('The scanner is restarting. Try again.'));
    }
  };
  return worker;
}

/** Scan an image. The image's pixel buffer is transferred to the worker, so don't reuse it. */
export function scan(image: ImageData, opts: ScanOptions): Promise<ScanResult[]> {
  const w = start();
  if (!w) return onMainThread(image, opts);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, image, opts }, [image.data.buffer]);
  });
}

/** Load the engine in the background before the first frame arrives. */
export function warmUp(): void {
  start();
}
