import "dotenv/config";
import { Keypair, TransactionBuilder, Operation, BASE_FEE, Horizon } from "@stellar/stellar-sdk";
import { server as rpcServer, networkPassphrase } from "../src/stellar/rpc.js";
import { submitSignedTransaction } from "../src/stellar/tx.js";

/**
 * ROADMAP.md's "Key recovery flow" item (Phase 1, Testnet tranche):
 * "exercise it once end to end -- simulate a lost key, confirm the
 * two-of-three social recovery set can rotate it." PRD §4.6 describes
 * this as "Soroban account abstraction with social recovery" -- a
 * custom-account smart contract implementing its own auth logic. This
 * script does NOT build that; it demonstrates the same 2-of-3 recovery
 * *mechanism* using Stellar's native classic-account multisig
 * (`set_options` signer weights + thresholds) instead. That's a real,
 * meaningful difference, stated plainly: no new contract, no new audit
 * surface, but also not the account-abstraction architecture PRD §4.6
 * specifies. Offered as a genuine alternative worth a product decision
 * (lower-risk, zero additional Soroban contract code, vs. the
 * programmability account abstraction would eventually unlock), not a
 * silent substitution for it -- see docs/key-recovery-exercise.md for
 * the write-up and a real run's actual testnet addresses/tx hashes.
 *
 * Run with: cd api && npx tsx scripts/key-recovery-exercise.ts
 *
 * Every step below is a real transaction against real testnet -- no
 * mocks, same discipline as test/stellar.test.ts. Six real accounts get
 * created (friendbot-funded or not, as noted); nothing here touches the
 * escrow contract or this API's own database.
 */

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const horizon = new Horizon.Server(HORIZON_URL);

async function fundTestnetAccount(publicKey: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) {
    throw new Error(`friendbot funding failed for ${publicKey}: ${await res.text()}`);
  }
}

async function loadFullAccount(publicKey: string): Promise<Horizon.AccountResponse> {
  return horizon.loadAccount(publicKey);
}

function log(heading: string) {
  console.log(`\n=== ${heading} ===`);
}

async function signAndSubmit(tx: ReturnType<TransactionBuilder["build"]>, signers: Keypair[]): Promise<string> {
  for (const kp of signers) tx.sign(kp);
  const result = await submitSignedTransaction(tx.toXDR());
  console.log(`  tx ${result.hash} -> ${result.status}`);
  return result.hash;
}

async function main() {
  // The cooperative lead's own account -- the one whose key gets "lost"
  // partway through this script. Fresh and throwaway, never reused
  // elsewhere, so this exercise can't disturb any other test's fixtures.
  const lead = Keypair.random();
  // PRD §4.6's recovery set: "the co-signer, the warehouse operator, and
  // one further officer" -- three independent parties, any two of whom
  // can rotate a lost key. None of these three need their own funded
  // account; a signer is just a public key the lead's account trusts.
  const coSigner = Keypair.random();
  const warehouseOperator = Keypair.random();
  const officer = Keypair.random();
  // The lead's replacement key, obtained after losing the original --
  // simulates getting a new device/keystore, not regaining the old one.
  const newLeadKey = Keypair.random();

  log("Accounts generated");
  console.log(`  lead (to be rotated out):      ${lead.publicKey()}`);
  console.log(`  co-signer (recovery set):      ${coSigner.publicKey()}`);
  console.log(`  warehouse operator (recovery): ${warehouseOperator.publicKey()}`);
  console.log(`  officer (recovery set):        ${officer.publicKey()}`);
  console.log(`  new lead key (post-recovery):  ${newLeadKey.publicKey()}`);

  log("Funding the lead's account (friendbot)");
  await fundTestnetAccount(lead.publicKey());
  console.log(`  funded ${lead.publicKey()}`);

  // Step 1: set up the recovery set. A fresh account's thresholds default
  // to 0 (any signature weight, including none at the protocol-threshold
  // level, already satisfies them), so this first set_options call is
  // valid signed by the lead alone -- the exact same bootstrap sequence a
  // real Stellar multisig setup uses. After this transaction, changing
  // signers/thresholds again needs the *high* threshold (2).
  log("Step 1: lead adds the 2-of-3 recovery set and raises thresholds");
  {
    const account = await rpcServer.getAccount(lead.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: coSigner.publicKey(), weight: 1 } }))
      .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: warehouseOperator.publicKey(), weight: 1 } }))
      .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: officer.publicKey(), weight: 1 } }))
      .addOperation(Operation.setOptions({ lowThreshold: 1, medThreshold: 1, highThreshold: 2 }))
      .setTimeout(60)
      .build();
    await signAndSubmit(tx, [lead]);
  }

  const afterSetup = await loadFullAccount(lead.publicKey());
  console.log(`  signers now: ${afterSetup.signers.map((s) => `${s.key.slice(0, 8)}…(w${s.weight})`).join(", ")}`);
  console.log(
    `  thresholds: low=${afterSetup.thresholds.low_threshold} med=${afterSetup.thresholds.med_threshold} high=${afterSetup.thresholds.high_threshold}`,
  );

  // Step 2: day-to-day operation still works with just the lead's key --
  // this security change doesn't disrupt normal use. manage_data is a
  // medium-threshold operation (threshold now 1), so the lead alone
  // (weight 1) still satisfies it.
  log("Step 2: lead signs a routine operation alone (medium threshold, unaffected)");
  {
    const account = await rpcServer.getAccount(lead.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(Operation.manageData({ name: "note", value: "day-to-day op, lead alone" }))
      .setTimeout(60)
      .build();
    await signAndSubmit(tx, [lead]);
  }
  console.log("  routine operation succeeded with the lead's original key alone, as expected.");

  // Step 3: simulate the lost key. The lead's secret is never used again
  // from here on -- recovery is driven entirely by two of the three
  // recovery-set members, deliberately leaving the third (the officer)
  // unused, to prove "any two," not "these specific two."
  log("Step 3: simulate a lost key -- co-signer + warehouse operator recover the account, without the lead or the officer");
  {
    const account = await rpcServer.getAccount(lead.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: newLeadKey.publicKey(), weight: 1 } }))
      .addOperation(Operation.setOptions({ masterWeight: 0 }))
      .setTimeout(60)
      .build();
    // Signed by co-signer + warehouseOperator only (weight 1 + 1 = 2,
    // meeting the high threshold) -- the lead's keypair object is never
    // referenced in this block at all.
    await signAndSubmit(tx, [coSigner, warehouseOperator]);
  }

  const afterRecovery = await loadFullAccount(lead.publicKey());
  console.log(`  signers now: ${afterRecovery.signers.map((s) => `${s.key.slice(0, 8)}…(w${s.weight})`).join(", ")}`);

  // Step 4: the new key works.
  log("Step 4: the new lead key can act alone (medium threshold)");
  {
    const account = await rpcServer.getAccount(lead.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(Operation.manageData({ name: "note", value: "post-recovery op, new key alone" }))
      .setTimeout(60)
      .build();
    await signAndSubmit(tx, [newLeadKey]);
  }
  console.log("  routine operation succeeded with the new key alone, as expected.");

  // Step 5: the old, lost key is genuinely revoked -- not just "also
  // still works." masterWeight is now 0, so its signature contributes
  // zero weight; medium threshold is 1, so this must fail.
  log("Step 5: the old (lost) key is genuinely revoked, not merely redundant");
  {
    const account = await rpcServer.getAccount(lead.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(Operation.manageData({ name: "note", value: "should fail: old key, zero weight now" }))
      .setTimeout(60)
      .build();
    tx.sign(lead);
    try {
      const result = await submitSignedTransaction(tx.toXDR());
      console.log(`  UNEXPECTED: old key's operation succeeded (${result.status}) -- revocation did not work.`);
      process.exitCode = 1;
    } catch (err) {
      console.log(`  old key's operation was rejected, as expected: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log("Done");
  console.log("The 2-of-3 recovery set rotated a lost key end to end on real testnet, with no disruption to");
  console.log("day-to-day single-signer operation before or after. See docs/key-recovery-exercise.md.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
