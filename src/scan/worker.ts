// Runs the whole scanning engine off the main thread, so decoding never makes
// the camera preview stutter.
import { scanImage, type ScanOptions } from './engine';

interface Request {
  id: number;
  image: ImageData;
  opts: ScanOptions;
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, image, opts } = e.data;
  try {
    const results = await scanImage(image, opts);
    self.postMessage({ id, results });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
