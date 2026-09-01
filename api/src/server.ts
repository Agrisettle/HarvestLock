import Fastify from "fastify";
import cors from "@fastify/cors";
import { getCommitment, type Commitment } from "./stellar/client.js";
import { deployContractInstance, initializeArgs } from "./stellar/deploy.js";
import { buildInvokeTransaction, submitSignedTransaction } from "./stellar/tx.js";
import { upsertCommitment, listCommitments } from "./db/commitments.js";
import { pool } from "./db/pool.js";

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
    async (req) => {
      const { contractId } = req.params;
      const b = req.body;
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

  // Every write flows through here: the frontend builds via one of the
  // /tx routes above, has the right party's wallet sign, and submits the
  // signed envelope back to this single endpoint. On success, optionally
  // refreshes the Postgres cache from a live chain read — never trusts
  // the submitted tx's own claims about the resulting state.
  app.post<{ Body: { xdr: string; refreshContractId?: string } }>(
    "/transactions/submit",
    async (req) => {
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
