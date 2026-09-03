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
