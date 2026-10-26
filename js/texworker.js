// Texture worker: runs a pixel program off the main thread and sends the buffers back.
import { runProgram, normalArray } from './texpixels.js';

self.onmessage = (e) => {
  const { id, name, N, params, normal } = e.data;
  try {
    const { rgba, H, R } = runProgram(name, N, params);
    const nrm = normal ? normalArray(H, N, normal) : null;
    const transfer = [rgba.buffer, H.buffer, R.buffer];
    if (nrm) transfer.push(nrm.buffer);
    self.postMessage({ id, rgba, H, R, nrm }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
