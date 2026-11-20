import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const commitSha = process.env.RENDER_GIT_COMMIT?.trim() || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const buildTimestamp = new Date().toISOString();
const outputPath = fileURLToPath(new URL("../dist/build-info.json", import.meta.url));

writeFileSync(outputPath, `${JSON.stringify({ commitSha, buildTimestamp }, null, 2)}\n`);