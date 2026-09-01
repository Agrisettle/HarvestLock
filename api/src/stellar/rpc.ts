import { rpc, Networks } from "@stellar/stellar-sdk";

const rpcUrl = process.env.STELLAR_RPC_URL;
if (!rpcUrl) {
  throw new Error("STELLAR_RPC_URL is not set");
}

export const server = new rpc.Server(rpcUrl);

export const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
