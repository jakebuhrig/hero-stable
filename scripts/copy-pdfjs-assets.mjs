// PDF.js loads fonts, CMaps, ICC profiles and WASM decoders at runtime.
// Copy them from node_modules into public/pdfjs so they are served from our own origin.
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const from = path.join(root, "node_modules", "pdfjs-dist");
const to = path.join(root, "public", "pdfjs");

await mkdir(to, { recursive: true });
for (const dir of ["standard_fonts", "cmaps", "iccs", "wasm"]) {
  await cp(path.join(from, dir), path.join(to, dir), { recursive: true });
}
console.log("Copied PDF.js assets to public/pdfjs");
