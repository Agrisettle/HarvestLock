import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
const rootBlock = css.match(/:root\s*\{([^}]+)\}/)?.[1];
const lightBlock = css.match(/@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*:root\s*\{([^}]+)\}/)?.[1];

if (!rootBlock || !lightBlock) {
  throw new Error("Could not find both root color palettes in src/index.css");
}

function tokens(block) {
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*(#[\da-fA-F]{6})\s*;/g)].map(([, name, value]) => [name, value]),
  );
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const requiredTextPairs = [
  ["--bone", "--void"],
  ["--bone", "--void-raised"],
  ["--bone-dim", "--void"],
  ["--bone-dim", "--void-raised"],
  ["--bone-faint", "--void"],
  ["--bone-faint", "--void-raised"],
  ["--gold", "--void"],
  ["--gold", "--void-raised"],
  ["--gold-bright", "--void"],
  ["--gold-bright", "--void-raised"],
  ["--signal", "--void"],
  ["--signal", "--void-raised"],
  ["--pine-text", "--pine-soft"],
];

let failed = false;
for (const [theme, palette] of [["dark", tokens(rootBlock)], ["light", tokens(lightBlock)]]) {
  for (const [foreground, background] of requiredTextPairs) {
    const ratio = contrast(palette[foreground], palette[background]);
    const pass = ratio >= 4.5;
    console.log(`${pass ? "PASS" : "FAIL"} ${theme}: ${foreground} on ${background} ${ratio.toFixed(2)}:1`);
    failed ||= !pass;
  }

  const buttonRatio = contrast(palette["--gold-ink"], palette["--gold-fill"]);
  const buttonPass = buttonRatio >= 4.5;
  console.log(`${buttonPass ? "PASS" : "FAIL"} ${theme}: button text on --gold-fill ${buttonRatio.toFixed(2)}:1`);
  failed ||= !buttonPass;
}

if (failed) process.exitCode = 1;
