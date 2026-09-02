import Fastify from "fastify";
import cors from "@fastify/cors";
import { StrKey, Address } from "@stellar/stellar-sdk";
import { getCommitment, type Commitment } from "./stellar/client.js";
import { deployContractInstance, initializeArgs } from "./stellar/deploy.js";
import { buildInvokeTransaction, submitSignedTransaction } from "./stellar/tx.js";
import { upsertCommitment, listCommitments } from "./db/commitments.js";
import { pool } from "./db/pool.js";
import { BadRequestError, ForbiddenError } from "./errors.js";
import { applyReputationConsequences, getStanding } from "./reputation.js";

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
 * Blocks a barred address from appearing on a new commitment — the
 * enforcement half of the off-chain reputation system (see
 * src/reputation.ts and src/db/reputation.ts). Only called for `buyer`
 * and `cooperative`: those are the two roles the default/forfeiture model
 * actually bars (see site/roles.html); the warehouse operator isn't a
 * settlement party in that sense.
 */
async function requireNotBarred(address: string, fieldName: string): Promise<void> {
  const standing = await getStanding(address);
  if (standing?.barred) {
    throw new ForbiddenError(
      `${fieldName} ${address} is barred (${standing.barred_reason}) and cannot be added to a new commitment`,
    );
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
  // Two-phase funding / default-forfeiture additions (lib.rs). All four
  // are single-signer or fully permissionless — none need the multi-party
  // signing path `cancel`/`reassign_buyer` do, so they fit the generic
  // no-arg route unchanged.
  "ready_for_delivery", // cooperative-gated
  "fund_remainder", // buyer-gated
  "expire_remainder_window", // permissionless — the buyer-default sweep
  "reclaim_on_nondelivery", // buyer-gated — the seller-non-delivery reclaim
]);

/** bigint doesn't survive JSON.stringify — stringify it explicitly at the HTTP boundary. */
function serializeCommitment(c: Commitment) {
  return {
    ...c,
    total_amount: c.total_amount.toString(),
    claim_window_secs: c.claim_window_secs.toString(),
    remainder_window_secs: c.remainder_window_secs.toString(),
    created_at: c.created_at.toString(),
    delivery_deadline: c.delivery_deadline.toString(),
    advance1_deadline: c.advance1_deadline.toString(),
    advance2_deadline: c.advance2_deadline.toString(),
    remainder_deadline: c.remainder_deadline.toString(),
  };
}

// lib.rs enforces no floor/ceiling on any of these three window values
// (same reasoning as contracts HANDOFF.md item 5 for claim_window_secs:
// "as much a business decision as a technical one" — deliberately left as
// an API-level check, not a protocol invariant). All three are engineering
// defaults, not values anyone has validated against real cooperative/buyer
// behavior yet — revisit once there's a real pilot to observe.
//
// claim_window_secs: 1 hour floor (short enough to not stall a real
// commitment, long enough that an inattentive cooperative isn't set up to
// fail by a window closing before anyone could reasonably notice it
// opened), 90-day ceiling (generous relative to the mid-season-checkpoint
// cadence PRD §7 describes; mainly a guard against a fat-fingered value).
const MIN_CLAIM_WINDOW_SECS = 3600;
const MAX_CLAIM_WINDOW_SECS = 60 * 60 * 24 * 90;

// remainder_window_secs: the buyer's deadline to fund the remainder once
// the cooperative signals ready_for_delivery — missing it is an immediate
// permanent bar (this session's product decision, see TASKS.md), so the
// floor needs to be long enough a buyer genuinely has a fair chance to act,
// not so short that a missed notification becomes a default. Same 1-hour
// technical floor as claim_window_secs, but the recommended/default value
// (see buyer-app's CreateCommitmentForm) is 7 days, not this floor.
// 30-day ceiling: a remainder payment sitting "pending" for over a month
// stops looking like two-phase funding and starts looking like the
// deposit-only design was pointless.
const MIN_REMAINDER_WINDOW_SECS = 3600;
const MAX_REMAINDER_WINDOW_SECS = 60 * 60 * 24 * 30;

// delivery_window_secs: the overall deadline from initialize() until
// confirm_delivery must have happened, or the buyer can reclaim escrow and
// the cooperative is forfeiture-eligible (graduated, 3-strike — see
// TASKS.md). Floor is a full day, not an hour — unlike the other two
// windows this spans actual physical delivery, not just a wallet signature.
// 365-day ceiling: generous relative to any realistic agricultural season,
// mainly a guard against a fat-fingered value.
const MIN_DELIVERY_WINDOW_SECS = 60 * 60 * 24;
const MAX_DELIVERY_WINDOW_SECS = 60 * 60 * 24 * 365;

interface InitializeBody {
  buyer: string;
  cooperative: string;
  warehouseOperator: string;
  token: string;
  totalAmount: string;
  advance1Bps: number;
  advance2Bps: number;
  claimWindowSecs: string;
  remainderWindowSecs: string;
  deliveryWindowSecs: string;
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
      await requireNotBarred(b.buyer, "buyer");
      await requireNotBarred(b.cooperative, "cooperative");

      const claimWindowSecs = Number(b.claimWindowSecs);
      if (claimWindowSecs < MIN_CLAIM_WINDOW_SECS || claimWindowSecs > MAX_CLAIM_WINDOW_SECS) {
        return reply.code(400).send({
          error: `claimWindowSecs must be between ${MIN_CLAIM_WINDOW_SECS} and ${MAX_CLAIM_WINDOW_SECS} seconds, got ${b.claimWindowSecs}`,
        });
      }
      const remainderWindowSecs = Number(b.remainderWindowSecs);
      if (remainderWindowSecs < MIN_REMAINDER_WINDOW_SECS || remainderWindowSecs > MAX_REMAINDER_WINDOW_SECS) {
        return reply.code(400).send({
          error: `remainderWindowSecs must be between ${MIN_REMAINDER_WINDOW_SECS} and ${MAX_REMAINDER_WINDOW_SECS} seconds, got ${b.remainderWindowSecs}`,
        });
      }
      const deliveryWindowSecs = Number(b.deliveryWindowSecs);
      if (deliveryWindowSecs < MIN_DELIVERY_WINDOW_SECS || deliveryWindowSecs > MAX_DELIVERY_WINDOW_SECS) {
        return reply.code(400).send({
          error: `deliveryWindowSecs must be between ${MIN_DELIVERY_WINDOW_SECS} and ${MAX_DELIVERY_WINDOW_SECS} seconds, got ${b.deliveryWindowSecs}`,
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
          remainderWindowSecs: BigInt(b.remainderWindowSecs),
          deliveryWindowSecs: BigInt(b.deliveryWindowSecs),
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
        const { previousStatus } = await upsertCommitment(req.body.refreshContractId, commitment);
        await applyReputationConsequences(req.body.refreshContractId, previousStatus, commitment);
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
    await upsertCommitment(req.params.contractId, commitment)
      .then(({ previousStatus }) => applyReputationConsequences(req.params.contractId, previousStatus, commitment))
      .catch((err: unknown) => {
        req.log.warn({ err }, "failed to refresh commitments cache");
      });
    return serializeCommitment(commitment);
  });

  app.get("/commitments", async () => listCommitments());

  // Read-only: a party's current reputation standing (strikes, whether
  // they're barred, and why). Returns a "clean" default rather than 404
  // when no row exists yet, so a frontend doesn't need a special case for
  // "never struck" vs. "explicitly not barred."
  app.get<{ Params: { address: string } }>("/parties/:address/standing", async (req) => {
    requireValidPublicKey(req.params.address, "address");
    const standing = await getStanding(req.params.address);
    return (
      standing ?? {
        address: req.params.address,
        strike_count: 0,
        barred: false,
        barred_reason: null,
        barred_at: null,
      }
    );
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}
