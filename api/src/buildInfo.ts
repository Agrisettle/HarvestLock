import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface BuildInfo {
  commitSha: string;
  buildTimestamp: string;
}

function readBuildInfo(): BuildInfo | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(fileURLToPath(new URL("./build-info.json", import.meta.url)), "utf8"));
    if (
      typeof value === "object" && value !== null &&
      "commitSha" in value && typeof value.commitSha === "string" &&
      "buildTimestamp" in value && typeof value.buildTimestamp === "string"
    ) {
      return { commitSha: value.commitSha, buildTimestamp: value.buildTimestamp };
    }
  } catch {
  }
  return undefined;
}

const buildInfo = readBuildInfo();

export function getBuildInfo(): BuildInfo {
  return {
    commitSha: process.env.RENDER_GIT_COMMIT?.trim() || buildInfo?.commitSha || "unknown",
    buildTimestamp: process.env.BUILD_TIMESTAMP?.trim() || buildInfo?.buildTimestamp || "unknown",
  };
}