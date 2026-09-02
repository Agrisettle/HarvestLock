import Fastify from "fastify";
import cors from "@fastify/cors";
import { StrKey, Address } from "@stellar/stellar-sdk";
import { getCommitment, type Commitment } from "./stellar/client.js";
import { deployContractInstance, initializeArgs } from "./stellar/deploy.js";
import { buildInvokeTransaction, submitSignedTransaction } from "./stellar/tx.js";
import { upsertCommitment, listCommitments } from "./db/commitments.js";
import { pool } from "./db/pool.js";
import { BadRequestError } from "./errors.js";

/**
 * Every route below takes a contract ID at some point. Before this
 * existed, a malformed one (wrong length, bad checksum, a G... account
 * address instead of a C... contract one) reached the Stellar SDK, which
 * throws a plain Error with no status code — Fastify's default handling
 * of that is a 500, which is wrong: it's the caller's bad input, not a
 * server fault. Checked with StrKey.isValidContract, not a regex, since
 * that's the network's own validation, not a guess at its format.
 */
function requireValidContractId(contractId: string): void {
  if (!StrKey.isValidContract(contractId)) {
    throw new BadRequestError(`not a valid contract ID: ${contractId}`);
  }
}

function requireValidPublicKey(publicKey: string, fieldName: string): void {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new BadRequestError(`${fieldName} is not a valid public key: ${publicKey}`);
  }
}

/**
 * Contract methods that take no arguments beyond the invocation itself —
 * every escrow lifecycle transition except `initialize`. Source of truth
 * for which party's key must sign each one is the require_auth() calls in
 * HarvestLock-Contracts/contracts/escrow/src/lib.rs, not this list — this
 * list only decides which HTTP method names are servable, the contract
 * itself enforces who's allowed to actually do it.
 */
const NO_ARG_METHODS = new Set([
  "lock",
  "release_advance_1",
  "claim_advance_1",
  "reclaim_advance_1",
  "mark_checkpoint",
  "release_advance_2",
  "claim_advance_2",
  "reclaim_advance_2",
  "confirm_delivery",
  "settle",
  // Needs TWO signatures on the same submitted envelope (buyer AND
  // cooperative — see lib.rs's cancel()), not one. The generic build/
  // submit flow already supports this: the caller signs the XDR from
  // /tx/cancel with the first party's wallet, then signs that *same*
  // signed envelope again with the second party's before POSTing it to
  // /transactions/submit — nothing method-specific needed here.
  "cancel",
]);

/** bigint doesn't survive JSON.stringify — stringify it explicitly at the HTTP boundary. */
function serializeCommitment(c: Commitment) {
  return {
    ...c,
    total_amount: c.total_amount.toString(),
    claim_window_secs: c.claim_window_secs.toString(),
    created_at: c.created_at.toString(),
    advance1_deadline: c.advance1_deadline.toString(),
    advance2_deadline: c.advance2_deadline.toString(),
  };
}

// lib.rs enforces no floor/ceiling on claim_window_secs (contracts
// HANDOFF.md item 5: "as much a business decision as a technical one" —
// deliberately left as an API-level check, not a protocol invariant).
// 1 hour floor: short enough to not stall a real commitment, long enough
// that a genuinely inattentive cooperative isn't set up to fail by a
// window that closes before anyone could reasonably notice it opened.
// 90-day ceiling: generous relative to the mid-season-checkpoint cadence
// PRD §7 describes; mainly a guard against a fat-fingered value locking
// funds in an open-ended limbo. Both are engineering defaults, not
// values anyone has validated against real cooperative behavior yet --
// revisit once there's a real pilot to observe.
const MIN_CLAIM_WINDOW_SECS = 3600;
const MAX_CLAIM_WINDOW_SECS = 60 * 60 * 24 * 90;

interface InitializeBody {
  buyer: string;
  cooperative: string;
  warehouseOperator: string;
  token: string;
  totalAmount: string;
  advance1Bps: number;
  advance2Bps: number;
  claimWindowSecs: string;
  sourcePublicKey: string;
}

export function buildServer() {
  const app = Fastify({ logger: true });

  // Reflects the request origin rather than a fixed list — acceptable for
  // now since there's no auth/session model yet (MVP framing, PRD §17) and
  // every response here is public read data or a party-signed write the
  // contract itself gates via require_auth. Revisit once that changes.
  app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));

  // Deploys a fresh, uninitialized contract instance (deployer-paid — no
  // party auth required for a bare deploy). The caller still has to drive
  // /tx/initialize + /transactions/submit to actually bring it to life.
  app.post("/commitments/deploy", async (_req, reply) => {
    const contractId = await deployContractInstance();
    return reply.code(201).send({ contractId });
  });

  app.post<{ Params: { contractId: string }; Body: InitializeBody }>(
    "/commitments/:contractId/tx/initialize",
    async (req, reply) => {
      const { contractId } = req.params;
      requireValidContractId(contractId);
      const b = req.body;

      requireValidPublicKey(b.buyer, "buyer");
      requireValidPublicKey(b.cooperative, "cooperative");
      requireValidPublicKey(b.warehouseOperator, "warehouseOperator");
      requireValidContractId(b.token);

      const claimWindowSecs = Number(b.claimWindowSecs);
      if (claimWindowSecs < MIN_CLAIM_WINDOW_SECS || claimWindowSecs > MAX_CLAIM_WINDOW_SECS) {
        return reply.code(400).send({
          error: `claimWindowSecs must be between ${MIN_CLAIM_WINDOW_SECS} and ${MAX_CLAIM_WINDOW_SECS} seconds, got ${b.claimWindowSecs}`,
        });
      }

      const xdr = await buildInvokeTransaction({
        contractId,
        method: "initialize",
        sourcePublicKey: b.sourcePublicKey,
        args: initializeArgs({
          buyer: b.buyer,
          cooperative: b.cooperative,
          warehouseOperator: b.warehouseOperator,
          token: b.token,
          totalAmount: BigInt(b.totalAmount),
          advance1Bps: b.advance1Bps,
          advance2Bps: b.advance2Bps,
          claimWindowSecs: BigInt(b.claimWindowSecs),
        }),
      });
      return { xdr };
    },
  );

  app.post<{ Params: { contractId: string; method: string }; Body: { sourcePublicKey: string } }>(
    "/commitments/:contractId/tx/:method",
    async (req, reply) => {
      const { contractId, method } = req.params;
      requireValidContractId(contractId);
      if (!NO_ARG_METHODS.has(method)) {
        return reply.code(400).send({ error: `unknown or unsupported method: ${method}` });
      }
      const xdr = await buildInvokeTransaction({
        contractId,
        method,
        sourcePublicKey: req.body.sourcePublicKey,
      });
      return { xdr };
    },
  );

  // reassign_buyer takes an argument (the new buyer), so it can't go
  // through the generic no-arg /tx/:method route above — same reason
  // initialize gets its own route. Needs THREE signatures on the
  // submitted envelope (outgoing buyer, cooperative, incoming buyer —
  // see lib.rs's reassign_buyer doc comment for why all three, not the
  // two the PRD line alone would suggest); the generic build/submit flow
  // handles that the same way it handles cancel's two, nothing extra
  // needed here.
  app.post<{ Params: { contractId: string }; Body: { newBuyer: string; sourcePublicKey: string } }>(
    "/commitments/:contractId/tx/reassign-buyer",
    async (req) => {
      const { contractId } = req.params;
      requireValidContractId(contractId);
      requireValidPublicKey(req.body.newBuyer, "newBuyer");

      const xdr = await buildInvokeTransaction({
        contractId,
        method: "reassign_buyer",
        sourcePublicKey: req.body.sourcePublicKey,
        args: [new Address(req.body.newBuyer).toScVal()],
      });
      return { xdr };
    },
  );

  // Every write flows through here: the frontend builds via one of the
  // /tx routes above, has the right party's wallet sign, and submits the
  // signed envelope back to this single endpoint. On success, optionally
  // refreshes the Postgres cache from a live chain read — never trusts
  // the submitted tx's own claims about the resulting state.
  app.post<{ Body: { xdr: string; refreshContractId?: string } }>(
    "/transactions/submit",
    async (req) => {
      // Validated before submitting, not after: a bad refreshContractId
      // shouldn't leave the caller wondering whether their (real, funds-
      // moving) transaction went through or not because the response came
      // back an error either way.
      if (req.body.refreshContractId) {
        requireValidContractId(req.body.refreshContractId);
      }
      const result = await submitSignedTransaction(req.body.xdr);
      if (req.body.refreshContractId) {
        const commitment = await getCommitment(req.body.refreshContractId);
        await upsertCommitment(req.body.refreshContractId, commitment);
      }
      return result;
    },
  );

  // Live chain read — the source of truth, per PRD §17. Refreshes the
  // Postgres cache as a side effect so /commitments (list) stays current
  // even for state changes this API didn't itself submit.
  app.get<{ Params: { contractId: string } }>("/commitments/:contractId", async (req) => {
    requireValidContractId(req.params.contractId);
    const commitment = await getCommitment(req.params.contractId);
    await upsertCommitment(req.params.contractId, commitment).catch((err: unknown) => {
      req.log.warn({ err }, "failed to refresh commitments cache");
    });
    return serializeCommitment(commitment);
  });

  app.get("/commitments", async () => listCommitments());

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}
