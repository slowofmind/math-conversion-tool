// zip-node.mjs — opens a fixture zip in Node with the platform's own JSZip copy
// (epub-thorium/jszip.min.js), returning entries exactly as index.html's
// readZipFiles does: [{ name, data: Uint8Array }] in the zip's order, folders skipped.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const JSZip = createRequire(import.meta.url)('../../epub-thorium/jszip.min.js');
export async function readZipEntries(path) {
  const zin = await JSZip.loadAsync(readFileSync(new URL(path, import.meta.url)));
  const out = [];
  for (const entry of Object.values(zin.files)) {
    if (entry.dir) continue;
    out.push({ name: entry.name, data: await entry.async('uint8array') });
  }
  return out;
}
