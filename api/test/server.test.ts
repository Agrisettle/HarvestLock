import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { Keypair, Account, StrKey, Address, xdr, rpc, TransactionBuilder, BASE_FEE, Operation, nativeToScVal } from "@stellar/stellar-sdk";
import { randomBytes } from "node:crypto";
import { buildServer } from "../src/server.js";
import * as txModule from "../src/stellar/tx.js";
import * as clientModule from "../src/stellar/client.js";
import type { Commitment } from "../src/stellar/client.js";
import { recordBuyerDefault } from "../src/db/reputation.js";
import { pool } from "../src/db/pool.js";
import { server as rpcServer, networkPassphrase } from "../src/stellar/rpc.js";
import { MAX_PAGE_SIZE } from "../src/db/commitments.js";
import * as commitmentsDb from "../src/db/commitments.js";
import * as allocationDb from "../src/db/allocationMembers.js";
import { recordAllocationMembers, stageAllocationMembers } from "../src/db/allocationMembers.js";
import { createProposal } from "../src/db/pendingMultisigProposals.js";
import { ContractError, contractErrorFromSimulation } from "../src/errors.js";

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

/** Seeds `count` fake cached rows with the given contract_id prefix, so
 * pagination tests can walk real pages through the real route. Values
 * satisfy 001_init.sql's CHECKs but are otherwise arbitrary; created_at
 * is left to its default, so every row of one INSERT shares a single
 * now() — exactly the timestamp tie the route's ORDER BY ... id tiebreak
 * exists to break. Callers clean up by the same prefix in a finally. */
async function seedCommitments(prefix: string, count: number): Promise<void> {
  await pool.query(
    `INSERT INTO commitments
       (contract_id, buyer_address, cooperative_address, warehouse_address, token_address,
        total_amount, advance1_bps, advance2_bps, claim_window_secs, status)
     SELECT p.prefix || i, 'GBUYER', 'GCOOP', 'GWH', 'GCACHE', 1000, 1500, 2000, 3600, 'Locked'
     FROM (SELECT $1::text AS prefix) p, generate_series(1, $2::int) i`,
    [prefix, count],
  );
}

/**
 * A complete, plausible on-chain commitment for tests that stub the live
 * read. Only `status` varies between callers here; the rest just has to
 * satisfy the cache table's NOT NULL/CHECK constraints so
 * `upsertCommitment` can persist it.
 */
function fakeCommitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    buyer: FAKE_PUBLIC_KEY,
    cooperative: FAKE_PUBLIC_KEY,
    warehouse_operator: FAKE_PUBLIC_KEY,
    token: FAKE_CONTRACT_ID,
    total_amount: 1_000_000_000n,
    advance1_bps: 1500,
    advance2_bps: 2000,
    claim_window_secs: 3600n,
    remainder_window_secs: 3600n,
    status: "Locked",
    created_at: 0n,
    delivery_deadline: 0n,
    advance1_deadline: 0n,
    advance1_claimed: false,
    advance1_expired: false,
    advance2_deadline: 0n,
    advance2_claimed: false,
    advance2_expired: false,
    remainder_deadline: 0n,
    remainder_funded: false,
    contracted_quantity: 1_000,
    grade_price_bps: [10_000],
    delivered_quantity: 0,
    grade_index: 0,
    settlement_bps: 0,
    fx_resolved: false,
    fx_adjusted_total: 0n,
    fx_shortfall_amount: 0n,
    fx_shortfall_funded: false,
    fx_shortfall_deadline: 0n,
    dispute_pre_status: "Draft",
    dispute_deadline: 0n,
    ...overrides,
  };
}

/**
 * A syntactically valid base64 SorobanAuthorizationEntry — the sign route
 * parses signedEntryXdr before looking the proposal up (issue #202), so a
 * test that means to exercise "proposal not found" has to send something
 * that parses. Nothing verifies its contents at this layer; a
 * source-account-credential entry with an empty cancel() invocation is
 * about as small as a valid one gets.
 */
function validAuthEntryXdr(): string {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(FAKE_CONTRACT_ID).toScAddress(),
        functionName: "cancel",
        args: [],
      }),
    ),
    subInvocations: [],
  });
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: invocation,
  }).toXDR("base64");
}

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
  it("GET /version responds with build metadata without requiring a database read", async () => {
    const priorCommit = process.env.RENDER_GIT_COMMIT;
    const priorTimestamp = process.env.BUILD_TIMESTAMP;
    process.env.RENDER_GIT_COMMIT = "test-commit-sha";
    process.env.BUILD_TIMESTAMP = "2026-10-22T12:00:00.000Z";
    try {
      const res = await app.inject({ method: "GET", url: "/version" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        commitSha: "test-commit-sha",
        buildTimestamp: "2026-10-22T12:00:00.000Z",
      });
    } finally {
      if (priorCommit === undefined) delete process.env.RENDER_GIT_COMMIT;
      else process.env.RENDER_GIT_COMMIT = priorCommit;
      if (priorTimestamp === undefined) delete process.env.BUILD_TIMESTAMP;
      else process.env.BUILD_TIMESTAMP = priorTimestamp;
    }
  });

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
    "GET /commitments pages exactly at the page boundary (a full page, then one more)",
    async () => {
      // Issue #225's "done looks like": seed past one page and walk the
      // boundary. Five rows: with limit=5 that is exactly one page, and
      // with limit=2 it is one full page, a second full page, then one
      // more — the two shapes a client's "load next page" logic turns on.
      const prefix = "CTESTPAGE";
      const total = 5;
      await seedCommitments(prefix, total);
      try {
        // Exactly one page: the whole set fits, and the page after it is
        // empty rather than an error or a repeat of the last page.
        const onePage = await app.inject({
          method: "GET",
          url: `/commitments?limit=${total}&offset=0`,
        });
        expect(onePage.statusCode).toBe(200);
        expect(onePage.json()).toHaveLength(total);

        const pastTheEnd = await app.inject({
          method: "GET",
          url: `/commitments?limit=${total}&offset=${total}`,
        });
        expect(pastTheEnd.statusCode).toBe(200);
        expect(pastTheEnd.json()).toHaveLength(0);

        // One more than one page: 2 + 2 + 1 partitions the five rows —
        // no gap, no duplicate across page edges. The dupes/skips this
        // guards are real: every seeded row shares one created_at, and
        // ORDER BY created_at alone let Postgres order ties differently
        // per request.
        const pages = [];
        for (const offset of [0, 2, 4]) {
          const res = await app.inject({
            method: "GET",
            url: `/commitments?limit=2&offset=${offset}`,
          });
          expect(res.statusCode).toBe(200);
          pages.push(res.json() as { contract_id: string }[]);
        }
        expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);

        const walked = pages
          .flat()
          .map((c) => c.contract_id)
          .filter((id) => id.startsWith(prefix));
        expect(walked).toHaveLength(total);
        expect(new Set(walked).size).toBe(total);
      } finally {
        await pool.query(`DELETE FROM commitments WHERE contract_id LIKE $1`, [`${prefix}%`]);
      }
    },
    30_000,
  );

  it(
    "GET /commitments clamps an oversized limit instead of returning an unbounded page",
    async () => {
      // The other half of issue #225: falling back on *invalid* limits
      // still left any *valid* limit free to ask for the whole cache
      // (limit=1000000). Seed MAX_PAGE_SIZE + 5 rows and prove the route
      // caps the page at MAX_PAGE_SIZE rather than passing the requested
      // number through to Postgres.
      const prefix = "CTESTCLAMP";
      await seedCommitments(prefix, MAX_PAGE_SIZE + 5);
      try {
        const res = await app.inject({
          method: "GET",
          url: "/commitments?limit=1000000&offset=0",
        });
        expect(res.statusCode).toBe(200);
        const rows = res.json() as { contract_id: string }[];
        expect(rows).toHaveLength(MAX_PAGE_SIZE);
        expect(rows.every((c) => c.contract_id.startsWith(prefix))).toBe(true);
      } finally {
        await pool.query(`DELETE FROM commitments WHERE contract_id LIKE $1`, [`${prefix}%`]);
      }
    },
    30_000,
  );

  it(
    "two concurrent GET /commitments/:contractId refreshes race the cache write without erroring or duplicating the row",
    async () => {
      // Issue #132's boundary: two refreshes for the same contract land
      // at once, so both handlers are inside upsertCommitment's
      // SELECT ... FOR UPDATE at the same time rather than one finishing
      // before the other starts. The mock holds the first live read until
      // the second arrives, making that overlap deterministic; whichever
      // order Postgres grants the row lock, the second writer must see
      // the first one's committed status (not the null it would have seen
      // without FOR UPDATE), and the ON CONFLICT upsert must leave exactly
      // one row.
      const contractId = StrKey.encodeContract(randomBytes(32));
      const statuses = ["Locked", "Funded"];
      let readsArrived = 0;
      let releaseReads!: () => void;
      const bothReadsArrived = new Promise<void>((resolve) => {
        releaseReads = resolve;
      });

      const getCommitmentMock = vi.spyOn(clientModule, "getCommitment").mockImplementation(async () => {
        const status = statuses[readsArrived]!;
        readsArrived += 1;
        if (readsArrived === statuses.length) releaseReads();
        await bothReadsArrived;
        return fakeCommitment({ status });
      });
      // Call through to the real upsert, but keep each returned promise so
      // the test can prove both writes actually completed: the route
      // catches cache-refresh failures (deliberately — a read-only cache
      // write must not mask a live chain read), so two 200s alone
      // wouldn't distinguish "both wrote" from "one wrote, one failed".
      const upsertSpy = vi.spyOn(commitmentsDb, "upsertCommitment");

      try {
        await pool.query("DELETE FROM commitments WHERE contract_id = $1", [contractId]);

        const [first, second] = await Promise.all([
          app.inject({ method: "GET", url: `/commitments/${contractId}` }),
          app.inject({ method: "GET", url: `/commitments/${contractId}` }),
        ]);

        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(200);
        expect(new Set([first.json().status, second.json().status])).toEqual(new Set(statuses));

        expect(upsertSpy.mock.results).toHaveLength(2);
        const results = await Promise.all(
          upsertSpy.mock.results.map((result) => result.value as ReturnType<typeof commitmentsDb.upsertCommitment>),
        );

        // Exactly one writer created the row and saw no prior status; the
        // other was serialized behind it and saw the first writer's
        // status. Two nulls would mean the lock didn't hold; a null plus
        // anything other than one of the statuses above would mean the
        // second read raced a half-written row.
        const previousStatuses = results.map((result) => result.previousStatus);
        expect(previousStatuses.filter((status) => status === null)).toHaveLength(1);
        const observed = previousStatuses.filter((status): status is string => status !== null);
        expect(observed).toHaveLength(1);
        expect(statuses).toContain(observed[0]);

        const { rows } = await pool.query<{ status: string }>(
          "SELECT status FROM commitments WHERE contract_id = $1",
          [contractId],
        );
        expect(rows).toHaveLength(1);
        expect(statuses).toContain(rows[0]!.status);
      } finally {
        getCommitmentMock.mockRestore();
        upsertSpy.mockRestore();
        await pool.query("DELETE FROM commitments WHERE contract_id = $1", [contractId]);
      }
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
      expect(res.json().message).toMatch(/unknown or unsupported method/);
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
          remainderWindowSecs: "3599",
          deliveryWindowSecs: String(60 * 60 * 24 * 120),
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/remainderWindowSecs must be between/);
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
          remainderWindowSecs: String(60 * 60 * 24 * 30 + 1),
          deliveryWindowSecs: String(60 * 60 * 24 * 120),
          sourcePublicKey: FAKE_PUBLIC_KEY,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/remainderWindowSecs must be between/);
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

  const minClaimWindowSecs = 3_600;
  const maxClaimWindowSecs = 90 * 24 * 60 * 60;
  const claimWindowArgIndex = 7;
  const validWindowPayload = {
    buyer: FAKE_PUBLIC_KEY,
    cooperative: FAKE_PUBLIC_KEY,
    warehouseOperator: FAKE_PUBLIC_KEY,
    token: FAKE_CONTRACT_ID,
    totalAmount: "1000000000",
    advance1Bps: 1500,
    advance2Bps: 2000,
    ...validWindows,
    contractedQuantity: 1,
    gradePriceBps: [10_000],
    sourcePublicKey: FAKE_PUBLIC_KEY,
  };

  it.each([minClaimWindowSecs, maxClaimWindowSecs])(
    "accepts claimWindowSecs of %i seconds and encodes it for initialize",
    async (claimWindowSecs) => {
      const buildInvoke = vi.spyOn(txModule, "buildInvokeTransaction").mockResolvedValue("FAKE-UNSIGNED-XDR");
      try {
        const res = await app.inject({
          method: "POST",
          url: `/commitments/${FAKE_CONTRACT_ID}/tx/initialize`,
          payload: { ...validWindowPayload, claimWindowSecs: String(claimWindowSecs) },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ xdr: "FAKE-UNSIGNED-XDR" });
        expect(buildInvoke).toHaveBeenCalledTimes(1);
        const invocation = buildInvoke.mock.calls[0]?.[0];
        expect(invocation?.method).toBe("initialize");
        expect(invocation?.args?.[claimWindowArgIndex]).toEqual(
          nativeToScVal(BigInt(claimWindowSecs), { type: "u64" }),
        );
      } finally {
        buildInvoke.mockRestore();
      }
    },
    15_000,
  );

  it.each([minClaimWindowSecs - 1, maxClaimWindowSecs + 1])(
    "rejects claimWindowSecs of %i seconds before building a transaction",
    async (claimWindowSecs) => {
      const buildInvoke = vi.spyOn(txModule, "buildInvokeTransaction").mockResolvedValue("FAKE-UNSIGNED-XDR");
      try {
        const res = await app.inject({
          method: "POST",
          url: `/commitments/${FAKE_CONTRACT_ID}/tx/initialize`,
          payload: { ...validWindowPayload, claimWindowSecs: String(claimWindowSecs) },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/claimWindowSecs must be between/);
        expect(buildInvoke).not.toHaveBeenCalled();
      } finally {
        buildInvoke.mockRestore();
      }
    },
    15_000,
  );

  const minDeliveryWindowSecs = 86_400;
  const maxDeliveryWindowSecs = 365 * 86_400;
  const deliveryWindowArgIndex = 9;

  it.each([minDeliveryWindowSecs, maxDeliveryWindowSecs])(
    "accepts deliveryWindowSecs of %i seconds and encodes it for initialize",
    async (deliveryWindowSecs) => {
      const buildInvoke = vi.spyOn(txModule, "buildInvokeTransaction").mockResolvedValue("FAKE-UNSIGNED-XDR");
      try {
        const res = await app.inject({
          method: "POST",
          url: `/commitments/${FAKE_CONTRACT_ID}/tx/initialize`,
          payload: { ...validWindowPayload, deliveryWindowSecs: String(deliveryWindowSecs) },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ xdr: "FAKE-UNSIGNED-XDR" });
        expect(buildInvoke).toHaveBeenCalledTimes(1);
        const invocation = buildInvoke.mock.calls[0]?.[0];
        expect(invocation?.method).toBe("initialize");
        expect(invocation?.args?.[deliveryWindowArgIndex]).toEqual(
          nativeToScVal(BigInt(deliveryWindowSecs), { type: "u64" }),
        );
      } finally {
        buildInvoke.mockRestore();
      }
    },
    15_000,
  );

  it.each([minDeliveryWindowSecs - 1, maxDeliveryWindowSecs + 1])(
    "rejects deliveryWindowSecs of %i seconds before building a transaction",
    async (deliveryWindowSecs) => {
      const buildInvoke = vi.spyOn(txModule, "buildInvokeTransaction").mockResolvedValue("FAKE-UNSIGNED-XDR");
      try {
        const res = await app.inject({
          method: "POST",
          url: `/commitments/${FAKE_CONTRACT_ID}/tx/initialize`,
          payload: { ...validWindowPayload, deliveryWindowSecs: String(deliveryWindowSecs) },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/deliveryWindowSecs must be between/);
        expect(buildInvoke).not.toHaveBeenCalled();
      } finally {
        buildInvoke.mockRestore();
      }
    },
    15_000,
  );

  it("accepts remainderWindowSecs at both inclusive boundaries", async () => {
    const buildInvoke = vi.spyOn(txModule, "buildInvokeTransaction").mockResolvedValue("FAKE-UNSIGNED-XDR");
    try {
      for (const remainderWindowSecs of ["3600", String(60 * 60 * 24 * 30)]) {
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
            remainderWindowSecs,
            contractedQuantity: 1,
            gradePriceBps: [10_000],
            sourcePublicKey: FAKE_PUBLIC_KEY,
          },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ xdr: "FAKE-UNSIGNED-XDR" });
      }
      expect(buildInvoke).toHaveBeenCalledTimes(2);
    } finally {
      buildInvoke.mockRestore();
    }
  }, 15_000);

  it(
    "rejects a contractedQuantity of 0 (one below the smallest valid value) before touching the network",
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
      expect(res.json().message).toMatch(/contractedQuantity must be a positive integer/);
    },
    15_000,
  );

  it(
    "accepts a contractedQuantity of exactly 1 (the smallest valid value)",
    async () => {
      // Same pattern as the gradePriceBps ceiling test below: the builder is
      // stubbed so this stays a validation-boundary test with no network
      // call. A 200 proves 1 cleared the route's `contractedQuantity <= 0`
      // guard -- the exact off-by-one the zero case can't isolate, since it
      // is rejected either way.
      const buildInvoke = vi
        .spyOn(txModule, "buildInvokeTransaction")
        .mockResolvedValue("FAKE-UNSIGNED-XDR");
      try {
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
            contractedQuantity: 1,
            gradePriceBps: [10_000],
            sourcePublicKey: FAKE_PUBLIC_KEY,
          },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ xdr: "FAKE-UNSIGNED-XDR" });
        expect(buildInvoke).toHaveBeenCalledTimes(1);
      } finally {
        buildInvoke.mockRestore();
      }
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
      expect(res.json().message).toMatch(/gradePriceBps must be a non-empty array/);
    },
    15_000,
  );

  it(
    "accepts a gradePriceBps entry at exactly 10000 (the inclusive ceiling)",
    async () => {
      // The builder is stubbed so this stays a validation-boundary test with
      // no network call. Reaching it with a 200 is the proof that 10000
      // passed the route's `bps > 10_000` guard -- the exact off-by-one the
      // existing [10_000, 10_001] case can't isolate, since that request is
      // rejected for 10_001 regardless of how 10_000 behaves.
      const buildInvoke = vi
        .spyOn(txModule, "buildInvokeTransaction")
        .mockResolvedValue("FAKE-UNSIGNED-XDR");
      try {
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
            sourcePublicKey: FAKE_PUBLIC_KEY,
          },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ xdr: "FAKE-UNSIGNED-XDR" });
        expect(buildInvoke).toHaveBeenCalledTimes(1);
      } finally {
        buildInvoke.mockRestore();
      }
    },
    15_000,
  );

  it(
    "rejects a gradePriceBps entry at 10001 (one past the inclusive ceiling) before touching the network",
    async () => {
      // Stubbed only so a regression can't fall through to testnet -- the
      // assertion is that validation stops the request before the builder.
      const buildInvoke = vi
        .spyOn(txModule, "buildInvokeTransaction")
        .mockResolvedValue("FAKE-UNSIGNED-XDR");
      try {
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
            gradePriceBps: [10_001],
            sourcePublicKey: FAKE_PUBLIC_KEY,
          },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/gradePriceBps must be a non-empty array/);
        expect(buildInvoke).not.toHaveBeenCalled();
      } finally {
        buildInvoke.mockRestore();
      }
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
      expect(res.json().message).toMatch(/priceAsset must be a non-empty string/);
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
      expect(res.json().message).toMatch(/maxAgeSecs must be a positive integer/);
    },
    15_000,
  );

  it(
    "accepts oracleConfig.maxAgeSecs at its smallest valid value of 1",
    async () => {
      const buildInvoke = vi.spyOn(txModule, "buildInvokeTransaction").mockResolvedValue("FAKE-UNSIGNED-XDR");
      try {
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
            contractedQuantity: 1,
            gradePriceBps: [10_000],
            oracleConfig: {
              oracleContract: FAKE_CONTRACT_ID,
              priceAsset: "NGN",
              maxAgeSecs: "1",
              denominatedAmount: "1000",
            },
            sourcePublicKey: FAKE_PUBLIC_KEY,
          },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ xdr: "FAKE-UNSIGNED-XDR" });
        expect(buildInvoke).toHaveBeenCalledTimes(1);
      } finally {
        buildInvoke.mockRestore();
      }
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
      expect(res.json().message).toMatch(/denominatedAmount must be an integer/);
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
      expect(res.json().message).toMatch(/denominatedAmount must be positive/);
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
      expect(res.json().message).toMatch(/deliveredQuantity must be a non-negative integer/);
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
      expect(res.json().message).toMatch(/gradeIndex must be a non-negative integer/);
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
      expect(res.json().message).toMatch(/members must be a non-empty array/);
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
      expect(res.json().message).toMatch(/non-empty phoneNumber/);
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
      expect(res.json().message).toMatch(/shareBps must be an integer between 0 and 10000/);
    },
    15_000,
  );

  it(
    "accepts members whose shareBps sum to exactly 10000 (the inclusive ceiling)",
    async () => {
      // The builder is stubbed so this stays a validation-boundary test with
      // no network call. A 200 is the proof that a total of exactly 10000
      // cleared the route's `totalBps > 10_000` guard.
      const buildInvoke = vi
        .spyOn(txModule, "buildInvokeTransaction")
        .mockResolvedValue("FAKE-UNSIGNED-XDR");
      try {
        const res = await app.inject({
          method: "POST",
          url: `/commitments/${FAKE_CONTRACT_ID}/tx/set-allocation`,
          payload: {
            members: [
              { phoneNumber: "+2348012345678", shareBps: 6_000 },
              { phoneNumber: "+2348098765432", shareBps: 4_000 },
            ],
            sourcePublicKey: FAKE_PUBLIC_KEY,
          },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().xdr).toBe("FAKE-UNSIGNED-XDR");
        expect(res.json().members.map((m: { shareBps: number }) => m.shareBps)).toEqual([6_000, 4_000]);
        expect(buildInvoke).toHaveBeenCalledTimes(1);
      } finally {
        buildInvoke.mockRestore();
      }
    },
    15_000,
  );

  it(
    "rejects members whose shareBps sum to 10001 (one over the inclusive ceiling)",
    async () => {
      // Stubbed only so a regression can't fall through to testnet -- the
      // assertion is that the sum guard stops the request before the builder.
      // Each member's own shareBps is valid (<= 10000); only the total is
      // one past the boundary, which isolates the sum check from the
      // per-member one above.
      const buildInvoke = vi
        .spyOn(txModule, "buildInvokeTransaction")
        .mockResolvedValue("FAKE-UNSIGNED-XDR");
      try {
        const res = await app.inject({
          method: "POST",
          url: `/commitments/${FAKE_CONTRACT_ID}/tx/set-allocation`,
          payload: {
            members: [
              { phoneNumber: "+2348012345678", shareBps: 6_000 },
              { phoneNumber: "+2348098765432", shareBps: 4_001 },
            ],
            sourcePublicKey: FAKE_PUBLIC_KEY,
          },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/shareBps sum to 10001/);
        expect(buildInvoke).not.toHaveBeenCalled();
      } finally {
        buildInvoke.mockRestore();
      }
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

  it.each([
    { label: "unknown tx method", method: "POST", url: `/commitments/${FAKE_CONTRACT_ID}/tx/not_a_real_method`, payload: { sourcePublicKey: FAKE_PUBLIC_KEY } },
    { label: "confirm-delivery quantity", method: "POST", url: `/commitments/${FAKE_CONTRACT_ID}/tx/confirm-delivery`, payload: { deliveredQuantity: -1, gradeIndex: 0, sourcePublicKey: FAKE_PUBLIC_KEY } },
    { label: "confirm-delivery grade", method: "POST", url: `/commitments/${FAKE_CONTRACT_ID}/tx/confirm-delivery`, payload: { deliveredQuantity: 5, gradeIndex: -1, sourcePublicKey: FAKE_PUBLIC_KEY } },
    { label: "initialize window", method: "POST", url: `/commitments/${FAKE_CONTRACT_ID}/tx/initialize`, payload: { totalAmount: "1000000000", claimWindowSecs: "1", sourcePublicKey: FAKE_PUBLIC_KEY } },
    { label: "initialize amount", method: "POST", url: `/commitments/${FAKE_CONTRACT_ID}/tx/initialize`, payload: { totalAmount: "abc", sourcePublicKey: FAKE_PUBLIC_KEY } },
    { label: "set-allocation members", method: "POST", url: `/commitments/${FAKE_CONTRACT_ID}/tx/set-allocation`, payload: { members: [], sourcePublicKey: FAKE_PUBLIC_KEY } },
    { label: "erasure memberHash", method: "DELETE", url: "/allocation-members/not-a-real-hash", payload: undefined },
  ] as const)("returns the {statusCode, error, message} envelope for $label", async ({ method, url, payload }) => {
    const res = await app.inject({ method, url, payload });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["error", "message", "statusCode"]);
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe("Bad Request");
    expect(typeof body.message).toBe("string");
  });

  it(
    "rejects a malformed memberHash on the erasure endpoint",
    async () => {
      const res = await app.inject({ method: "DELETE", url: "/allocation-members/not-a-real-hash" });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/64-character hex string/);
    },
    15_000,
  );

  it(
    "returns 404 erasing a memberHash that was never recorded",
    async () => {
      const res = await app.inject({ method: "DELETE", url: `/allocation-members/${"0".repeat(64)}` });
      expect(res.statusCode).toBe(404);
      expect(Object.keys(res.json()).sort()).toEqual(["error", "message", "statusCode"]);
      expect(res.json()).toMatchObject({ statusCode: 404, error: "Not Found" });
    },
    15_000,
  );

  it(
    "DELETE /allocation-members/:memberHash called twice is an accepted no-op the second time, preserving the first erased_at",
    async () => {
      // Two DELETEs for exactly the same recorded hash: the first is a
      // real erasure; the second must still be found (the row survives with
      // phone_number nulled, unlike a genuinely unknown hash above), so it
      // returns 200 rather than 404. eraseAllocationMember's COALESCE must
      // also keep the original erased_at instead of re-stamping it, or the
      // record would misreport when the NDPA erasure actually happened.
      const contractId = StrKey.encodeContract(randomBytes(32));
      const [member] = stageAllocationMembers([{ phoneNumber: "+2348012345678", shareBps: 6_000 }]);
      await recordAllocationMembers(contractId, [member!]);

      try {
        const first = await app.inject({
          method: "DELETE",
          url: `/allocation-members/${member!.memberHash}`,
        });
        expect(first.statusCode).toBe(200);
        expect(first.json()).toEqual({ erased: true });

        const afterFirst = await pool.query<{ phone_number: string | null; erased_at: string | null }>(
          "SELECT phone_number, erased_at::text AS erased_at FROM allocation_members WHERE member_hash = $1",
          [member!.memberHash],
        );
        expect(afterFirst.rows).toHaveLength(1);
        expect(afterFirst.rows[0]!.phone_number).toBeNull();
        expect(afterFirst.rows[0]!.erased_at).not.toBeNull();

        const second = await app.inject({
          method: "DELETE",
          url: `/allocation-members/${member!.memberHash}`,
        });
        expect(second.statusCode).toBe(200);
        expect(second.json()).toEqual({ erased: true });

        const afterSecond = await pool.query<{ phone_number: string | null; erased_at: string | null }>(
          "SELECT phone_number, erased_at::text AS erased_at FROM allocation_members WHERE member_hash = $1",
          [member!.memberHash],
        );
        expect(afterSecond.rows).toHaveLength(1);
        expect(afterSecond.rows[0]!.phone_number).toBeNull();
        expect(afterSecond.rows[0]!.erased_at).toBe(afterFirst.rows[0]!.erased_at);
      } finally {
        await pool.query("DELETE FROM allocation_members WHERE contract_id = $1", [contractId]);
      }
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
      // Unique per run: standing_events is UNIQUE (contract_id, event_type),
      // so a fixed fake ID would conflict with an earlier run's event and
      // skip the bar this test depends on.
      await recordBuyerDefault(barredBuyer, `CFAKE${barredBuyer}`);

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
      await recordBuyerDefault(barredCooperative, `CFAKE${barredCooperative}`);

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
        payload: { signerPublicKey: FAKE_PUBLIC_KEY, signedEntryXdr: validAuthEntryXdr() },
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

  /**
   * Issue #205 — bad-input audit of the dispute routes. The malformed
   * contract ID case was already covered above; these lock in the same
   * discipline for the two other ways a bad request used to fall through
   * to an unhandled 500:
   *
   * 1. a bad/missing/non-string sourcePublicKey reached the SDK's
   *    Keypair.fromPublicKey() (via server.getAccount()), which throws a
   *    plain Error with no status code — 500;
   * 2. a POST with no body at all left req.body undefined and crashed
   *    reading a field off it — TypeError, also 500.
   *
   * Both are client-input errors, so both must be 400 with a message
   * naming the field. The first sweep covers the routes the issue names
   * (flag-dispute and the generic no-arg path resolve_dispute/
   * expire_dispute_window go through) plus every other tx builder that
   * takes a sourcePublicKey, per the issue's "applied everywhere it
   * should be".
   */
  describe("dispute-route bad-input audit (400s, never unhandled 500s)", () => {
    const tx = `/commitments/${FAKE_CONTRACT_ID}/tx`;

    // One otherwise-valid payload per route; only sourcePublicKey varies.
    it.each([
      ["flag-dispute", `${tx}/flag-dispute`, { flagger: FAKE_PUBLIC_KEY }],
      ["the generic no-arg route (resolve_dispute)", `${tx}/resolve_dispute`, {}],
      ["the generic no-arg route (expire_dispute_window)", `${tx}/expire_dispute_window`, {}],
      [
        "initialize",
        `${tx}/initialize`,
        {
          buyer: FAKE_PUBLIC_KEY,
          cooperative: FAKE_PUBLIC_KEY,
          warehouseOperator: FAKE_PUBLIC_KEY,
          token: FAKE_CONTRACT_ID,
          totalAmount: "1000000000",
          advance1Bps: 1500,
          advance2Bps: 2000,
          claimWindowSecs: "3600",
          remainderWindowSecs: "86400",
          deliveryWindowSecs: "86400",
          contractedQuantity: 1_000,
          gradePriceBps: [10_000],
        },
      ],
      ["confirm-delivery", `${tx}/confirm-delivery`, { deliveredQuantity: 500, gradeIndex: 0 }],
      ["set-allocation", `${tx}/set-allocation`, { members: [{ phoneNumber: "+2348012345678", shareBps: 5_000 }] }],
      ["reassign-buyer", `${tx}/reassign-buyer`, { newBuyer: FAKE_PUBLIC_KEY }],
    ])("rejects a malformed sourcePublicKey on %s before touching the network", async (_route, url, payload) => {
      const res = await app.inject({
        method: "POST",
        url,
        payload: { ...payload, sourcePublicKey: "not-a-real-address" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/sourcePublicKey is not a valid public key/);
    });

    // The same field, but absent or the wrong type rather than
    // malformed — StrKey's validator answers false for both, so both
    // must land on the same 400 rather than reach the SDK.
    it.each([
      ["a missing sourcePublicKey", { flagger: FAKE_PUBLIC_KEY }],
      ["a non-string sourcePublicKey", { flagger: FAKE_PUBLIC_KEY, sourcePublicKey: 42 }],
    ])("rejects %s on flag-dispute with 400, not 500", async (_label, payload) => {
      const res = await app.inject({ method: "POST", url: `${tx}/flag-dispute`, payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/sourcePublicKey is not a valid public key/);
    });

    // No Content-Type header, no payload at all: Fastify leaves the body
    // undefined. The preValidation normalization in server.ts turns that
    // into an empty object so each route's own field validation answers
    // (flag-dispute names `flagger`, the generic route names
    // `sourcePublicKey`, propose names `proposerPublicKey`) — anything
    // but the old TypeError 500.
    it.each([
      ["flag-dispute", `${tx}/flag-dispute`],
      ["the generic no-arg route (resolve_dispute)", `${tx}/resolve_dispute`],
      ["the generic no-arg route (expire_dispute_window)", `${tx}/expire_dispute_window`],
      ["resolve-dispute/propose", `${tx}/resolve-dispute/propose`],
    ])("answers a POST with no body at all on %s with 400, not a TypeError 500", async (_route, url) => {
      const res = await app.inject({ method: "POST", url });
      expect(res.statusCode).toBe(400);
    });
  });

  /**
   * Issue #201 — bad-input audit of POST /commitments/deploy and
   * POST .../tx/initialize. Reproduced before the fix, all as opaque
   * 500s leaking raw internals: `BigInt("abc")` for a non-numeric
   * totalAmount (or missing entirely), NaN windows sailing past both
   * range comparisons only to throw in `BigInt()` afterwards, negative
   * or non-integer advance bps reaching nativeToScVal's u32 encoder,
   * oversized quantities hitting its range guard, and oversized i128
   * amounts knocking on `nativeToScVal`'s i128 bounds. Each is
   * unambiguously caller input and must be a 400 naming the field.
   *
   * /commitments/deploy itself takes no caller-supplied values at all
   * (no params, no body fields — the deployer key and WASM hash come
   * from env), so its only client-input rejection is Fastify's own body
   * parser before the handler ever runs; that's the one lock-in below.
   */
  describe("deploy/initialize bad-input audit (issue #201)", () => {
    const validInitializeBody = () => ({
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
      sourcePublicKey: FAKE_PUBLIC_KEY,
    });

    it(
      "rejects a malformed contract ID on initialize with 400, not an SDK 500",
      async () => {
        const res = await app.inject({
          method: "POST",
          url: "/commitments/not-a-real-contract-id/tx/initialize",
          payload: validInitializeBody(),
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/not a valid contract ID/);
      },
      15_000,
    );

    it.each<{ label: string; overrides: Record<string, unknown>; pattern: RegExp }>([
      // Windows: previously NaN (from a non-numeric or missing value)
      // passed both `< MIN` and `> MAX`, then BigInt("abc") threw.
      { label: "a non-numeric claimWindowSecs", overrides: { claimWindowSecs: "abc" }, pattern: /claimWindowSecs must be between/ },
      { label: "a fractional claimWindowSecs", overrides: { claimWindowSecs: "3600.5" }, pattern: /claimWindowSecs must be between/ },
      { label: "an object claimWindowSecs", overrides: { claimWindowSecs: { secs: 3600 } }, pattern: /claimWindowSecs must be between/ },
      { label: "a missing remainderWindowSecs", overrides: { remainderWindowSecs: undefined }, pattern: /remainderWindowSecs must be between/ },
      { label: "a non-numeric deliveryWindowSecs", overrides: { deliveryWindowSecs: "not-a-number" }, pattern: /deliveryWindowSecs must be between/ },
      // totalAmount: previously BigInt() threw for missing/non-numeric,
      // and nativeToScVal threw for anything past the i128 bound.
      { label: "a missing totalAmount", overrides: { totalAmount: undefined }, pattern: /totalAmount must be an integer/ },
      { label: "a non-numeric totalAmount", overrides: { totalAmount: "not-a-number" }, pattern: /totalAmount must be an integer/ },
      { label: "a fractional totalAmount", overrides: { totalAmount: "1.5" }, pattern: /totalAmount must be an integer/ },
      { label: "a zero totalAmount", overrides: { totalAmount: "0" }, pattern: /totalAmount must be positive/ },
      { label: "a totalAmount beyond i128", overrides: { totalAmount: (2n ** 127n).toString() }, pattern: /out of range for a 128-bit integer/ },
      // Advance bps: previously unvalidated, so strings, negatives and
      // u32-overflow values all surfaced as raw encoder errors.
      { label: "a non-numeric advance1Bps", overrides: { advance1Bps: "abc" }, pattern: /advance1Bps must be an integer between 0 and 10000/ },
      { label: "a negative advance2Bps", overrides: { advance2Bps: -1 }, pattern: /advance2Bps must be an integer between 0 and 10000/ },
      { label: "an over-10000 advance1Bps", overrides: { advance1Bps: 10_001 }, pattern: /advance1Bps must be an integer between 0 and 10000/ },
      { label: "an oversized contractedQuantity", overrides: { contractedQuantity: 0x1_0000_0000 }, pattern: /contractedQuantity must be a positive integer/ },
      // Oracle config: "1e21" is Number()-integer but BigInt() throws on
      // it, and a denominatedAmount past i128 hit nativeToScVal.
      {
        label: "an oracleConfig maxAgeSecs that is not a safe integer",
        overrides: {
          oracleConfig: { oracleContract: FAKE_CONTRACT_ID, priceAsset: "NGN", maxAgeSecs: "1e21", denominatedAmount: "1000" },
        },
        pattern: /maxAgeSecs must be a positive integer/,
      },
      {
        label: "an oracleConfig denominatedAmount beyond i128",
        overrides: {
          oracleConfig: {
            oracleContract: FAKE_CONTRACT_ID,
            priceAsset: "NGN",
            maxAgeSecs: "3600",
            denominatedAmount: (2n ** 127n).toString(),
          },
        },
        pattern: /out of range for a 128-bit integer/,
      },
    ])("rejects $label on initialize with 400, not a 500", async ({ overrides, pattern }) => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/initialize`,
        payload: { ...validInitializeBody(), ...overrides },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(pattern);
    });

    it(
      "rejects a malformed JSON body on /commitments/deploy with Fastify's own 400, not an unhandled 500",
      async () => {
        // The route has no fields of its own to reject, so the only
        // caller-controlled rejection it can produce is the body
        // parser's — asserted here so the whole #201 group is covered.
        const res = await app.inject({
          method: "POST",
          url: "/commitments/deploy",
          payload: "{ not json",
          headers: { "content-type": "application/json" },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/not valid JSON/);
      },
      15_000,
    );
  });

  /**
   * Issue #202 — bad-input audit of the propose/sign multi-party routes.
   * The propose routes' contract-ID and proposer/newBuyer checks were
   * already in place (covered by the tests above); the two gaps this
   * locks in are both on the sign route:
   *
   * 1. `pending_multisig_proposals.id` is a Postgres UUID column, so a
   *    non-UUID proposalId made the driver throw `invalid input syntax
   *    for type uuid` — an opaque 500.
   * 2. `signedEntryXdr` was never checked: a missing/non-string value
   *    was persisted as-is (JSON.stringify drops `undefined`, so the
   *    entry then read as "signed" with nothing in it) and a malformed
   *    one was stored to explode much later inside
   *    finalizeMultiPartyProposal's `fromXDR()` — a 500 on a different
   *    request than the one that supplied the bad value.
   */
  describe("propose/sign multi-party bad-input audit (issue #202)", () => {
    // A real pending row, so the signedEntryXdr cases exercise the path
    // that used to accept the value; a nonexistent proposal would 400
    // for an unrelated reason. Random contract ID, so this row can't
    // leak into the "no active proposal" assertions above.
    const proposalContractId = StrKey.encodeContract(randomBytes(32));
    let proposalId: string;

    beforeAll(async () => {
      const row = await createProposal({
        contractId: proposalContractId,
        method: "cancel",
        proposerAddress: FAKE_PUBLIC_KEY,
        funcXdr: "AAAA",
        sorobanDataXdr: "AAAA",
        entries: [{ address: FAKE_PUBLIC_KEY, entryXdr: "AAAA", signedEntryXdr: null }],
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      proposalId = row.id;
    });

    afterAll(async () => {
      await pool.query("DELETE FROM pending_multisig_proposals WHERE id = $1", [proposalId]);
    });

    it(
      "rejects a malformed proposalId with 400, not a Postgres uuid 500",
      async () => {
        const res = await app.inject({
          method: "POST",
          url: `/commitments/${FAKE_CONTRACT_ID}/tx/propose/not-a-uuid/sign`,
          payload: { signerPublicKey: FAKE_PUBLIC_KEY, signedEntryXdr: "AAAA" },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/proposalId must be a UUID/);
      },
      15_000,
    );

    it.each<{ label: string; payload: Record<string, unknown>; pattern: RegExp }>([
      {
        label: "a missing signedEntryXdr",
        payload: { signerPublicKey: FAKE_PUBLIC_KEY },
        pattern: /signedEntryXdr must be a non-empty string/,
      },
      {
        label: "a non-string signedEntryXdr",
        payload: { signerPublicKey: FAKE_PUBLIC_KEY, signedEntryXdr: 42 },
        pattern: /signedEntryXdr must be a non-empty string/,
      },
      {
        label: "a malformed signedEntryXdr",
        payload: { signerPublicKey: FAKE_PUBLIC_KEY, signedEntryXdr: "not-a-real-entry" },
        pattern: /not a valid base64 Soroban authorization entry/,
      },
    ])("rejects $label on the sign route with 400, not an opaque 500", async ({ payload, pattern }) => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${proposalContractId}/tx/propose/${proposalId}/sign`,
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(pattern);
    });

    it.each<{ label: string; url: string }>([
      { label: "cancel/propose", url: `/commitments/${FAKE_CONTRACT_ID}/tx/cancel/propose` },
      { label: "reassign-buyer/propose", url: `/commitments/${FAKE_CONTRACT_ID}/tx/reassign-buyer/propose` },
      { label: "the sign route", url: `/commitments/${FAKE_CONTRACT_ID}/tx/propose/00000000-0000-0000-0000-000000000000/sign` },
    ])("answers a bodyless POST on $label with 400, not a TypeError 500", async ({ url }) => {
      const res = await app.inject({ method: "POST", url });
      expect(res.statusCode).toBe(400);
    });

    it.each<{ label: string; url: string; payload: Record<string, unknown>; pattern: RegExp }>([
      {
        label: "a non-string proposerPublicKey on cancel/propose",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/cancel/propose`,
        payload: { proposerPublicKey: 42 },
        pattern: /proposerPublicKey is not a valid public key/,
      },
      {
        label: "an object newBuyer on reassign-buyer/propose",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/reassign-buyer/propose`,
        payload: { proposerPublicKey: FAKE_PUBLIC_KEY, newBuyer: {} },
        pattern: /newBuyer is not a valid public key/,
      },
      {
        label: "a non-string proposerPublicKey on resolve-dispute/propose",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/resolve-dispute/propose`,
        payload: { proposerPublicKey: 42 },
        pattern: /proposerPublicKey is not a valid public key/,
      },
    ])("rejects $label with 400, not a 500", async ({ url, payload, pattern }) => {
      const res = await app.inject({ method: "POST", url, payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(pattern);
    });
  });

  /**
   * Issue #203 — bad-input audit of the allocation-ledger routes.
   * GET .../allocation (malformed contract ID) and DELETE
   * /allocation-members/:memberHash (malformed hash) already had 400
   * coverage above; this locks in the one gap left on set-allocation:
   * a JSON array element that isn't an object (null, a number, a bare
   * string) crashed reading `.phoneNumber` off it with a TypeError — a
   * 500 for what is plainly bad client input.
   */
  describe("allocation-ledger bad-input audit (issue #203)", () => {
    const validAllocationBody = {
      members: [{ phoneNumber: "+2348012345678", shareBps: 5_000 }],
      sourcePublicKey: FAKE_PUBLIC_KEY,
    };

    it.each<{ label: string; members: unknown[]; pattern: RegExp }>([
      { label: "a null member", members: [null], pattern: /non-empty phoneNumber/ },
      { label: "a number member", members: [42], pattern: /non-empty phoneNumber/ },
      { label: "a string member", members: ["+2348012345678"], pattern: /non-empty phoneNumber/ },
      { label: "a member missing shareBps", members: [{ phoneNumber: "+2348012345678" }], pattern: /shareBps must be an integer/ },
      {
        label: "a member with a string shareBps",
        members: [{ phoneNumber: "+2348012345678", shareBps: "5000" }],
        pattern: /shareBps must be an integer/,
      },
    ])("rejects $label on set-allocation with 400, not a TypeError 500", async ({ members, pattern }) => {
      const res = await app.inject({
        method: "POST",
        url: `/commitments/${FAKE_CONTRACT_ID}/tx/set-allocation`,
        payload: { ...validAllocationBody, members },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(pattern);
    });

    it(
      "rejects a non-array members value on set-allocation with 400",
      async () => {
        const res = await app.inject({
          method: "POST",
          url: `/commitments/${FAKE_CONTRACT_ID}/tx/set-allocation`,
          payload: { members: "not-an-array", sourcePublicKey: FAKE_PUBLIC_KEY },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/members must be a non-empty array/);
      },
      15_000,
    );
  });

  /**
   * Issue #204 — bad-input audit of the oracle read routes. Both routes'
   * only caller-supplied value is the contractId path param, and
   * requireValidContractId was already applied to each — no code fix
   * needed, these tests just lock the 400 behavior in for the routes the
   * issue names (same coverage the allocation/commitment reads already
   * had). The G... case matters: a syntactically valid StrKey that is
   * simply the wrong key type must still be a clear 400, not an SDK
   * account-vs-contract decoding 500.
   */
  describe("oracle read bad-input audit (issue #204)", () => {
    it.each(["oracle-config", "oracle-rate"])(
      "rejects a malformed contract ID on GET .../%s with 400, not an SDK 500",
      async (route) => {
        const res = await app.inject({ method: "GET", url: `/commitments/not-a-real-contract-id/${route}` });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/not a valid contract ID/);
      },
      15_000,
    );

    it.each(["oracle-config", "oracle-rate"])(
      "rejects a G... account address in place of a contract ID on GET .../%s",
      async (route) => {
        const res = await app.inject({ method: "GET", url: `/commitments/${FAKE_PUBLIC_KEY}/${route}` });
        expect(res.statusCode).toBe(400);
        expect(res.json().message).toMatch(/not a valid contract ID/);
      },
      15_000,
    );
  });
});

/**
 * Contract rejections are ordinary business outcomes, not server faults:
 * the API must return the contract's own code/name as structured fields
 * (issue #404) instead of the opaque 500 every bare Error used to get.
 * These tests drive the real routes/handler; the two read cases stub only
 * the RPC boundary so the actual simulation-error translation in
 * stellar/client.ts is what runs.
 */
describe("contract error translation (issue #404)", () => {
  it(
    "buildInvokeTransaction translates a simulation rejection instead of throwing a bare Error",
    async () => {
      const getAccount = vi
        .spyOn(rpcServer, "getAccount")
        .mockResolvedValue(new Account(FAKE_PUBLIC_KEY, "1"));
      const simulate = vi
        .spyOn(rpcServer, "simulateTransaction")
        .mockResolvedValue({ error: "HostError: Error(Contract, #8)" } as never);
      try {
        const err = await txModule
          .buildInvokeTransaction({
            contractId: FAKE_CONTRACT_ID,
            method: "claim_advance_1",
            sourcePublicKey: FAKE_PUBLIC_KEY,
          })
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(ContractError);
        expect((err as ContractError).statusCode).toBe(409);
        expect((err as ContractError).contractError).toEqual({ code: 8, name: "AlreadyClaimed" });
      } finally {
        getAccount.mockRestore();
        simulate.mockRestore();
      }
    },
    15_000,
  );

  it(
    "returns 409 with contractError.code/name when the build simulation rejects a write",
    async () => {
      const diagnostic =
        'HostError: Error(Contract, #8)\n\nEvent log (newest first):\n   0: [diagnostic event] topics:[symbol: "FnCall"]';
      const buildInvoke = vi
        .spyOn(txModule, "buildInvokeTransaction")
        .mockRejectedValueOnce(contractErrorFromSimulation("claim_advance_1", diagnostic)!);
      try {
        const res = await app.inject({
          method: "POST",
          url: `/commitments/${FAKE_CONTRACT_ID}/tx/claim_advance_1`,
          payload: { sourcePublicKey: FAKE_PUBLIC_KEY },
        });

        expect(res.statusCode).toBe(409);
        expect(res.json()).toMatchObject({
          statusCode: 409,
          error: "Conflict",
          contractError: { code: 8, name: "AlreadyClaimed" },
        });
        expect(res.json().message).toMatch(/AlreadyClaimed/);
      } finally {
        buildInvoke.mockRestore();
      }
    },
    15_000,
  );

  it.each([
    ["uninitialized (#2)", "HostError: Error(Contract, #2)", { code: 2, name: "NotInitialized" }],
    [
      "a missing contract instance",
      "HostError: Error(Storage, MissingValue)",
      { code: null, name: "ContractNotFound" },
    ],
  ])("returns 404 when a read hits %s", async (_label, diagnostic, expectedContractError) => {
    const savedKey = process.env.DEPLOYER_SECRET_KEY;
    process.env.DEPLOYER_SECRET_KEY = Keypair.random().secret();
    const getAccount = vi
      .spyOn(rpcServer, "getAccount")
      .mockResolvedValue(new Account(Keypair.random().publicKey(), "1"));
    const simulate = vi
      .spyOn(rpcServer, "simulateTransaction")
      .mockResolvedValue({ error: diagnostic } as never);
    try {
      const res = await app.inject({ method: "GET", url: `/commitments/${FAKE_CONTRACT_ID}` });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        statusCode: 404,
        error: "Not Found",
        contractError: expectedContractError,
      });
    } finally {
      getAccount.mockRestore();
      simulate.mockRestore();
      if (savedKey === undefined) delete process.env.DEPLOYER_SECRET_KEY;
      else process.env.DEPLOYER_SECRET_KEY = savedKey;
    }
  });

  it(
    "leaves a genuine RPC/transport failure as a 500 with no contractError",
    async () => {
      const getCommitment = vi
        .spyOn(clientModule, "getCommitment")
        .mockRejectedValueOnce(new Error("fetch failed"));
      try {
        const res = await app.inject({ method: "GET", url: `/commitments/${FAKE_CONTRACT_ID}` });

        expect(res.statusCode).toBe(500);
        expect(res.json().message).toMatch(/fetch failed/);
        expect(res.json().contractError).toBeUndefined();
      } finally {
        getCommitment.mockRestore();
      }
    },
    15_000,
  );
});

/**
 * Issue #405: a transaction the network accepted but that missed the
 * 30-second confirmation poll must not be reported as a failure. These
 * tests stub the RPC boundary (no live network) but drive the real
 * routes, the real pending_submissions table, and the real side-effect
 * helper.
 */
describe("pending submissions (issue #405)", () => {
  // Fixed, valid 64-hex hashes so cleanup is deterministic. A real
  // Stellar hash would work identically; the route/RPC are both stubbed.
  const PENDING_HASH = "a".repeat(64);
  const FAILED_HASH = "b".repeat(64);
  const UNKNOWN_HASH = "c".repeat(64);

  async function createTestProposal(): Promise<string> {
    const row = await createProposal({
      contractId: FAKE_CONTRACT_ID,
      method: "set_allocation",
      proposerAddress: FAKE_PUBLIC_KEY,
      funcXdr: "AAAA",
      sorobanDataXdr: "AAAA",
      entries: [],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    return row.id;
  }

  it("returns 202 with the hash, then applies stored side effects exactly once on the first SUCCESS poll", async () => {
    const proposalId = await createTestProposal();
    const staged = stageAllocationMembers([{ phoneNumber: "+2348012345678", shareBps: 6_000 }]);
    const submit = vi
      .spyOn(txModule, "submitSignedTransaction")
      .mockResolvedValueOnce({ status: "PENDING", hash: PENDING_HASH });
    const record = vi.spyOn(allocationDb, "recordAllocationMembers").mockResolvedValue(undefined);
    const get = vi.spyOn(rpcServer, "getTransaction");
    try {
      const submitted = await app.inject({
        method: "POST",
        url: "/transactions/submit",
        payload: {
          xdr: "AAAA",
          completeProposalId: proposalId,
          allocationContractId: FAKE_CONTRACT_ID,
          allocationMembers: staged,
        },
      });

      expect(submitted.statusCode).toBe(202);
      expect(submitted.json()).toEqual({ status: "PENDING", hash: PENDING_HASH });

      const stored = await pool.query(
        `SELECT status, complete_proposal_id, allocation_contract_id, allocation_members, side_effects_applied_at
         FROM pending_submissions WHERE hash = $1`,
        [PENDING_HASH],
      );
      expect(stored.rows[0]).toMatchObject({
        status: "pending",
        complete_proposal_id: proposalId,
        allocation_contract_id: FAKE_CONTRACT_ID,
        side_effects_applied_at: null,
      });
      expect(stored.rows[0].allocation_members).toEqual(staged);
      expect(record).not.toHaveBeenCalled();

      // Still NOT_FOUND on chain: report PENDING and run nothing.
      get.mockResolvedValue({ status: rpc.Api.GetTransactionStatus.NOT_FOUND } as never);
      const stillPending = await app.inject({ method: "GET", url: `/transactions/${PENDING_HASH}` });
      expect(stillPending.statusCode).toBe(200);
      expect(stillPending.json()).toEqual({ status: "PENDING", hash: PENDING_HASH });
      expect(record).not.toHaveBeenCalled();

      get.mockResolvedValue({ status: rpc.Api.GetTransactionStatus.SUCCESS } as never);

      const first = await app.inject({ method: "GET", url: `/transactions/${PENDING_HASH}` });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ status: "SUCCESS", hash: PENDING_HASH });
      expect(record).toHaveBeenCalledTimes(1);

      const completed = await pool.query("SELECT status FROM pending_multisig_proposals WHERE id = $1", [
        proposalId,
      ]);
      expect(completed.rows[0].status).toBe("completed");

      const applied = await pool.query(
        "SELECT status, side_effects_applied_at FROM pending_submissions WHERE hash = $1",
        [PENDING_HASH],
      );
      expect(applied.rows[0].status).toBe("success");
      expect(applied.rows[0].side_effects_applied_at).not.toBeNull();

      // Polling again reports the same terminal answer without re-running
      // anything (or even asking the chain again).
      const second = await app.inject({ method: "GET", url: `/transactions/${PENDING_HASH}` });
      expect(second.json()).toEqual({ status: "SUCCESS", hash: PENDING_HASH });
      expect(record).toHaveBeenCalledTimes(1);
      // One NOT_FOUND poll + one SUCCESS poll; the terminal poll after
      // that was answered from Postgres.
      expect(get).toHaveBeenCalledTimes(2);
    } finally {
      submit.mockRestore();
      record.mockRestore();
      get.mockRestore();
      await pool.query("DELETE FROM pending_submissions WHERE hash = $1", [PENDING_HASH]);
      await pool.query("DELETE FROM pending_multisig_proposals WHERE id = $1", [proposalId]);
    }
  }, 15_000);

  it("reports FAILED and runs no side effects for a transaction that landed but failed", async () => {
    const proposalId = await createTestProposal();
    const staged = stageAllocationMembers([{ phoneNumber: "+2348099999999", shareBps: 4_000 }]);
    const submit = vi
      .spyOn(txModule, "submitSignedTransaction")
      .mockResolvedValueOnce({ status: "PENDING", hash: FAILED_HASH });
    const record = vi.spyOn(allocationDb, "recordAllocationMembers").mockResolvedValue(undefined);
    const get = vi
      .spyOn(rpcServer, "getTransaction")
      .mockResolvedValue({ status: rpc.Api.GetTransactionStatus.FAILED } as never);
    try {
      const submitted = await app.inject({
        method: "POST",
        url: "/transactions/submit",
        payload: {
          xdr: "AAAA",
          completeProposalId: proposalId,
          allocationContractId: FAKE_CONTRACT_ID,
          allocationMembers: staged,
        },
      });
      expect(submitted.statusCode).toBe(202);

      const failed = await app.inject({ method: "GET", url: `/transactions/${FAILED_HASH}` });
      expect(failed.statusCode).toBe(200);
      expect(failed.json()).toEqual({ status: "FAILED", hash: FAILED_HASH });
      expect(record).not.toHaveBeenCalled();

      const proposal = await pool.query("SELECT status FROM pending_multisig_proposals WHERE id = $1", [
        proposalId,
      ]);
      expect(proposal.rows[0].status).not.toBe("completed");

      const stored = await pool.query("SELECT status FROM pending_submissions WHERE hash = $1", [FAILED_HASH]);
      expect(stored.rows[0].status).toBe("failed");

      // FAILED is terminal too: a second poll answers from the row.
      const second = await app.inject({ method: "GET", url: `/transactions/${FAILED_HASH}` });
      expect(second.json()).toEqual({ status: "FAILED", hash: FAILED_HASH });
      expect(get).toHaveBeenCalledTimes(1);
    } finally {
      submit.mockRestore();
      record.mockRestore();
      get.mockRestore();
      await pool.query("DELETE FROM pending_submissions WHERE hash = $1", [FAILED_HASH]);
      await pool.query("DELETE FROM pending_multisig_proposals WHERE id = $1", [proposalId]);
    }
  }, 15_000);

  it("rejects a malformed hash with 400 and an untracked hash with 404", async () => {
    const malformed = await app.inject({ method: "GET", url: "/transactions/not-a-hash" });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().message).toMatch(/64 hexadecimal/);

    const unknown = await app.inject({ method: "GET", url: `/transactions/${UNKNOWN_HASH}` });
    expect(unknown.statusCode).toBe(404);
  });

  it(
    "submitSignedTransaction returns PENDING instead of throwing when confirmation outlives the poll window",
    async () => {
      const envelope = new TransactionBuilder(new Account(FAKE_PUBLIC_KEY, "1"), {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(Operation.bumpSequence({ bumpTo: "2" }))
        .setTimeout(30)
        .build()
        .toXDR();
      const send = vi
        .spyOn(rpcServer, "sendTransaction")
        .mockResolvedValue({ status: "PENDING", hash: PENDING_HASH } as never);
      const get = vi
        .spyOn(rpcServer, "getTransaction")
        .mockResolvedValue({ status: rpc.Api.GetTransactionStatus.NOT_FOUND } as never);
      vi.useFakeTimers();
      try {
        const promise = txModule.submitSignedTransaction(envelope);
        // Drives the 1.5 s sleeps past the 30 s deadline without waiting.
        // 32 s, not 31: the check runs at exactly 30,000 ms first and
        // needs one more 1.5 s tick to cross the boundary.
        await vi.advanceTimersByTimeAsync(32_000);
        await expect(promise).resolves.toEqual({ status: "PENDING", hash: PENDING_HASH });
      } finally {
        vi.useRealTimers();
        send.mockRestore();
        get.mockRestore();
      }
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
    "allows the 100th request and rejects the 101st (the exact rate-limit boundary)",
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
      expect(first.headers["x-ratelimit-remaining"]).toBe("99");

      // Requests 2..99 (first consumed 1): all still allowed, with the
      // remaining count counting down one per request.
      for (let i = 0; i < 98; i++) {
        const res = await limitedApp.inject({ method: "GET", url: "/health" });
        expect(res.statusCode).toBe(200);
        expect(res.headers["x-ratelimit-remaining"]).toBe(String(98 - i));
      }

      // Request 100: exactly at the limit. This is the last *allowed*
      // request, and the first response to report zero remaining — the
      // inclusive side of the boundary the old loop swallowed.
      const atTheLimit = await limitedApp.inject({ method: "GET", url: "/health" });
      expect(atTheLimit.statusCode).toBe(200);
      expect(atTheLimit.headers["x-ratelimit-remaining"]).toBe("0");

      // Request 101: one past the limit — the first 429, with its backoff
      // header. A limit of 99 or 101 would fail one of the two assertions
      // above/below, so this pins the off-by-one rather than just "the
      // limiter eventually kicks in".
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

describe("POST /commitments/deploy protection", () => {
  let deployApp: FastifyInstance;
  const savedEnv = { ...process.env };

  function stubBalance(xlm: bigint) {
    return vi.spyOn(rpcServer, "getAccountEntry").mockResolvedValue({ balance: xlm * 10_000_000n } as never);
  }

  beforeAll(async () => {
    process.env.DEPLOYER_SECRET_KEY = Keypair.random().secret();
    process.env.DEPLOY_RATE_LIMIT_MAX = "3";
    process.env.NODE_ENV = "development";
    try {
      deployApp = await buildServer();
    } finally {
      process.env.NODE_ENV = savedEnv.NODE_ENV;
      process.env.DEPLOY_RATE_LIMIT_MAX = savedEnv.DEPLOY_RATE_LIMIT_MAX;
      if (savedEnv.DEPLOY_RATE_LIMIT_MAX === undefined) delete process.env.DEPLOY_RATE_LIMIT_MAX;
    }
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (savedEnv.DEPLOYER_SECRET_KEY === undefined) delete process.env.DEPLOYER_SECRET_KEY;
    else process.env.DEPLOYER_SECRET_KEY = savedEnv.DEPLOYER_SECRET_KEY;
  });

  it("returns 503 without submitting anything when the deployer is below the balance floor", async () => {
    stubBalance(1n);
    const send = vi.spyOn(rpcServer, "sendTransaction");
    const res = await deployApp.inject({ method: "POST", url: "/commitments/deploy" });
    expect(res.statusCode).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });

  it("answers 429 on the deploy route well before the global limit", async () => {
    stubBalance(1n);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await deployApp.inject({ method: "POST", url: "/commitments/deploy" })).statusCode);
    }
    // One request was already spent by the 503 test above (same IP bucket).
    expect(statuses).toEqual([503, 503, 429, 429]);
  });
});
