import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Keeps postman/harvestlock-api.postman_collection.json honest: every
 * route registered in src/server.ts (and every method the generic
 * /tx/:method route accepts) must have a request in the collection, and
 * the collection must not keep requests for routes that no longer exist.
 * Reads both files as text; no server, database or network involved.
 */

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverSource = readFileSync(join(apiDir, "src/server.ts"), "utf8");

interface CollectionItem {
  name: string;
  item?: CollectionItem[];
  request?: { method: string; url: { path: string[] } };
}

const collection = JSON.parse(
  readFileSync(join(apiDir, "postman/harvestlock-api.postman_collection.json"), "utf8"),
) as { item: CollectionItem[] };

function flatten(items: CollectionItem[]): CollectionItem[] {
  return items.flatMap((item) => (item.item ? flatten(item.item) : [item]));
}

const requests = flatten(collection.item).map((item) => ({
  name: item.name,
  method: item.request!.method,
  segments: item.request!.url.path,
}));

const routes = [
  ...serverSource.matchAll(/app\.(get|post|put|patch|delete)(?:<(?:[^<>]|<[^<>]*>)*>)?\(\s*"([^"]+)"/g),
].map(([, method = "", path = ""]) => ({
  method: method.toUpperCase(),
  segments: path.split("/").filter(Boolean),
}));

const noArgBlock = /const NO_ARG_METHODS = new Set\(\[([\s\S]*?)\]\);/.exec(serverSource)?.[1] ?? "";
const noArgMethods = [...noArgBlock.matchAll(/^\s*"([a-z0-9_]+)",/gm)].map(([, name = ""]) => name);

const isRouteParam = (segment: string) => segment.startsWith(":");
const isCollectionVar = (segment: string) => /^\{\{\w+\}\}$/.test(segment);

function matches(route: { method: string; segments: string[] }, request: { method: string; segments: string[] }) {
  return (
    route.method === request.method &&
    route.segments.length === request.segments.length &&
    route.segments.every(
      (segment, i) =>
        segment === request.segments[i] ||
        (isRouteParam(segment) && (isCollectionVar(request.segments[i] ?? "") || segment === ":method")),
    )
  );
}

describe("Postman collection", () => {
  it("parses a sensible number of routes and no-arg methods out of server.ts", () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(noArgMethods).toContain("lock");
    expect(noArgMethods).toContain("expire_dispute_window");
  });

  it("has a request for every route in server.ts", () => {
    const missing = routes.filter((route) => !requests.some((request) => matches(route, request)));
    expect(missing.map((r) => `${r.method} /${r.segments.join("/")}`)).toEqual([]);
  });

  it("has a request for every method the generic /tx/:method route accepts", () => {
    const missing = noArgMethods.filter(
      (method) =>
        !requests.some(
          (request) =>
            request.method === "POST" &&
            request.segments.length === 4 &&
            request.segments[0] === "commitments" &&
            request.segments[2] === "tx" &&
            request.segments[3] === method,
        ),
    );
    expect(missing).toEqual([]);
  });

  it("has no requests for routes that no longer exist", () => {
    const stale = requests.filter((request) => {
      const isNoArgCall =
        request.method === "POST" &&
        request.segments.length === 4 &&
        request.segments[2] === "tx" &&
        !routes.some((route) => route.segments[3] === request.segments[3] && route.segments.length === 4);
      if (isNoArgCall) return !noArgMethods.includes(request.segments[3] ?? "");
      return !routes.some((route) => matches(route, request));
    });
    expect(stale.map((r) => r.name)).toEqual([]);
  });
});
