import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const assetsDirectory = new URL("../dist/assets/", import.meta.url);
const budgetBytes = 350_000;
const entries = await readdir(assetsDirectory, { withFileTypes: true });
const bundles = entries
  .filter((entry) => entry.isFile() && /\.(?:js|css)$/.test(entry.name))
  .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

if (bundles.length === 0) {
  throw new Error(`No JavaScript or CSS bundles found in ${assetsDirectory.pathname}`);
}

const sizes = await Promise.all(
  bundles.map(async (bundle) => ({
    name: bundle.name,
    bytes: (await stat(join(assetsDirectory.pathname, bundle.name))).size,
  })),
);
const totalBytes = sizes.reduce((total, bundle) => total + bundle.bytes, 0);

for (const bundle of sizes) {
  console.log(`${bundle.name}: ${bundle.bytes.toLocaleString()} bytes`);
}
console.log(`Total JavaScript + CSS: ${totalBytes.toLocaleString()} / ${budgetBytes.toLocaleString()} bytes`);

if (totalBytes > budgetBytes) {
  throw new Error("Buyer app JavaScript + CSS bundle budget exceeded.");
}
