import { test, expect } from "@playwright/test";
import { LIVE, SKIP_REASON, buyerKeypair, cooperativeKeypair, warehouseKeypair } from "./helpers/env";
import { connectInjectedWallet } from "./helpers/freighter";
import { deployAndInitialize, ensureFunded, getCommitment, submitMethod } from "./helpers/api";

/**
 * Issue #200: one real end-to-end smoke test for warehouse-app. Unlike
 * this app's own vitest suite (fetch and wallet fully mocked), this
 * drives a real browser against a real API and real testnet: the
 * warehouse operator attests a delivery through the actual UI, signed by
 * a throwaway testnet keypair injected in place of a Freighter
 * extension.
 *
 * `confirm_delivery` only becomes callable once the commitment has been
 * locked, both advances released, the cooperative signals ready for
 * delivery, and the buyer funds the remainder — a full lifecycle no
 * single-app UI can reach alone. The test walks that real lifecycle
 * first through the same HTTP routes and testnet transactions from Node
 * (helpers/api.ts); the confirmation under test then runs through the
 * browser UI against that real state.
 */
test.skip(!LIVE, SKIP_REASON);

test("confirms delivery end to end through the real API and testnet", async ({ page }) => {
  const buyer = buyerKeypair();
  const cooperative = cooperativeKeypair();
  const warehouse = warehouseKeypair();

  await Promise.all([
    ensureFunded(buyer.publicKey()),
    ensureFunded(cooperative.publicKey()),
    ensureFunded(warehouse.publicKey()),
  ]);

  const contractId = await deployAndInitialize({ buyer, cooperative, warehouse });
  await submitMethod(contractId, "lock", buyer);
  await submitMethod(contractId, "release_advance_1", warehouse);
  await submitMethod(contractId, "mark_checkpoint", warehouse);
  await submitMethod(contractId, "release_advance_2", warehouse);
  await submitMethod(contractId, "ready_for_delivery", cooperative);
  await submitMethod(contractId, "fund_remainder", buyer);

  await connectInjectedWallet(page, warehouse);
  await page.goto("/");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.locator(".wallet-address")).toContainText(warehouse.publicKey().slice(0, 4));

  await page.locator("#contract-lookup").fill(contractId);
  await page.getByRole("button", { name: "Look up" }).click();

  // ReadyForDelivery + remainder funded is exactly when the real form is
  // offered (CommitmentDetail's nextAction), so its presence itself
  // confirms the setup state arrived on chain.
  await expect(page.getByRole("heading", { name: "Confirm delivery" })).toBeVisible({ timeout: 120_000 });

  // A genuinely partial delivery (950 of 1000 contracted), so the test
  // proves the quantity field's value reaches the chain rather than the
  // form's own default bouncing back.
  await page.locator("#delivered-quantity").fill("950");
  await page.locator("form.confirm-delivery-form button[type=submit]").click();

  // UI read-back: the form is replaced by the attestation record.
  await expect(page.getByRole("heading", { name: "Delivery attested" })).toBeVisible({ timeout: 120_000 });

  // Chain truth, independent of the UI.
  const commitment = await getCommitment(contractId);
  expect(commitment.status).toBe("Delivered");
  expect(commitment.delivered_quantity).toBe(950);
  expect(commitment.grade_index).toBe(0);
  // Full grade bucket (10000bps) x 950/1000 quantity => 9500bps settlement.
  expect(commitment.settlement_bps).toBe(9500);
});
