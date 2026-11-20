import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";

// Single place e2e/.env is loaded, whatever the working directory --
// playwright.config.ts, global-setup.ts, and every spec (via their
// helpers) import these constants rather than reading process.env
// themselves, so there's exactly one answer to "what is the API URL".
loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

/** The explicit opt-in. Without it every spec skips -- see README.md. */
export const LIVE = /^(1|true|yes)$/i.test(process.env.E2E_LIVE ?? "");

export const SKIP_REASON =
  "live e2e test: set E2E_LIVE=1 and start the local API + Postgres (see e2e/README.md)";

export const API_URL = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

export const APP_ORIGINS: Record<"buyer-app" | "coop-pwa" | "warehouse-app", string> = {
  "buyer-app": process.env.E2E_BUYER_ORIGIN ?? "http://localhost:5173",
  "coop-pwa": process.env.E2E_COOP_ORIGIN ?? "http://localhost:5174",
  "warehouse-app": process.env.E2E_WAREHOUSE_ORIGIN ?? "http://localhost:5175",
};

/** Matches @stellar/stellar-sdk's Networks.TESTNET, the only network this project's testnet-only frontends ever build for. */
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

export const HORIZON_URL = process.env.E2E_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
export const FRIENDBOT_URL = process.env.E2E_FRIENDBOT_URL ?? "https://friendbot.stellar.org";

/**
 * Native XLM's Stellar Asset Contract on testnet -- the same real token
 * the API's own live tests use (`PLACEHOLDER_TOKEN` in
 * api/test/stellar.test.ts is actually this address, not a placeholder
 * at all: escrow transfers really move testnet XLM through it). The
 * buyer's friendbot-funded balance is what `lock` escrows, and what
 * `claim_advance_*` pays out.
 */
export const NATIVE_TOKEN_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/** The API's API-level floor for each window (api/src/server.ts) -- the shortest the HTTP route will accept. */
export const WINDOW_SECS = { claim: "3600", remainder: "3600", delivery: "86400" } as const;

function keypairFrom(envName: string): Keypair {
  const secret = process.env[envName];
  return secret ? Keypair.fromSecret(secret) : Keypair.random();
}

/**
 * Throwaway testnet keypairs, one per party, used both for the direct
 * API setup calls (via @stellar/stellar-sdk, Node-side) and for the
 * injected wallet stub (via the same keypair's signature coming back
 * through the page's postMessage channel). Generated fresh per test
 * unless a fixed secret is set in e2e/.env -- either way the test
 * itself guarantees funding via friendbot (see ensureFunded), so no
 * party ever has a real wallet behind it.
 */
export const buyerKeypair = () => keypairFrom("E2E_BUYER_SECRET");
export const cooperativeKeypair = () => keypairFrom("E2E_COOPERATIVE_SECRET");
export const warehouseKeypair = () => keypairFrom("E2E_WAREHOUSE_SECRET");
