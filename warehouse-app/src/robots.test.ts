import { describe, expect, it } from "vitest";
// `?raw` is the same pipeline Vite uses to ship public/ assets, and it
// resolves relative to this file rather than to vitest's cwd.
import robots from "../public/robots.txt?raw";

// This app is an internal operational tool, not public marketing content —
// it must not be indexed (see the reasoning in the robots.txt comment and
// vercel-build.sh). This test is the mechanical guard on that: the file
// exists in public/ (so Vite ships it into the build) and it disallows
// every crawler.
describe("public/robots.txt", () => {
  const lines = robots
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  it("applies to every crawler", () => {
    expect(lines.some((line) => /^user-agent:\s*\*$/i.test(line))).toBe(true);
  });

  it("disallows all crawling", () => {
    expect(lines.some((line) => /^disallow:\s*\/$/i.test(line))).toBe(true);
  });

  it("has no Allow rule that would carve an exception back open", () => {
    expect(lines.some((line) => /^allow:/i.test(line))).toBe(false);
  });
});