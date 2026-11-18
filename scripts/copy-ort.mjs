// Copies the onnxruntime-web runtime into public/ort (and the COI service worker into public/) so the worker can load it
// at runtime instead of having the bundler process ORT's dynamic wasm imports.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "onnxruntime-web", "dist");
const dest = join(root, "public", "ort");

const wanted = (f) =>
  f === "ort.webgpu.min.mjs" ||
  /^ort-wasm-simd-threaded\.(jsep|asyncify)\.(mjs|wasm)$/.test(f);

mkdirSync(dest, { recursive: true });
for (const f of readdirSync(src).filter(wanted)) {
  cpSync(join(src, f), join(dest, f));
}
console.log(`Copied onnxruntime-web runtime to ${dest}`);

// Service worker that adds COOP/COEP headers on hosts that cannot set them (GitHub Pages).
cpSync(
  join(root, "node_modules", "coi-serviceworker", "coi-serviceworker.min.js"),
  join(root, "public", "coi-serviceworker.min.js"),
);
