import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";

/**
 * First HTTP-layer test coverage for server.ts — everything before this
 * was manual (a scratch script, run by hand, then deleted). Uses
 * Fastify's own `.inject()`, which drives real route/plugin/CORS logic
 * without binding a port. Validation cases here don't touch the network
 * at all (rejected before any Stellar call); routes that do reach the
 * network are covered by stellar.test.ts, not duplicated here.
 *
 * One shared server instance for the whole file, built once and closed
 * once: `buildServer()`'s onClose hook calls `pool.end()` on the
 * module-level Postgres pool singleton (db/pool.ts) — building a fresh
 * server and closing it *per test* hit "Called end on pool more than
 * once" on the second test, since every instance shares that same pool.
 */

let app: FastifyInstance;

beforeAll(() => {
  app = buildServer();
});

afterAll(async () => {
  await app.close();
});

describe("server (HTTP layer)", () => {
  it(
    "GET /health responds ok",
    async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    },
    15_000,
  );

  it(
    "sends CORS headers for a cross-origin request",
    async () => {
      const res = await app.inject({
        method: "GET",
        url: "/health",
        headers: { origin: "http://example.test" },
      });
      expect(res.headers["access-control-allow-origin"]).toBe("http://example.test");
    },
    15_000,
  );

  it(
    "rejects an unsupported method name on the generic tx builder",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: "/commitments/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC/tx/not_a_real_method",
        payload: { sourcePublicKey: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/unknown or unsupported method/);
    },
    15_000,
  );

  it(
    "rejects claimWindowSecs below the minimum before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: "/commitments/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC/tx/initialize",
        payload: {
          buyer: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
          cooperative: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
          warehouseOperator: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
          token: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
          totalAmount: "1000000000",
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: "60",
          sourcePublicKey: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/claimWindowSecs must be between/);
    },
    15_000,
  );

  it(
    "rejects claimWindowSecs above the maximum before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: "/commitments/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC/tx/initialize",
        payload: {
          buyer: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
          cooperative: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
          warehouseOperator: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
          token: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
          totalAmount: "1000000000",
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: String(60 * 60 * 24 * 365),
          sourcePublicKey: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/claimWindowSecs must be between/);
    },
    15_000,
  );
});
