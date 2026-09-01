import {
  Address,
  Keypair,
  Operation,
  TransactionBuilder,
  BASE_FEE,
  rpc,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { randomBytes } from "node:crypto";
import { server, networkPassphrase } from "./rpc.js";

/**
 * One contract instance per commitment (PRD §4.8) — there is no factory
 * contract, so "creating a commitment" means deploying a fresh instance
 * of the escrow WASM. Deploying is a network operation, not a contract
 * call, so it needs a source account to pay the fee but no party's
 * require_auth — that only kicks in once `initialize` is called (buyer-
 * signed, via the generic tx.ts build/submit path, not this module).
 */

function deployerKeypair(): Keypair {
  const secret = process.env.DEPLOYER_SECRET_KEY;
  if (!secret) {
    throw new Error("DEPLOYER_SECRET_KEY is not set — needed to pay contract-deploy fees");
  }
  return Keypair.fromSecret(secret);
}

function wasmHashBytes(): Buffer {
  const hex = process.env.ESCROW_WASM_HASH;
  if (!hex) {
    throw new Error("ESCROW_WASM_HASH is not set — see .env.example for how to get it");
  }
  return Buffer.from(hex, "hex");
}

/** Deploys a new, uninitialized escrow contract instance. Returns its contract ID (C...). */
export async function deployContractInstance(): Promise<string> {
  const deployer = deployerKeypair();
  const account = await server.getAccount(deployer.publicKey());
  const salt = randomBytes(32);

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(
      Operation.createCustomContract({
        address: new Address(deployer.publicKey()),
        wasmHash: wasmHashBytes(),
        salt,
      }),
    )
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulation failed for contract deploy: ${sim.error}`);
  }

  const assembled = rpc.assembleTransaction(tx, sim).build();
  assembled.sign(deployer);

  const sendResult = await server.sendTransaction(assembled);
  if (sendResult.status === "ERROR") {
    throw new Error(`deploy rejected at submission: ${JSON.stringify(sendResult.errorResult)}`);
  }

  const hash = sendResult.hash;
  const started = Date.now();
  let result: rpc.Api.GetTransactionResponse;
  for (;;) {
    result = await server.getTransaction(hash);
    if (result.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) break;
    if (Date.now() - started > 30_000) {
      throw new Error(`timed out waiting for deploy transaction ${hash} to be included`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`deploy transaction ${hash} failed: ${JSON.stringify(result)}`);
  }

  if (!("returnValue" in result) || !result.returnValue) {
    throw new Error(`deploy transaction ${hash} succeeded but returned no contract address`);
  }
  return Address.fromScVal(result.returnValue).toString();
}

export interface InitializeArgs {
  buyer: string;
  cooperative: string;
  warehouseOperator: string;
  token: string;
  totalAmount: bigint;
  advance1Bps: number;
  advance2Bps: number;
  claimWindowSecs: bigint;
}

/** Builds the `initialize` args in the exact order lib.rs declares them. */
export function initializeArgs(a: InitializeArgs): xdr.ScVal[] {
  return [
    new Address(a.buyer).toScVal(),
    new Address(a.cooperative).toScVal(),
    new Address(a.warehouseOperator).toScVal(),
    new Address(a.token).toScVal(),
    nativeToScVal(a.totalAmount, { type: "i128" }),
    nativeToScVal(a.advance1Bps, { type: "u32" }),
    nativeToScVal(a.advance2Bps, { type: "u32" }),
    nativeToScVal(a.claimWindowSecs, { type: "u64" }),
  ];
}
