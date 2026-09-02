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

// Valid StrKey checksums (so requireValidContractId lets requests past to
// the check each test actually means to exercise) but never deployed —
// generated once, not meant to resolve to anything real.
const FAKE_CONTRACT_ID = "CBCEGSHJYB7MKQ7BMWM62LXW4SV2NWNLEYJT6GLGZS3EIV7LO73AZPJI";
const FAKE_PUBLIC_KEY = "GAJLI2MLTLHYPF4H2SCHQ7TJI6XHMHKIG6N5ZHONSTCKK4SWMGLDNLI5";

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
    "rejects a malformed contract ID with 400, not 500",
    async () => {
      // The exact bug this guards against: before requireValidContractId
      // existed, a bad contract ID reached the Stellar SDK unfiltered,
      // which throws a plain Error with no status code -- Fastify's
      // default handling of that is 500, which is wrong for what's
      // unambiguously bad client input, not a server fault.
      const res = await app.inject({ method: "GET", url: "/commitments/not-a-real-contract-id" });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/not a valid contract ID/);
    },
    15_000,
  );

  it(
    "rejects a malformed refreshContractId on submit before submitting anything",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: "/transactions/submit",
        payload: { xdr: "AAAA", refreshContractId: "not-a-real-contract-id" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/not a valid contract ID/);
    },
    15_000,
  );

  it(
    "rejects an unsupported method name on the generic tx builder",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/not_a_real_method`,
        payload: { sourcePublicKey: FAKE_PUBLIC_KEY },
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
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/initialize`,
        payload: {
          buyer: FAKE_PUBLIC_KEY,
          cooperative: FAKE_PUBLIC_KEY,
          warehouseOperator: FAKE_PUBLIC_KEY,
          token: FAKE_CONTRACT_ID,
          totalAmount: "1000000000",
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: "60",
          sourcePublicKey: FAKE_PUBLIC_KEY,
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
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/initialize`,
        payload: {
          buyer: FAKE_PUBLIC_KEY,
          cooperative: FAKE_PUBLIC_KEY,
          warehouseOperator: FAKE_PUBLIC_KEY,
          token: FAKE_CONTRACT_ID,
          totalAmount: "1000000000",
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: String(60 * 60 * 24 * 365),
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/claimWindowSecs must be between/);
    },
    15_000,
  );
});
