import { rpc, Networks } from "@stellar/stellar-sdk";
import { ConfigurationError } from "../errors.js";

// Thrown at module load, not per-request -- this fails the process at
// boot if STELLAR_RPC_URL is missing, before the server ever starts
// listening, so it can never reach an HTTP response either way. Still
// typed as ConfigurationError for consistency with the other three
// "env var not set" throw sites (client.ts, deploy.ts) that *are*
// reachable per-request -- see errors.ts's doc comment.
const rpcUrl = process.env.STELLAR_RPC_URL;
if (!rpcUrl) {
  throw new ConfigurationError("STELLAR_RPC_URL is not set");
}

export const server = new rpc.Server(rpcUrl);

export const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
