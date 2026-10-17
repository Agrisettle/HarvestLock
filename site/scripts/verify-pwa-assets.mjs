import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const publicDir = new URL("../public/", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

function pngDimensions(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG", "asset must be a PNG");
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

for (const page of ["index.html", "roles.html"]) {
  const html = await read(page);
  assert.match(html, /rel="manifest" href="\/site\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png"/);
  assert.match(html, /rel="icon" type="image\/png" href="\/favicon\.png"/);
}

const manifest = JSON.parse(await read("public/site.webmanifest"));
assert.equal(manifest.name, "HarvestLock");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.start_url, "/");
assert.equal(manifest.theme_color, "#0b120f");

for (const icon of manifest.icons) {
  const iconPath = icon.src.replace(/^\//, "");
  await stat(new URL(iconPath, publicDir));
  const dimensions = pngDimensions(await readFile(new URL(iconPath, publicDir)));
  assert.equal(icon.sizes, `${dimensions[0]}x${dimensions[1]}`, `${iconPath} declared size must match its PNG dimensions`);
}

assert.deepEqual(
  pngDimensions(await readFile(new URL("apple-touch-icon.png", publicDir))),
  [180, 180],
  "Apple touch icon must be 180x180",
);

console.log("PWA asset links, manifest, and PNG dimensions verified.");
