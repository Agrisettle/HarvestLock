import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { Keypair } from "@stellar/stellar-sdk";
import { buildServer } from "../src/server.js";
import { recordBuyerDefault } from "../src/db/reputation.js";

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

beforeAll(async () => {
  const configuredOrigins = process.env.CORS_ORIGINS;
  process.env.CORS_ORIGINS = "http://example.test";
  try {
    app = await buildServer();
  } finally {
    if (configuredOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = configuredOrigins;
  }
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
      expect(res.json()).toEqual({ ok: true, checks: { api: "ok", database: "ok" } });
    },
    15_000,
  );

  it(
    "allows only configured CORS origins",
    async () => {
      const res = await app.inject({
        method: "GET",
        url: "/health",
        headers: { origin: "http://example.test" },
      });
      expect(res.headers["access-control-allow-origin"]).toBe("http://example.test");

      const unlisted = await app.inject({
        method: "GET",
        url: "/health",
        headers: { origin: "https://untrusted.example" },
      });
      expect(unlisted.headers["access-control-allow-origin"]).toBeUndefined();
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
    "GET /commitments works with no query params (defaults, no 500)",
    async () => {
      // The exact bug this guards against: the handler used
      // `Number(req.query.limit) ?? 20`, but Number(undefined) is NaN --
      // never nullish -- so the fallback never applied and a bare
      // GET /commitments sent LIMIT NaN/OFFSET NaN to Postgres, which
      // rejected it with "invalid input syntax for type bigint" → 500.
      // buyer-app and coop-pwa call this route with no query string at
      // all, so that was their production list view broken.
      const bare = await app.inject({ method: "GET", url: "/commitments" });
      expect(bare.statusCode).toBe(200);
      expect(Array.isArray(bare.json())).toBe(true);

      // Garbage values fall back to the same defaults instead of 500ing.
      const garbage = await app.inject({
        method: "GET",
        url: "/commitments?limit=abc&offset=-1",
      });
      expect(garbage.statusCode).toBe(200);
      expect(Array.isArray(garbage.json())).toBe(true);

      // Valid pagination still applies: limit=1 returns at most 1 row.
      const limited = await app.inject({
        method: "GET",
        url: "/commitments?limit=1&offset=0",
      });
      expect(limited.statusCode).toBe(200);
      expect(limited.json().length).toBeLessThanOrEqual(1);
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

  it(
    "rejects remainderWindowSecs below the minimum before touching the network",
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
          claimWindowSecs: "3600",
          remainderWindowSecs: "60",
          deliveryWindowSecs: String(60 * 60 * 24 * 120),
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/remainderWindowSecs must be between/);
    },
    15_000,
  );

  it(
    "rejects remainderWindowSecs above the maximum before touching the network",
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
          claimWindowSecs: "3600",
          remainderWindowSecs: String(60 * 60 * 24 * 365),
          deliveryWindowSecs: String(60 * 60 * 24 * 120),
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/remainderWindowSecs must be between/);
    },
    15_000,
  );

  it(
    "rejects deliveryWindowSecs below the minimum before touching the network",
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
          claimWindowSecs: "3600",
          remainderWindowSecs: String(60 * 60 * 24 * 7),
          deliveryWindowSecs: "60",
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/deliveryWindowSecs must be between/);
    },
    15_000,
  );

  it(
    "rejects deliveryWindowSecs above the maximum before touching the network",
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
          claimWindowSecs: "3600",
          remainderWindowSecs: String(60 * 60 * 24 * 7),
          deliveryWindowSecs: String(60 * 60 * 24 * 1000),
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/deliveryWindowSecs must be between/);
    },
    15_000,
  );

  // A payload that clears all three window checks, so these tests
  // actually exercise the quantity/grade-schedule validation below them,
  // not an earlier guard.
  const validWindows = {
    claimWindowSecs: "3600",
    remainderWindowSecs: String(60 * 60 * 24 * 7),
    deliveryWindowSecs: String(60 * 60 * 24 * 120),
  };

  it(
    "rejects a zero contractedQuantity before touching the network",
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
          ...validWindows,
          contractedQuantity: 0,
          gradePriceBps: [10_000],
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/contractedQuantity must be a positive integer/);
    },
    15_000,
  );

  it(
    "rejects an empty gradePriceBps array before touching the network",
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
          ...validWindows,
          contractedQuantity: 1_000,
          gradePriceBps: [],
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/gradePriceBps must be a non-empty array/);
    },
    15_000,
  );

  it(
    "rejects a gradePriceBps entry over 10000 before touching the network",
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
          ...validWindows,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000, 10_001],
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/gradePriceBps must be a non-empty array/);
    },
    15_000,
  );

  it(
    "rejects an oracleConfig with a malformed oracleContract before touching the network",
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
          ...validWindows,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000],
          oracleConfig: { oracleContract: "not-a-real-contract-id", priceAsset: "NGN", maxAgeSecs: "3600" },
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/not a valid contract ID/);
    },
    15_000,
  );

  it(
    "rejects an oracleConfig with an empty priceAsset before touching the network",
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
          ...validWindows,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000],
          oracleConfig: { oracleContract: FAKE_CONTRACT_ID, priceAsset: "  ", maxAgeSecs: "3600" },
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/priceAsset must be a non-empty string/);
    },
    15_000,
  );

  it(
    "rejects an oracleConfig with a zero maxAgeSecs before touching the network",
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
          ...validWindows,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000],
          oracleConfig: { oracleContract: FAKE_CONTRACT_ID, priceAsset: "NGN", maxAgeSecs: "0" },
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/maxAgeSecs must be a positive integer/);
    },
    15_000,
  );

  it(
    "rejects an oracleConfig with a non-numeric denominatedAmount before touching the network",
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
          ...validWindows,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000],
          oracleConfig: {
            oracleContract: FAKE_CONTRACT_ID,
            priceAsset: "NGN",
            maxAgeSecs: "3600",
            denominatedAmount: "not-a-number",
          },
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/denominatedAmount must be an integer/);
    },
    15_000,
  );

  it(
    "rejects an oracleConfig with a zero denominatedAmount before touching the network",
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
          ...validWindows,
          contractedQuantity: 1_000,
          gradePriceBps: [10_000],
          oracleConfig: { oracleContract: FAKE_CONTRACT_ID, priceAsset: "NGN", maxAgeSecs: "3600", denominatedAmount: "0" },
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/denominatedAmount must be positive/);
    },
    15_000,
  );

  it(
    "rejects a malformed contract ID on confirm-delivery before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: "/commitments/not-a-real-contract-id/tx/confirm-delivery",
        payload: { deliveredQuantity: 500, gradeIndex: 0, sourcePublicKey: FAKE_PUBLIC_KEY },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/not a valid contract ID/);
    },
    15_000,
  );

  it(
    "rejects a negative deliveredQuantity on confirm-delivery before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/confirm-delivery`,
        payload: { deliveredQuantity: -1, gradeIndex: 0, sourcePublicKey: FAKE_PUBLIC_KEY },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/deliveredQuantity must be a non-negative integer/);
    },
    15_000,
  );

  it(
    "rejects a negative gradeIndex on confirm-delivery before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/confirm-delivery`,
        payload: { deliveredQuantity: 500, gradeIndex: -1, sourcePublicKey: FAKE_PUBLIC_KEY },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/gradeIndex must be a non-negative integer/);
    },
    15_000,
  );

  it(
    "rejects a malformed contract ID on flag-dispute before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: "/commitments/not-a-real-contract-id/tx/flag-dispute",
        payload: { flagger: FAKE_PUBLIC_KEY, sourcePublicKey: FAKE_PUBLIC_KEY },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/not a valid contract ID/);
    },
    15_000,
  );

  it(
    "rejects a malformed flagger address on flag-dispute before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/flag-dispute`,
        payload: { flagger: "not-a-real-address", sourcePublicKey: FAKE_PUBLIC_KEY },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/flagger is not a valid public key/);
    },
    15_000,
  );

  it(
    "rejects an empty members array on set-allocation before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/set-allocation`,
        payload: { members: [], sourcePublicKey: FAKE_PUBLIC_KEY },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/members must be a non-empty array/);
    },
    15_000,
  );

  it(
    "rejects a member with an empty phoneNumber on set-allocation before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/set-allocation`,
        payload: { members: [{ phoneNumber: "", shareBps: 5_000 }], sourcePublicKey: FAKE_PUBLIC_KEY },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/non-empty phoneNumber/);
    },
    15_000,
  );

  it(
    "rejects a member with shareBps over 10000 on set-allocation before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/set-allocation`,
        payload: { members: [{ phoneNumber: "+2348012345678", shareBps: 10_001 }], sourcePublicKey: FAKE_PUBLIC_KEY },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/shareBps must be an integer between 0 and 10000/);
    },
    15_000,
  );

  it(
    "rejects members whose shareBps sum over 10000 on set-allocation before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/set-allocation`,
        payload: {
          members: [
            { phoneNumber: "+2348012345678", shareBps: 6_000 },
            { phoneNumber: "+2348098765432", shareBps: 5_000 },
          ],
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/shareBps sum to 11000/);
    },
    15_000,
  );

  it(
    "rejects a malformed contract ID on set-allocation before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: "/commitments/not-a-real-contract-id/tx/set-allocation",
        payload: { members: [{ phoneNumber: "+2348012345678", shareBps: 5_000 }], sourcePublicKey: FAKE_PUBLIC_KEY },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/not a valid contract ID/);
    },
    15_000,
  );

  it(
    "rejects a malformed contract ID on GET .../allocation before touching the network",
    async () => {
      const res = await app.inject({ method: "GET", url: "/commitments/not-a-real-contract-id/allocation" });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/not a valid contract ID/);
    },
    15_000,
  );

  it(
    "rejects a malformed memberHash on the erasure endpoint",
    async () => {
      const res = await app.inject({ method: "DELETE", url: "/allocation-members/not-a-real-hash" });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/64-character hex string/);
    },
    15_000,
  );

  it(
    "returns 404 erasing a memberHash that was never recorded",
    async () => {
      const res = await app.inject({ method: "DELETE", url: `/allocation-members/${"0".repeat(64)}` });
      expect(res.statusCode).toBe(404);
    },
    15_000,
  );

  it(
    "rejects a malformed buyer address on initialize before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/initialize`,
        payload: {
          buyer: "not-a-real-address",
          cooperative: FAKE_PUBLIC_KEY,
          warehouseOperator: FAKE_PUBLIC_KEY,
          token: FAKE_CONTRACT_ID,
          totalAmount: "1000000000",
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: "3600",
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/buyer is not a valid public key/);
    },
    15_000,
  );

  it(
    "rejects initialize with 403 when the buyer address is barred",
    async () => {
      // Seeds real reputation state directly (same DB the running server
      // instance reads from) -- this is the enforcement half of the
      // buyer-default consequence: expire_remainder_window bars a buyer
      // off-chain (see test/reputation.test.ts), and requireNotBarred in
      // server.ts is what actually stops that address from appearing on a
      // *new* commitment. Fires before window-bounds validation, so the
      // payload here can otherwise be minimal.
      const barredBuyer = Keypair.random().publicKey();
      await recordBuyerDefault(barredBuyer, "CFAKECONTRACTFORTEST");

      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/initialize`,
        payload: {
          buyer: barredBuyer,
          cooperative: FAKE_PUBLIC_KEY,
          warehouseOperator: FAKE_PUBLIC_KEY,
          token: FAKE_CONTRACT_ID,
          totalAmount: "1000000000",
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: "3600",
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/barred/);
    },
    15_000,
  );

  it(
    "rejects initialize with 403 when the cooperative address is barred",
    async () => {
      const barredCooperative = Keypair.random().publicKey();
      await recordBuyerDefault(barredCooperative, "CFAKECONTRACTFORTEST");

      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/initialize`,
        payload: {
          buyer: FAKE_PUBLIC_KEY,
          cooperative: barredCooperative,
          warehouseOperator: FAKE_PUBLIC_KEY,
          token: FAKE_CONTRACT_ID,
          totalAmount: "1000000000",
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: "3600",
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/barred/);
    },
    15_000,
  );

  it(
    "GET /parties/:address/standing returns a clean default for an address with no history",
    async () => {
      const freshAddress = Keypair.random().publicKey();
      const res = await app.inject({ method: "GET", url: `/parties/${freshAddress}/standing` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        address: freshAddress,
        strike_count: 0,
        barred: false,
        barred_reason: null,
        barred_at: null,
      });
    },
    15_000,
  );

  it(
    "rejects a malformed newBuyer on the reassign-buyer route before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/reassign-buyer`,
        payload: { newBuyer: "not-a-real-address", sourcePublicKey: FAKE_PUBLIC_KEY },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/newBuyer is not a valid public key/);
    },
    15_000,
  );

  it(
    "rejects a malformed contract ID on cancel/propose before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: "/commitments/not-a-real-contract-id/tx/cancel/propose",
        payload: { proposerPublicKey: FAKE_PUBLIC_KEY },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/not a valid contract ID/);
    },
    15_000,
  );

  it(
    "rejects a malformed proposerPublicKey on cancel/propose before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/cancel/propose`,
        payload: { proposerPublicKey: "not-a-real-address" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/proposerPublicKey is not a valid public key/);
    },
    15_000,
  );

  it(
    "GET cancel/propose returns no active proposal for a contract that's never had one",
    async () => {
      const res = await app.inject({ method: "GET", url: `/commitments/${FAKE_CONTRACT_ID}/tx/cancel/propose` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ proposal: null });
    },
    15_000,
  );

  it(
    "rejects a malformed contract ID on reassign-buyer/propose before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: "/commitments/not-a-real-contract-id/tx/reassign-buyer/propose",
        payload: { proposerPublicKey: FAKE_PUBLIC_KEY, newBuyer: FAKE_PUBLIC_KEY },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/not a valid contract ID/);
    },
    15_000,
  );

  it(
    "rejects a malformed proposerPublicKey on reassign-buyer/propose before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/reassign-buyer/propose`,
        payload: { proposerPublicKey: "not-a-real-address", newBuyer: FAKE_PUBLIC_KEY },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/proposerPublicKey is not a valid public key/);
    },
    15_000,
  );

  it(
    "rejects a malformed newBuyer on reassign-buyer/propose before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/reassign-buyer/propose`,
        payload: { proposerPublicKey: FAKE_PUBLIC_KEY, newBuyer: "not-a-real-address" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/newBuyer is not a valid public key/);
    },
    15_000,
  );

  it(
    "GET reassign-buyer/propose returns no active proposal for a contract that's never had one",
    async () => {
      const res = await app.inject({ method: "GET", url: `/commitments/${FAKE_CONTRACT_ID}/tx/reassign-buyer/propose` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ proposal: null });
    },
    15_000,
  );

  it(
    "rejects a malformed contract ID on resolve-dispute/propose before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: "/commitments/not-a-real-contract-id/tx/resolve-dispute/propose",
        payload: { proposerPublicKey: FAKE_PUBLIC_KEY },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/not a valid contract ID/);
    },
    15_000,
  );

  it(
    "rejects a malformed proposerPublicKey on resolve-dispute/propose before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/resolve-dispute/propose`,
        payload: { proposerPublicKey: "not-a-real-address" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/proposerPublicKey is not a valid public key/);
    },
    15_000,
  );

  it(
    "GET resolve-dispute/propose returns no active proposal for a contract that's never had one",
    async () => {
      const res = await app.inject({ method: "GET", url: `/commitments/${FAKE_CONTRACT_ID}/tx/resolve-dispute/propose` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ proposal: null });
    },
    15_000,
  );

  it(
    "rejects signing a proposal that doesn't exist",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/propose/00000000-0000-0000-0000-000000000000/sign`,
        payload: { signerPublicKey: FAKE_PUBLIC_KEY, signedEntryXdr: "AAAA" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/no pending proposal/);
    },
    15_000,
  );

  it(
    "rejects a malformed signerPublicKey on the sign route before touching the network",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/propose/00000000-0000-0000-0000-000000000000/sign`,
        payload: { signerPublicKey: "not-a-real-address", signedEntryXdr: "AAAA" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/signerPublicKey is not a valid public key/);
    },
    15_000,
  );
});

/**
 * Regression coverage for the global rate limiter actually engaging.
 * Before the fix (buildServer's `app.register(rateLimit, ...)` not being
 * awaited — @fastify/rate-limit attaches via an `onRoute` hook that only
 * fires for routes defined *after* the plugin body runs, and an
 * un-awaited register defers that body until boot, i.e. after every
 * route was already defined), the limiter silently never applied to any
 * route: 110 rapid requests produced zero 429s and not one
 * x-ratelimit-* header. The whole suite runs with NODE_ENV=test (which
 * deliberately skips the limiter so the other tests' rapid-fire
 * requests don't trip it), so proving the limiter works at all needs a
 * second instance built with the flag flipped off.
 */
describe("rate limiting (limiter engages; 429 carries Retry-After)", () => {
  let limitedApp: FastifyInstance;

  beforeAll(async () => {
    // Built here, not at file scope: only this describe block should pay
    // the cost, and flipping NODE_ENV even briefly could affect the
    // shared `app` if it were constructed later. Deliberately never
    // closed — its onClose hook calls pool.end() on the process-wide
    // pool singleton (see the file header), and the shared `app`'s
    // afterAll owns that close. Leaving it open leaks no handles:
    // Fastify without listen() holds no port and @fastify/rate-limit's
    // LocalStore is a plain LRU with no timers.
    const savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      limitedApp = await buildServer();
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
    }
  });

  it(
    "enforces the per-IP limit and answers a 429 with Retry-After",
    async () => {
      // The limiter keys on req.ip, and inject() always presents the
      // same address, so every request here shares one bucket — same as
      // a single client hammering the API from one IP.
      const first = await limitedApp.inject({ method: "GET", url: "/health" });
      expect(first.statusCode).toBe(200);
      // Under the limit, the rate-limit headers are already visible —
      // the earliest observable sign the limiter is engaged at all
      // (pre-fix, no response ever carried these).
      expect(first.headers["x-ratelimit-limit"]).toBe("100");

      // Requests 2..100 (first consumed 1): all still allowed.
      for (let i = 0; i < 99; i++) {
        const res = await limitedApp.inject({ method: "GET", url: "/health" });
        expect(res.statusCode).toBe(200);
      }

      // Request 101: over max — the 429 with its backoff header.
      const blocked = await limitedApp.inject({ method: "GET", url: "/health" });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers["x-ratelimit-remaining"]).toBe("0");
      const retryAfter = blocked.headers["retry-after"];
      expect(retryAfter).toBeDefined();
      // Whole seconds remaining in the window, not a fixed constant —
      // observed counting down in real time against a live server.
      expect(Number(retryAfter)).toBeGreaterThan(0);
      expect(Number(retryAfter)).toBeLessThanOrEqual(60);
      // Same {statusCode, error, message} shape setErrorHandler
      // reproduces for every other error — the limiter's thrown error
      // passes through that handler's generic branch.
      expect(blocked.json()).toEqual({
        statusCode: 429,
        error: "Too Many Requests",
        message: expect.stringMatching(/^Rate limit exceeded/),
      });
    },
    30_000,
  );
});
