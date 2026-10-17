import { readFile, readdir } from "node:fs/promises";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { join } from "node:path";

const gzipAsync = promisify(gzip);
const assetsDir = join(import.meta.dirname, "..", "dist", "assets");
const budgetBytes = 512 * 1024;

let files;
try {
  files = (await readdir(assetsDir)).filter((file) => file.endsWith(".js"));
} catch {
  console.error("Bundle-size check failed: dist/assets is missing. Run the production build first.");
  process.exit(1);
}

if (files.length === 0) {
  console.error("Bundle-size check failed: no JavaScript bundles were produced.");
  process.exit(1);
}

const sizes = await Promise.all(files.map(async (file) => {
  const contents = await readFile(join(assetsDir, file));
  return { file, bytes: (await gzipAsync(contents)).byteLength };
}));
const totalBytes = sizes.reduce((total, asset) => total + asset.bytes, 0);

for (const asset of sizes) {
  console.log(`${asset.file}: ${(asset.bytes / 1024).toFixed(1)} KiB gzip`);
}
console.log(`Total JavaScript: ${(totalBytes / 1024).toFixed(1)} / 512 KiB gzip`);

if (totalBytes > budgetBytes) {
  console.error("Bundle-size budget exceeded.");
  process.exit(1);
}
