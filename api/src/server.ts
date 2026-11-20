import Fastify, { type FastifyBaseLogger } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { STATUS_CODES } from "node:http";
import { getBuildInfo } from "./buildInfo.js";
import { StrKey, Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { getAllocation, getCommitment, getOracleConfig, getOracleRate, type Commitment } from "./stellar/client.js";
import { assertDeployerBalance, deployContractInstance, initializeArgs } from "./stellar/deploy.js";
import { buildInvokeTransaction, submitSignedTransaction, getTransactionStatus } from "./stellar/tx.js";
import { upsertCommitment, listCommitments, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./db/commitments.js";
import { pool } from "./db/pool.js";
import { HttpError, BadRequestError, NotFoundError, ForbiddenError, ConfigurationError, ContractError } from "./errors.js";
import { applyReputationConsequences, getStanding } from "./reputation.js";
import { buildMultiPartyProposal, finalizeMultiPartyProposal } from "./stellar/multiParty.js";
import {
  createProposal,
  findActiveProposal,
  getProposalById,
  signProposalEntry,
  markReady,
  markCompleted,
  type PendingMultisigProposal,
} from "./db/pendingMultisigProposals.js";
import {
  createPendingSubmission,
  getPendingSubmission,
  claimPendingSubmissionSuccess,
  markPendingSubmissionFailed,
} from "./db/pendingSubmissions.js";
import {
  stageAllocationMembers,
  recordAllocationMembers,
  eraseAllocationMember,
  type StagedAllocationMember,
} from "./db/allocationMembers.js";

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

/**
 * The same discipline for every public key a request carries (party
 * addresses, transaction source accounts): a malformed one used to reach
 * the SDK's Keypair/Address decoding, which throws a plain Error with no
 * status code — an opaque 500 for what is unambiguously bad client
 * input, exactly like the contract-ID case above. StrKey's own validator
 * again, not a regex, and it also handles missing/non-string values
 * (isValid returns false rather than throwing), so `undefined` and `42`
 * fail here as a 400 instead of crashing further down. `fieldName` names
 * the offending field in the message, since routes can carry more than
 * one address.
 */
function requireValidPublicKey(publicKey: string, fieldName: string): void {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new BadRequestError(`${fieldName} is not a valid public key: ${publicKey}`);
  }
}

/**
 * Same discipline again, this time for row IDs: `pending_multisig_proposals.id`
 * is a Postgres UUID column, so a proposalId that isn't a UUID makes the
 * driver throw `invalid input syntax for type uuid` with no status code —
 * an opaque 500 for what is plainly bad client input (issue #202). Format
 * checked here (the schema's own declared shape) rather than letting the
 * query fail, so the caller gets a message naming the field.
 */
function requireValidUuid(value: string, fieldName: string): void {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestError(`${fieldName} must be a UUID, got ${value}`);
  }
}

/**
 * Stellar transaction hashes are SHA-256 digests rendered as 64 hex
 * characters. Checked before any Postgres/RPC lookup so a typo'd or
 * truncated hash is a clear 400 rather than a driver/RPC error with no
 * status code.
 */
function requireValidTransactionHash(hash: string): void {
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/i.test(hash)) {
    throw new BadRequestError(`hash must be 64 hexadecimal characters, got ${hash}`);
  }
}

interface SubmitSideEffects {
  refreshContractId?: string;
  completeProposalId?: string;
  allocationContractId?: string;
  allocationMembers?: StagedAllocationMember[];
}

/**
 * The off-chain work that was historically inlined in
 * POST /transactions/submit after a confirmed submission. Shared with
 * GET /transactions/:hash so a transaction that was reported PENDING —
 * and only later landed — still gets exactly the same treatment.
 *
 * Every branch is best-effort and logged, never thrown: the on-chain
 * transaction has already succeeded, so a cache/Postgres failure must not
 * turn that into an error response. The caller guarantees this runs at
 * most once per submission (the atomic claim in
 * db/pendingSubmissions.ts covers the GET path).
 */
async function applySubmitSideEffects(log: FastifyBaseLogger, effects: SubmitSideEffects): Promise<void> {
  if (effects.refreshContractId) {
    const refreshContractId = effects.refreshContractId;
    await getCommitment(refreshContractId)
      .then((commitment) =>
        upsertCommitment(refreshContractId, commitment).then(({ previousStatus }) =>
          applyReputationConsequences(refreshContractId, previousStatus, commitment),
        ),
      )
      .catch((err: unknown) => {
        log.warn({ err }, "failed to refresh commitments cache after submit");
      });
  }
  // Marks the proposal finished so a stale "ready to finalize" state
  // doesn't linger for other viewers once the cancel actually landed.
  if (effects.completeProposalId) {
    await markCompleted(effects.completeProposalId).catch((err: unknown) => {
      log.warn({ err }, "failed to mark multisig proposal completed");
    });
  }
  // Persists the phone-number mapping only now that set_allocation has
  // actually landed on-chain -- see stageAllocationMembers's doc comment
  // for why this waits until here instead of writing at build time.
  if (effects.allocationContractId && effects.allocationMembers) {
    await recordAllocationMembers(effects.allocationContractId, effects.allocationMembers).catch(
      (err: unknown) => {
        log.warn({ err }, "failed to persist allocation member phone numbers");
      },
    );
  }
}

/**
 * CORS is a browser permission boundary, not API authentication. Require
 * deployments to name each frontend origin explicitly; an unset value
 * disables cross-origin access until a real frontend origin is known.
 */
function configuredCorsOrigins(): string[] | false {
  const configured = process.env.CORS_ORIGINS?.trim();
  if (!configured) return false;

  const origins = configured.split(",").map((origin) => origin.trim());
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CORS_ORIGINS must contain exact HTTP(S) origins; invalid origin: ${origin}`);
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== origin) {
      throw new Error(`CORS_ORIGINS must contain exact HTTP(S) origins without paths: ${origin}`);
    }
  }
  return origins;
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
  // confirm_delivery moved out of this set once it started taking
  // arguments (delivered_quantity/grade_index, PRD §7 shortfall/grade
  // adjustment) — see its own route below, same reason initialize and
  // reassign_buyer aren't in this set either.
  "settle",
  // Needs TWO parties' Soroban auth (buyer AND cooperative — see lib.rs's
  // cancel()), not one. Serving the method here only builds the unsigned
  // XDR; a single classic signature per wallet is NOT enough, and naively
  // signing the same envelope twice fails on submission (tx_bad_auth_extra,
  // see api/README.md). The separate-wallets path is the staged
  // /tx/cancel/propose → /tx/propose/:id/sign pair below.
  "cancel",
  // Two-phase funding / default-forfeiture additions (lib.rs). All four
  // are single-signer or fully permissionless — none need the multi-party
  // signing path `cancel`/`reassign_buyer` do, so they fit the generic
  // no-arg route unchanged.
  "ready_for_delivery", // cooperative-gated
  "fund_remainder", // buyer-gated
  "expire_remainder_window", // permissionless — the buyer-default sweep
  "reclaim_on_nondelivery", // buyer-gated — the seller-non-delivery reclaim
  // Dispute flagging (lib.rs). flag_dispute has its own route below (it
  // takes an argument). resolve_dispute needs all THREE parties' auth —
  // same multi-party caveat as cancel above (signing the envelope once per
  // party does not work), served here only so its unsigned XDR can be
  // built; the separate-wallets path is its staged
  // /tx/resolve-dispute/propose route below. expire_dispute_window is
  // permissionless, same shape as expire_remainder_window.
  "resolve_dispute",
  "expire_dispute_window",
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
    fx_adjusted_total: c.fx_adjusted_total.toString(),
    fx_shortfall_amount: c.fx_shortfall_amount.toString(),
    fx_shortfall_deadline: c.fx_shortfall_deadline.toString(),
    dispute_deadline: c.dispute_deadline.toString(),
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

// The largest value initialize()'s i128 fields (total_amount, and
// OracleConfig's denominated_amount) can carry. nativeToScVal throws a
// plain Error for anything bigger, so an oversized digit string from a
// caller used to surface as an opaque 500 — checked as a 400 up front,
// same bug class as the malformed-address checks above (issue #201).
// The u32 fields have their own ceilings where they're validated
// (contractedQuantity against 2^32-1, bps fields against 10000).
const I128_MAX = 2n ** 127n - 1n;

// How long a proposal stays open for the other parties to sign before a
// fresh one can be proposed instead. Generous, matching the ~24-hour
// ledger-sequence window multiParty.ts already sets on the auth entries
// themselves (VALID_LEDGERS_AHEAD) -- the two should stay roughly in
// sync, since an "active" Postgres row referencing already-expired
// on-chain auth entries would be pointless.
const MULTISIG_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

/** Public shape of a multisig proposal -- hides internal fields (func/sorobanData XDR, already-signed entries) a client never needs. */
function serializeProposal(row: PendingMultisigProposal) {
  const pendingEntries = row.auth_entries
    .filter((e) => e.address !== null && e.signedEntryXdr === null)
    .map((e) => ({ address: e.address, entry_xdr: e.entryXdr }));
  return {
    id: row.id,
    contract_id: row.contract_id,
    method: row.method,
    proposer_address: row.proposer_address,
    status: row.status,
    pending_entries: pendingEntries,
    ready_xdr: row.status === "ready" ? row.final_xdr : null,
  };
}

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
  contractedQuantity: number;
  gradePriceBps: number[];
  // Omit, or pass null, for a plain deal that needs no conversion -- see
  // lib.rs's OracleConfig doc comment (PRD §16.3).
  oracleConfig?: { oracleContract: string; priceAsset: string; maxAgeSecs: string; denominatedAmount: string } | null;
  sourcePublicKey: string;
}

export async function buildServer() {
  const app = Fastify({ logger: true });

  // Never reflect arbitrary Origin headers. Set CORS_ORIGINS to a comma-
  // separated list of exact frontend origins once deployment domains are
  // known; until then browser cross-origin access stays disabled. CORS is
  // not authentication: transaction writes still rely on contract auth.
  app.register(cors, { origin: configuredCorsOrigins() });

  // Global, per-IP -- a normal single-signer transaction takes two API
  // calls (build XDR, submit signed XDR); wallet signing is local. A
  // staged three-party transaction takes at most four (propose, two
  // signer submissions, final submit). The 100/minute ceiling therefore
  // allows 25 staged transactions/minute before polling; a waiting
  // proposal's 10-second poll costs six requests/minute per active client.
  // This is a starting abuse-control budget, not a measured capacity
  // claim; all clients behind one NAT share it. Revisit from production
  // traffic before a pilot and use a shared store if multiple API
  // instances must enforce one per-IP budget. Skipped in tests so suites'
  // rapid-fire requests against one shared `app` don't trip it.
  //
  // The `await` on register() is load-bearing, not decoration:
  // @fastify/rate-limit attaches itself via an `onRoute` hook (see its
  // index.js), and Fastify runs onRoute hooks synchronously at
  // route-definition time. An un-awaited app.register() defers the
  // plugin body until boot -- i.e. after every route below was already
  // defined -- so the hook saw zero routes and the limiter silently
  // never engaged: verified pre-fix that 110 rapid requests produced no
  // 429 and not a single x-ratelimit-* header on any response. This is
  // also why the plugin's own README always shows
  // `await fastify.register(...)`. A 429 from this limiter does carry
  // `Retry-After` (seconds remaining in the window) -- observed and
  // documented in api/README.md's "Rate limiting" section, which is
  // what the three frontends' backoff logic should key off.
  if (process.env.NODE_ENV !== "test") {
    await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  }

  // Explicit, not left to Fastify's own default handler (audit finding,
  // 9 Sept 2026 -- a comment here used to claim this existed before it
  // actually did). `HttpError` subclasses (BadRequestError, ForbiddenError)
  // keep exactly the behavior Fastify's default already gave them --
  // their own statusCode, their own message, both written to be
  // client-facing on purpose. `ContractError` additionally carries the
  // contract's own `{ code, name }` (see errors.ts), so a state-machine
  // rejection is a structured 409 (or a 404 on a read) rather than a 500
  // that looks like an outage. `ConfigurationError` (a missing/invalid
  // deployment env var, see errors.ts) is the one category genuinely
  // worth hiding from an external caller -- it's an operator mistake,
  // not client input, and naming the specific env var externally is
  // pure information disclosure with zero benefit to a legitimate
  // caller. Everything else (genuine RPC/transport failures, submission
  // timeouts, SDK decoding assertions) is deliberately left to
  // propagate with its real message and original statusCode, same as
  // before this handler existed. Checked, not assumed, that this doesn't
  // leak secret material: Keypair.fromSecret() never echoes an invalid
  // value back in its error message, and this project's own testing of
  // a pg connection failure showed an empty `.message`, not connection
  // detail -- see api/HANDOFF.md.
  app.setErrorHandler((err, req, reply) => {
    // {statusCode, error, message} -- Fastify's own default shape, matched
    // exactly (not `{ error: message }`, a real mistake caught by every
    // existing test that reads `.json().message`, not `.json().error`,
    // for a thrown HttpError -- this handler replaces Fastify's default,
    // it isn't free to invent a different one).
    if (err instanceof ContractError) {
      return reply.code(err.statusCode).send({
        statusCode: err.statusCode,
        error: STATUS_CODES[err.statusCode],
        message: err.message,
        contractError: err.contractError,
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ statusCode: err.statusCode, error: STATUS_CODES[err.statusCode], message: err.message });
    }
    if (err instanceof ConfigurationError) {
      req.log.error(err, "configuration error");
      return reply
        .code(500)
        .send({ statusCode: 500, error: STATUS_CODES[500], message: "server is misconfigured — check the deployment logs" });
    }
    req.log.error(err);
    const message = err instanceof Error ? err.message : String(err);
    const statusCode =
      err instanceof Error && "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 500;
    return reply.code(statusCode).send({ statusCode, error: STATUS_CODES[statusCode], message });
  });

  // Fastify leaves `req.body` undefined for a request that declares no
  // Content-Type at all (an unsupported type is already a 415, and a
  // declared-but-empty JSON body already a 400 — both Fastify's own
  // handling, before any route code runs). Every handler below reads
  // fields off `req.body` directly, so that absence used to crash with
  // "Cannot read properties of undefined (reading '<field>')" — an
  // unhandled 500 for what is just a request that forgot its body.
  // Normalizing to an empty object lets each route's own field checks
  // answer with their normal, clear 400 instead. Found in the dispute-
  // route bad-input audit (issue #205): a bare POST to
  // /tx/flag-dispute with no body 500'd exactly this way.
  app.addHook("preValidation", async (req) => {
    if (req.body === undefined) req.body = {};
  });

  app.get("/health", async (_req, reply) => {
    let database: "ok" | "unavailable" = "ok";
    try {
      await pool.query("SELECT 1");
    } catch (err) {
      database = "unavailable";
      app.log.error({ err }, "health check could not reach Postgres");
    }

    const ok = database === "ok";
    return reply.code(ok ? 200 : 503).send({ ok, checks: { api: "ok", database } });
  });

  app.get("/version", async (_req, reply) => reply.send(getBuildInfo()));

  // Deploys a fresh, uninitialized contract instance (deployer-paid — no
  // party auth required for a bare deploy). The caller still has to drive
  // /tx/initialize + /transactions/submit to actually bring it to life.
  //
  // Audited for the #201 bad-input sweep: this route carries no
  // caller-supplied values at all — no params, no body fields (the
  // deployer key and WASM hash come from deployment env, see
  // stellar/deploy.ts) — so there is no malformed value for it to accept
  // or 500 on beyond what Fastify itself rejects (malformed/unsupported
  // JSON bodies get the body parser's own 400/415 before this handler
  // runs). Its remaining failure modes are an operator misconfiguration
  // (ConfigurationError, deliberately a 500) and the network itself.
  // Per-route limit, far below the global one: every call spends real XLM
  // from the deployer, which also pays for every read simulation.
  const deployRateLimit = {
    max: Number(process.env.DEPLOY_RATE_LIMIT_MAX ?? 5),
    timeWindow: Number(process.env.DEPLOY_RATE_LIMIT_WINDOW_MS ?? 10 * 60_000),
  };
  app.post("/commitments/deploy", { config: { rateLimit: deployRateLimit } }, async (req, reply) => {
    await assertDeployerBalance(req.log);
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
      // The transaction source account the unsigned XDR is built against
      // — same always-validate rule as every address above.
      requireValidPublicKey(b.sourcePublicKey, "sourcePublicKey");
      await requireNotBarred(b.buyer, "buyer");
      await requireNotBarred(b.cooperative, "cooperative");

      // Audited for the #201 bad-input sweep. Every conversion below used
      // to trust its input type and let the failure happen inside
      // BigInt()/nativeToScVal(): a missing or non-numeric totalAmount,
      // a non-numeric/NaN window value (NaN passes both range
      // comparisons, then BigInt("abc") throws), a negative or
      // non-integer advance bps, an oversized contractedQuantity, or an
      // i128/u32 overflow all came back as opaque 500s. Each field now
      // parses and range-checks its value up front, so every one of those
      // is the caller's clear 400, never a 500.
      let totalAmount: bigint;
      if (typeof b.totalAmount !== "string" && typeof b.totalAmount !== "number") {
        throw new BadRequestError(`totalAmount must be an integer, got ${b.totalAmount}`);
      }
      try {
        totalAmount = BigInt(b.totalAmount);
      } catch {
        throw new BadRequestError(`totalAmount must be an integer, got ${b.totalAmount}`);
      }
      if (totalAmount <= 0n) {
        throw new BadRequestError(`totalAmount must be positive, got ${b.totalAmount}`);
      }
      if (totalAmount > I128_MAX) {
        throw new BadRequestError(`totalAmount is out of range for a 128-bit integer, got ${b.totalAmount}`);
      }

      for (const [field, value] of [
        ["advance1Bps", b.advance1Bps],
        ["advance2Bps", b.advance2Bps],
      ] as const) {
        if (!Number.isInteger(value) || value < 0 || value > 10_000) {
          throw new BadRequestError(`${field} must be an integer between 0 and 10000, got ${value}`);
        }
      }

      const claimWindowSecs = Number(b.claimWindowSecs);
      if (!Number.isInteger(claimWindowSecs) || claimWindowSecs < MIN_CLAIM_WINDOW_SECS || claimWindowSecs > MAX_CLAIM_WINDOW_SECS) {
        throw new BadRequestError(`claimWindowSecs must be between ${MIN_CLAIM_WINDOW_SECS} and ${MAX_CLAIM_WINDOW_SECS} seconds, got ${b.claimWindowSecs}`);
      }
      const remainderWindowSecs = Number(b.remainderWindowSecs);
      if (
        !Number.isInteger(remainderWindowSecs) ||
        remainderWindowSecs < MIN_REMAINDER_WINDOW_SECS ||
        remainderWindowSecs > MAX_REMAINDER_WINDOW_SECS
      ) {
        throw new BadRequestError(`remainderWindowSecs must be between ${MIN_REMAINDER_WINDOW_SECS} and ${MAX_REMAINDER_WINDOW_SECS} seconds, got ${b.remainderWindowSecs}`);
      }
      const deliveryWindowSecs = Number(b.deliveryWindowSecs);
      if (
        !Number.isInteger(deliveryWindowSecs) ||
        deliveryWindowSecs < MIN_DELIVERY_WINDOW_SECS ||
        deliveryWindowSecs > MAX_DELIVERY_WINDOW_SECS
      ) {
        throw new BadRequestError(`deliveryWindowSecs must be between ${MIN_DELIVERY_WINDOW_SECS} and ${MAX_DELIVERY_WINDOW_SECS} seconds, got ${b.deliveryWindowSecs}`);
      }
      // Mirrors lib.rs's initialize() guards exactly -- no API-specific
      // narrowing here the way the three windows above have, since there's
      // no business judgment call to make on top of the contract's own
      // validation (unlike the windows, which are genuinely a product
      // decision, not just mirroring). The 2^32-1 ceiling isn't a
      // product rule either, it's the u32 the contract (and
      // nativeToScVal's encoding) can actually represent -- an oversized
      // integer used to throw out of the encoder as a 500.
      if (!Number.isInteger(b.contractedQuantity) || b.contractedQuantity <= 0 || b.contractedQuantity > 0xffff_ffff) {
        throw new BadRequestError(`contractedQuantity must be a positive integer (max 4294967295), got ${b.contractedQuantity}`);
      }
      if (
        !Array.isArray(b.gradePriceBps) ||
        b.gradePriceBps.length === 0 ||
        b.gradePriceBps.some((bps) => !Number.isInteger(bps) || bps < 0 || bps > 10_000)
      ) {
        throw new BadRequestError(`gradePriceBps must be a non-empty array of integers between 0 and 10000, got ${JSON.stringify(b.gradePriceBps)}`);
      }
      let parsedOracleConfig: {
        oracleContract: string;
        priceAsset: string;
        maxAgeSecs: bigint;
        denominatedAmount: bigint;
      } | null = null;
      if (b.oracleConfig != null) {
        requireValidContractId(b.oracleConfig.oracleContract);
        if (typeof b.oracleConfig.priceAsset !== "string" || b.oracleConfig.priceAsset.trim().length === 0) {
          throw new BadRequestError("oracleConfig.priceAsset must be a non-empty string");
        }
        const maxAgeSecs = Number(b.oracleConfig.maxAgeSecs);
        // Safe-integer, not just integer: Number.isInteger("1e21" via
        // Number(...)) is true, but the raw string would still make
        // BigInt()/the u64 encoder throw later -- parse once here and
        // pass the parsed value down, so validation and use can't drift.
        // The typeof guard is because Number(true) is 1: without it a
        // boolean would pass as a one-second window.
        if (
          (typeof b.oracleConfig.maxAgeSecs !== "string" && typeof b.oracleConfig.maxAgeSecs !== "number") ||
          !Number.isSafeInteger(maxAgeSecs) ||
          maxAgeSecs <= 0
        ) {
          throw new BadRequestError(`oracleConfig.maxAgeSecs must be a positive integer, got ${b.oracleConfig.maxAgeSecs}`);
        }
        let denominatedAmount: bigint;
        if (typeof b.oracleConfig.denominatedAmount !== "string" && typeof b.oracleConfig.denominatedAmount !== "number") {
          throw new BadRequestError(`oracleConfig.denominatedAmount must be an integer, got ${b.oracleConfig.denominatedAmount}`);
        }
        try {
          denominatedAmount = BigInt(b.oracleConfig.denominatedAmount);
        } catch {
          throw new BadRequestError(`oracleConfig.denominatedAmount must be an integer, got ${b.oracleConfig.denominatedAmount}`);
        }
        if (denominatedAmount <= 0n) {
          throw new BadRequestError(`oracleConfig.denominatedAmount must be positive, got ${b.oracleConfig.denominatedAmount}`);
        }
        if (denominatedAmount > I128_MAX) {
          throw new BadRequestError(`oracleConfig.denominatedAmount is out of range for a 128-bit integer, got ${b.oracleConfig.denominatedAmount}`);
        }
        parsedOracleConfig = {
          oracleContract: b.oracleConfig.oracleContract,
          priceAsset: b.oracleConfig.priceAsset,
          maxAgeSecs: BigInt(maxAgeSecs),
          denominatedAmount,
        };
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
          totalAmount,
          advance1Bps: b.advance1Bps,
          advance2Bps: b.advance2Bps,
          // The parsed numbers, not the raw body values: Number("3.6e3")
          // is a perfectly valid 3600-second window, but BigInt("3.6e3")
          // throws -- validation and encoding must agree on the value.
          claimWindowSecs: BigInt(claimWindowSecs),
          remainderWindowSecs: BigInt(remainderWindowSecs),
          deliveryWindowSecs: BigInt(deliveryWindowSecs),
          contractedQuantity: b.contractedQuantity,
          gradePriceBps: b.gradePriceBps,
          oracleConfig: parsedOracleConfig,
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
        throw new BadRequestError(`unknown or unsupported method: ${method}`);
      }
      // The generic no-arg route is what resolve_dispute and
      // expire_dispute_window go through (along with every other no-arg
      // lifecycle transition). A malformed sourcePublicKey used to reach
      // server.getAccount() in the SDK and come back an opaque 500 --
      // same bug class as the contract ID above (issue #205).
      requireValidPublicKey(req.body.sourcePublicKey, "sourcePublicKey");
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
      requireValidPublicKey(req.body.sourcePublicKey, "sourcePublicKey");

      const xdr = await buildInvokeTransaction({
        contractId,
        method: "reassign_buyer",
        sourcePublicKey: req.body.sourcePublicKey,
        args: [new Address(req.body.newBuyer).toScVal()],
      });
      return { xdr };
    },
  );

  // confirm_delivery now takes delivered_quantity/grade_index (PRD §7
  // shortfall/grade adjustment — lib.rs's settle() pays out against the
  // settlement_bps this computes), so like initialize/reassign_buyer it
  // needs its own route instead of the generic no-arg one. Single-signer
  // (warehouse_operator only, per lib.rs's require_auth) — no multi-party
  // staging needed, unlike cancel/reassign_buyer.
  app.post<{
    Params: { contractId: string };
    Body: { deliveredQuantity: number; gradeIndex: number; sourcePublicKey: string };
  }>("/commitments/:contractId/tx/confirm-delivery", async (req, reply) => {
    const { contractId } = req.params;
    requireValidContractId(contractId);
    const { deliveredQuantity, gradeIndex } = req.body;
    if (!Number.isInteger(deliveredQuantity) || deliveredQuantity < 0) {
      throw new BadRequestError(`deliveredQuantity must be a non-negative integer, got ${deliveredQuantity}`);
    }
    if (!Number.isInteger(gradeIndex) || gradeIndex < 0) {
      throw new BadRequestError(`gradeIndex must be a non-negative integer, got ${gradeIndex}`);
    }
    requireValidPublicKey(req.body.sourcePublicKey, "sourcePublicKey");

    const unsignedXdr = await buildInvokeTransaction({
      contractId,
      method: "confirm_delivery",
      sourcePublicKey: req.body.sourcePublicKey,
      args: [nativeToScVal(deliveredQuantity, { type: "u32" }), nativeToScVal(gradeIndex, { type: "u32" })],
    });
    return { xdr: unsignedXdr };
  });

  // flag_dispute takes an argument (which of the three named parties is
  // flagging), so — same reasoning as confirm_delivery/reassign_buyer —
  // it can't go through the generic no-arg route. Single-signer: lib.rs
  // only requires `flagger`'s own auth, not every party's, so unlike
  // resolve_dispute this needs no multi-party staging. The API doesn't
  // check `flagger` against the commitment's buyer/cooperative/warehouse
  // fields itself (same minimal-validation convention as confirm_delivery
  // not checking sourcePublicKey against warehouse_operator) — lib.rs's
  // own `NotAParty` check is the actual enforcement, this route just
  // validates the address is well-formed before ever touching the network.
  app.post<{ Params: { contractId: string }; Body: { flagger: string; sourcePublicKey: string } }>(
    "/commitments/:contractId/tx/flag-dispute",
    async (req) => {
      const { contractId } = req.params;
      requireValidContractId(contractId);
      requireValidPublicKey(req.body.flagger, "flagger");
      requireValidPublicKey(req.body.sourcePublicKey, "sourcePublicKey");

      const xdr = await buildInvokeTransaction({
        contractId,
        method: "flag_dispute",
        sourcePublicKey: req.body.sourcePublicKey,
        args: [new Address(req.body.flagger).toScVal()],
      });
      return { xdr };
    },
  );

  // set_allocation takes a Vec<AllocationMember> struct arg -- Soroban
  // structs serialize as an ScMap keyed by field name (Symbol), sorted;
  // nativeToScVal's automatic object->map inference gets the numeric
  // type wrong (defaults share_bps to u64, the contract wants u32), so
  // this builds each entry's map explicitly instead of trusting
  // inference. Verified against a real deployed contract via
  // simulateTransaction before ever wiring this into the route --
  // wrong field order or types here would fail on-chain, not visibly.
  function allocationMemberToScVal(memberHash: Buffer, shareBps: number): xdr.ScVal {
    return xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("member_hash"),
        val: nativeToScVal(memberHash, { type: "bytes" }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("share_bps"),
        val: nativeToScVal(shareBps, { type: "u32" }),
      }),
    ]);
  }

  // Builds the unsigned set_allocation XDR and stages (but does not yet
  // persist) the phone-number mapping -- see
  // db/allocationMembers.ts's stageAllocationMembers doc comment for why
  // persisting waits until /transactions/submit confirms the tx actually
  // landed. Cooperative-gated on-chain (lib.rs's require_auth); this
  // route itself doesn't check who's calling, same as every other
  // single-signer tx-builder route -- the contract is what actually
  // enforces it.
  app.post<{
    Params: { contractId: string };
    Body: { members: { phoneNumber: string; shareBps: number }[]; sourcePublicKey: string };
  }>("/commitments/:contractId/tx/set-allocation", async (req, reply) => {
    const { contractId } = req.params;
    requireValidContractId(contractId);
    const { members } = req.body;
    if (!Array.isArray(members) || members.length === 0) {
      throw new BadRequestError("members must be a non-empty array");
    }
    let totalBps = 0;
    for (const m of members) {
      // `m?.` not `m.`: a JSON array can hold null/numbers/strings, and a
      // null element used to crash on `.phoneNumber` (TypeError → 500)
      // before this check ever ran (issue #203). Optional chaining makes
      // every non-object element fail the same clear 400 instead.
      if (typeof m?.phoneNumber !== "string" || m.phoneNumber.trim().length === 0) {
        throw new BadRequestError("every member needs a non-empty phoneNumber");
      }
      if (!Number.isInteger(m.shareBps) || m.shareBps < 0 || m.shareBps > 10_000) {
        throw new BadRequestError(`shareBps must be an integer between 0 and 10000, got ${m.shareBps}`);
      }
      totalBps += m.shareBps;
    }
    if (totalBps > 10_000) {
      throw new BadRequestError(`members' shareBps sum to ${totalBps}, over the 10000 bps ceiling`);
    }
    requireValidPublicKey(req.body.sourcePublicKey, "sourcePublicKey");

    const staged = stageAllocationMembers(members);
    const unsignedXdr = await buildInvokeTransaction({
      contractId,
      method: "set_allocation",
      sourcePublicKey: req.body.sourcePublicKey,
      args: [
        xdr.ScVal.scvVec(staged.map((m) => allocationMemberToScVal(Buffer.from(m.memberHash, "hex"), m.shareBps))),
      ],
    });
    return { xdr: unsignedXdr, members: staged };
  });

  // Live on-chain read -- source of truth, same convention as GET
  // /commitments/:contractId. Never includes a phone number (this
  // contract never stores one) -- pair with the off-chain identity map
  // (db/allocationMembers.ts) only where that's actually needed, which
  // this API doesn't expose over a read endpoint at all (see
  // allocationMembers.ts's getAllocationMembers doc comment).
  app.get<{ Params: { contractId: string } }>("/commitments/:contractId/allocation", async (req) => {
    requireValidContractId(req.params.contractId);
    const members = await getAllocation(req.params.contractId);
    return {
      // scValToNative decodes BytesN as a Uint8Array, not a Buffer --
      // Uint8Array.toString("hex") silently ignores the argument and
      // produces a comma-joined decimal list instead of a hex string,
      // which is exactly wrong and doesn't throw. Buffer.from(...) first
      // guarantees the real hex encoding regardless of which one it is.
      members: members.map((m) => ({ memberHash: Buffer.from(m.member_hash).toString("hex"), shareBps: m.share_bps })),
    };
  });

  // Live on-chain read. `null` if `initialize` never set an oracle_config
  // for this commitment -- a valid state, not an error (see
  // getOracleConfig's doc comment for why this differs from
  // /allocation's "let AllocationNotSet propagate" convention).
  //
  // Audited for the #204 bad-input sweep: contractId is the only
  // caller-supplied value this route (and /oracle-rate below) carries,
  // and requireValidContractId already answers a malformed one with a
  // clear 400 before anything touches the SDK or the chain -- consistent
  // with every other read route, no fix needed. A well-formed but
  // unknown/dead contract ID is a chain-read failure, not bad input, and
  // deliberately still propagates (same convention as getCommitment on
  // GET /commitments/:contractId). The tests for both routes in
  // test/server.test.ts lock the 400 behavior in.
  app.get<{ Params: { contractId: string } }>("/commitments/:contractId/oracle-config", async (req) => {
    requireValidContractId(req.params.contractId);
    const config = await getOracleConfig(req.params.contractId);
    if (!config) return { config: null };
    return {
      config: {
        oracleContract: config.oracle_contract,
        priceAsset: config.price_asset,
        maxAgeSecs: config.max_age_secs.toString(),
        denominatedAmount: config.denominated_amount.toString(),
      },
    };
  });

  // Live on-chain read, genuinely live every call -- this cross-calls the
  // configured Reflector oracle on every request, it isn't cached. Throws
  // (surfaces as a 500 with the contract's error message) if
  // oracle_config was never set, the oracle doesn't quote that asset, or
  // the quote is older than the configured bound -- see oracle_rate's own
  // doc comment in lib.rs for why a stale/missing rate is refused rather
  // than silently returned.
  app.get<{ Params: { contractId: string } }>("/commitments/:contractId/oracle-rate", async (req) => {
    requireValidContractId(req.params.contractId);
    const rate = await getOracleRate(req.params.contractId);
    return { price: rate.price.toString(), timestamp: rate.timestamp.toString() };
  });

  // NDPA s.34 erasure: nulls out the phone number behind a member_hash,
  // leaving the on-chain hash permanently unlinkable to a real person
  // (see allocationMembers.ts's eraseAllocationMember doc comment).
  // Idempotent -- erasing an already-erased hash still returns 200.
  app.delete<{ Params: { memberHash: string } }>("/allocation-members/:memberHash", async (req, reply) => {
    const { memberHash } = req.params;
    if (!/^[0-9a-f]{64}$/i.test(memberHash)) {
      throw new BadRequestError("memberHash must be a 64-character hex string (32 bytes)");
    }
    const found = await eraseAllocationMember(memberHash.toLowerCase());
    if (!found) {
      throw new NotFoundError(`no allocation member with hash ${memberHash}`);
    }
    return { erased: true };
  });

  // Staged multi-party signing -- see src/stellar/multiParty.ts and
  // db/pendingMultisigProposals.ts for the mechanism and schema. One
  // party proposes; the OTHER non-source parties each sign their own
  // auth entry via their own wallet (Freighter's signAuthEntry, not
  // signTransaction -- this is a single auth entry, not a whole tx) in a
  // separate request, at a separate time, from a separate device. Once
  // every entry is signed, the proposer signs the final XDR through the
  // *existing* sign -> /transactions/submit path below -- nothing new
  // needed there. `cancel` (two parties) and `reassign_buyer` (three)
  // both use this same mechanism; the sign step is fully method-agnostic
  // (a proposalId already uniquely identifies which method/table row is
  // involved), only propose/read need a route per method, since each
  // takes different arguments and has different "who's allowed to
  // propose" rules.
  app.post<{ Params: { contractId: string }; Body: { proposerPublicKey: string } }>(
    "/commitments/:contractId/tx/cancel/propose",
    async (req, reply) => {
      const { contractId } = req.params;
      requireValidContractId(contractId);
      requireValidPublicKey(req.body.proposerPublicKey, "proposerPublicKey");

      const existing = await findActiveProposal(contractId, "cancel");
      if (existing) {
        return reply.code(200).send(serializeProposal(existing));
      }

      const commitment = await getCommitment(contractId);
      if (req.body.proposerPublicKey !== commitment.buyer && req.body.proposerPublicKey !== commitment.cooperative) {
        throw new ForbiddenError(`proposerPublicKey must be the commitment's buyer or cooperative to propose a cancellation`);
      }

      const pieces = await buildMultiPartyProposal({
        contractId,
        method: "cancel",
        sourcePublicKey: req.body.proposerPublicKey,
      });
      const row = await createProposal({
        contractId,
        method: "cancel",
        proposerAddress: req.body.proposerPublicKey,
        funcXdr: pieces.funcXdr,
        sorobanDataXdr: pieces.sorobanDataXdr,
        entries: pieces.entries.map((e) => ({ address: e.address, entryXdr: e.entryXdr, signedEntryXdr: null })),
        expiresAt: new Date(Date.now() + MULTISIG_PROPOSAL_TTL_MS),
      });
      return reply.code(201).send(serializeProposal(row));
    },
  );

  // The active cancel proposal for a contract, if any -- what a viewer's
  // UI polls to show "X wants to cancel this commitment, approve?" or
  // "waiting on the other party" or "ready to finalize."
  app.get<{ Params: { contractId: string } }>("/commitments/:contractId/tx/cancel/propose", async (req) => {
    requireValidContractId(req.params.contractId);
    const proposal = await findActiveProposal(req.params.contractId, "cancel");
    return { proposal: proposal ? serializeProposal(proposal) : null };
  });

  // reassign_buyer's propose route: same shape as cancel's, but the
  // proposer must specifically be the CURRENT (outgoing) buyer -- unlike
  // cancel, which either party can initiate, reassignment is fundamentally
  // the outgoing buyer's own decision to give up the position (PRD §4.8:
  // "with cooperative consent," not "cooperative-initiated"). Takes
  // newBuyer since reassign_buyer, unlike cancel, needs an argument.
  app.post<{ Params: { contractId: string }; Body: { proposerPublicKey: string; newBuyer: string } }>(
    "/commitments/:contractId/tx/reassign-buyer/propose",
    async (req, reply) => {
      const { contractId } = req.params;
      requireValidContractId(contractId);
      requireValidPublicKey(req.body.proposerPublicKey, "proposerPublicKey");
      requireValidPublicKey(req.body.newBuyer, "newBuyer");

      const existing = await findActiveProposal(contractId, "reassign_buyer");
      if (existing) {
        return reply.code(200).send(serializeProposal(existing));
      }

      const commitment = await getCommitment(contractId);
      if (req.body.proposerPublicKey !== commitment.buyer) {
        throw new ForbiddenError(`proposerPublicKey must be the commitment's current buyer to propose reassigning it`);
      }

      const pieces = await buildMultiPartyProposal({
        contractId,
        method: "reassign_buyer",
        sourcePublicKey: req.body.proposerPublicKey,
        args: [new Address(req.body.newBuyer).toScVal()],
      });
      const row = await createProposal({
        contractId,
        method: "reassign_buyer",
        proposerAddress: req.body.proposerPublicKey,
        funcXdr: pieces.funcXdr,
        sorobanDataXdr: pieces.sorobanDataXdr,
        entries: pieces.entries.map((e) => ({ address: e.address, entryXdr: e.entryXdr, signedEntryXdr: null })),
        expiresAt: new Date(Date.now() + MULTISIG_PROPOSAL_TTL_MS),
      });
      return reply.code(201).send(serializeProposal(row));
    },
  );

  app.get<{ Params: { contractId: string } }>("/commitments/:contractId/tx/reassign-buyer/propose", async (req) => {
    requireValidContractId(req.params.contractId);
    const proposal = await findActiveProposal(req.params.contractId, "reassign_buyer");
    return { proposal: proposal ? serializeProposal(proposal) : null };
  });

  // resolve_dispute's propose route: same shape as cancel's (no extra
  // args, three-way symmetric eligibility -- unlike reassign_buyer's
  // "only the current buyer" rule) but any ONE of the three named
  // parties may propose, since lib.rs requires all three parties' auth
  // regardless of who initiates. buildMultiPartyProposal doesn't need to
  // know that in advance -- simulating resolve_dispute naturally produces
  // three non-source auth entries (buyer, cooperative, warehouse_operator
  // each call require_auth()), the same way reassign_buyer's simulation
  // already does for its own three.
  app.post<{ Params: { contractId: string }; Body: { proposerPublicKey: string } }>(
    "/commitments/:contractId/tx/resolve-dispute/propose",
    async (req, reply) => {
      const { contractId } = req.params;
      requireValidContractId(contractId);
      requireValidPublicKey(req.body.proposerPublicKey, "proposerPublicKey");

      const existing = await findActiveProposal(contractId, "resolve_dispute");
      if (existing) {
        return reply.code(200).send(serializeProposal(existing));
      }

      const commitment = await getCommitment(contractId);
      if (
        req.body.proposerPublicKey !== commitment.buyer &&
        req.body.proposerPublicKey !== commitment.cooperative &&
        req.body.proposerPublicKey !== commitment.warehouse_operator
      ) {
        throw new ForbiddenError(
          `proposerPublicKey must be the commitment's buyer, cooperative, or warehouse operator to propose resolving a dispute`,
        );
      }

      const pieces = await buildMultiPartyProposal({
        contractId,
        method: "resolve_dispute",
        sourcePublicKey: req.body.proposerPublicKey,
      });
      const row = await createProposal({
        contractId,
        method: "resolve_dispute",
        proposerAddress: req.body.proposerPublicKey,
        funcXdr: pieces.funcXdr,
        sorobanDataXdr: pieces.sorobanDataXdr,
        entries: pieces.entries.map((e) => ({ address: e.address, entryXdr: e.entryXdr, signedEntryXdr: null })),
        expiresAt: new Date(Date.now() + MULTISIG_PROPOSAL_TTL_MS),
      });
      return reply.code(201).send(serializeProposal(row));
    },
  );

  app.get<{ Params: { contractId: string } }>("/commitments/:contractId/tx/resolve-dispute/propose", async (req) => {
    requireValidContractId(req.params.contractId);
    const proposal = await findActiveProposal(req.params.contractId, "resolve_dispute");
    return { proposal: proposal ? serializeProposal(proposal) : null };
  });

  app.post<{
    Params: { contractId: string; proposalId: string };
    Body: { signerPublicKey: string; signedEntryXdr: string };
  }>("/commitments/:contractId/tx/propose/:proposalId/sign", async (req) => {
    const { contractId, proposalId } = req.params;
    requireValidContractId(contractId);
    // Audited for the #202 bad-input sweep. Two values used to reach
    // infrastructure unfiltered: a non-UUID proposalId made Postgres
    // throw `invalid input syntax for type uuid` (500), and a
    // missing/non-string/malformed signedEntryXdr was persisted as-is,
    // only to explode later inside finalizeMultiPartyProposal's
    // fromXDR() when the last entry was signed (500 at a completely
    // different request, no less). Both are caller input and are now
    // checked here as clear 400s before the lookup or any write.
    requireValidUuid(proposalId, "proposalId");
    requireValidPublicKey(req.body.signerPublicKey, "signerPublicKey");
    if (typeof req.body.signedEntryXdr !== "string" || req.body.signedEntryXdr.trim().length === 0) {
      throw new BadRequestError("signedEntryXdr must be a non-empty string");
    }
    try {
      xdr.SorobanAuthorizationEntry.fromXDR(req.body.signedEntryXdr, "base64");
    } catch {
      throw new BadRequestError("signedEntryXdr is not a valid base64 Soroban authorization entry");
    }

    const proposal = await getProposalById(proposalId);
    if (!proposal || proposal.contract_id !== contractId) {
      throw new BadRequestError(`no pending proposal ${proposalId} for contract ${contractId}`);
    }
    if (new Date(proposal.expires_at).getTime() <= Date.now()) {
      throw new BadRequestError(`proposal ${proposalId} has expired -- propose a fresh one`);
    }
    if (proposal.status !== "pending") {
      throw new BadRequestError(`proposal ${proposalId} is already ${proposal.status}, not awaiting a signature`);
    }

    const result = await signProposalEntry(proposalId, req.body.signerPublicKey, req.body.signedEntryXdr);
    if (result.outcome === "not_found") {
      throw new BadRequestError(`no pending proposal ${proposalId}`);
    }
    if (result.outcome === "no_matching_pending_entry") {
      throw new BadRequestError(
        `${req.body.signerPublicKey} has no pending (unsigned) auth entry on proposal ${proposalId} -- wrong signer, or already signed`,
      );
    }

    if (result.allSigned) {
      const finalXdr = await finalizeMultiPartyProposal({
        sourcePublicKey: result.row.proposer_address,
        funcXdr: result.row.func_xdr,
        sorobanDataXdr: result.row.soroban_data_xdr,
        entries: result.row.auth_entries.map((e) => ({ address: e.address, entryXdr: e.entryXdr, signedEntryXdr: e.signedEntryXdr })),
      });
      await markReady(proposalId, finalXdr);
      return serializeProposal({ ...result.row, status: "ready", final_xdr: finalXdr });
    }
    return serializeProposal(result.row);
  });

  // A `ready` proposal's stored final XDR was built when the last signer
  // posted, not when the proposer gets around to finalizing. Its time bound
  // (300 s) and the proposer's sequence number can both be stale by then,
  // which turned "Finalize" into a button that failed for the remaining
  // proposal TTL while every signed entry was still valid. Rebuild from the
  // stored pieces here, at click time, with a fresh account + time bound;
  // the signed auth entries and simulation footprint are reused unchanged.
  // Only the proposer can sign the result, and the XDR was already public
  // via the GET proposal route, so this adds no new capability.
  app.post<{ Params: { contractId: string; proposalId: string } }>(
    "/commitments/:contractId/tx/propose/:proposalId/refresh-ready",
    async (req) => {
      const { contractId, proposalId } = req.params;
      requireValidContractId(contractId);
      requireValidUuid(proposalId, "proposalId");

      const proposal = await getProposalById(proposalId);
      if (!proposal || proposal.contract_id !== contractId) {
        throw new BadRequestError(`no proposal ${proposalId} for contract ${contractId}`);
      }
      if (new Date(proposal.expires_at).getTime() <= Date.now()) {
        throw new BadRequestError(`proposal ${proposalId} has expired -- propose a fresh one`);
      }
      if (proposal.status !== "ready") {
        throw new BadRequestError(`proposal ${proposalId} is ${proposal.status}, not ready to finalize`);
      }

      const xdr = await finalizeMultiPartyProposal({
        sourcePublicKey: proposal.proposer_address,
        funcXdr: proposal.func_xdr,
        sorobanDataXdr: proposal.soroban_data_xdr,
        entries: proposal.auth_entries.map((e) => ({
          address: e.address,
          entryXdr: e.entryXdr,
          signedEntryXdr: e.signedEntryXdr,
        })),
      });
      return { xdr };
    },
  );

  // Every write flows through here: the frontend builds via one of the
  // /tx routes above, has the right party's wallet sign, and submits the
  // signed envelope back to this single endpoint. On success, optionally
  // refreshes the Postgres cache from a live chain read — never trusts
  // the submitted tx's own claims about the resulting state.
  app.post<{
    Body: {
      xdr: string;
      refreshContractId?: string;
      completeProposalId?: string;
      allocationContractId?: string;
      allocationMembers?: StagedAllocationMember[];
    };
  }>("/transactions/submit", async (req, reply) => {
    // Validated before submitting, not after: a bad refreshContractId
    // shouldn't leave the caller wondering whether their (real, funds-
    // moving) transaction went through or not because the response came
    // back an error either way.
    if (req.body.refreshContractId) {
      requireValidContractId(req.body.refreshContractId);
    }
    if (req.body.allocationContractId) {
      requireValidContractId(req.body.allocationContractId);
    }
    const result = await submitSignedTransaction(req.body.xdr);

    // The network accepted the transaction but confirmation outlived the
    // poll window. Persist the hash and every side-effect field so
    // GET /transactions/:hash can report the real outcome later and apply
    // them exactly once on the first SUCCESS. A persistence failure is
    // logged but still answered 202: the transaction is already on-chain,
    // so a 500 here would repeat the exact lie this change removes.
    if (result.status === "PENDING") {
      await createPendingSubmission({
        hash: result.hash,
        refreshContractId: req.body.refreshContractId,
        completeProposalId: req.body.completeProposalId,
        allocationContractId: req.body.allocationContractId,
        allocationMembers: req.body.allocationMembers,
      }).catch((err: unknown) => {
        req.log.error(
          { err },
          "failed to persist pending submission; GET /transactions/:hash will not be able to report it",
        );
      });
      return reply.code(202).send({ status: "PENDING", hash: result.hash });
    }

    await applySubmitSideEffects(req.log, req.body);
    return result;
  });

  /**
   * The follow-up for a PENDING submit. Polls the chain for the hash and
   * returns the same three-state vocabulary the submit route uses. The
   * first observation of SUCCESS atomically claims the stored side-effect
   * fields, so exactly one poll applies them even if a frontend polls
   * twice (or from two tabs) at once. Terminal rows are answered from
   * Postgres without touching the chain again.
   */
  app.get<{ Params: { hash: string } }>("/transactions/:hash", async (req) => {
    requireValidTransactionHash(req.params.hash);
    const hash = req.params.hash.toLowerCase();

    const pending = await getPendingSubmission(hash);
    if (!pending) {
      throw new NotFoundError(`no pending submission with hash ${hash}`);
    }
    if (pending.status !== "pending") {
      return { status: pending.status === "success" ? "SUCCESS" : "FAILED", hash };
    }

    const status = await getTransactionStatus(hash);
    if (status === "PENDING") {
      return { status, hash };
    }
    if (status === "FAILED") {
      await markPendingSubmissionFailed(hash);
      return { status, hash };
    }

    const claimed = await claimPendingSubmissionSuccess(hash);
    if (claimed) {
      await applySubmitSideEffects(req.log, {
        refreshContractId: claimed.refresh_contract_id ?? undefined,
        completeProposalId: claimed.complete_proposal_id ?? undefined,
        allocationContractId: claimed.allocation_contract_id ?? undefined,
        allocationMembers: claimed.allocation_members ?? undefined,
      });
    }
    return { status, hash };
  });

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

  app.get<{ Querystring: { limit?: string; offset?: string } }>("/commitments", async (req, reply) => {
  // Number(undefined) and Number("abc") are both NaN -- never nullish --
  // so the previous `Number(req.query.limit) ?? 20` never fell back: a
  // bare GET /commitments sent LIMIT NaN to Postgres and 500'd with
  // "invalid input syntax for type bigint". That's the exact call
  // buyer-app/coop-pwa make (no query string at all), so the list route
  // was broken for them. Non-finite or out-of-range values now fall back
  // to the documented defaults instead of reaching the driver. A finite
  // limit is also clamped to MAX_PAGE_SIZE: falling back on bad values
  // alone still left a caller free to ask for limit=1000000, which is the
  // unbounded read issue #225 was filed against.
  const parsedLimit = Number(req.query.limit);
  const parsedOffset = Number(req.query.offset);
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(Math.floor(parsedLimit), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? Math.floor(parsedOffset) : 0;
  const commitments = await listCommitments({ limit, offset });
  return reply.send(commitments);
});

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
