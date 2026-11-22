import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Keypair } from "@stellar/stellar-sdk";
import {
  API_URL,
  LIVE,
  NATIVE_TOKEN_CONTRACT,
  SKIP_REASON,
  buyerKeypair,
  cooperativeKeypair,
  warehouseKeypair,
} from "./helpers/env";
import { connectInjectedWallet, setInjectedSigningRejected } from "./helpers/freighter";
import {
  deployAndInitialize,
  ensureFunded,
  flagDispute,
  getCommitment,
  getReassignBuyerProposal,
  getResolveDisputeProposal,
  proposeResolveDispute,
  submitMethod,
} from "./helpers/api";

/**
 * Issue #198: one real end-to-end smoke test for buyer-app. Unlike this
 * app's own vitest suite (fetch and wallet fully mocked), this drives a
 * real browser against a real API and real testnet: the create-commitment
 * form's deploy → build initialize → sign → submit → read-back walk
 * happens exactly as a real buyer would run it, with a throwaway testnet
 * keypair injected in place of a Freighter extension. It exists to catch
 * the class of integration break the mocked suites structurally can't —
 * a CORS regression, an API route/shape drift, an SDK signing mismatch.
 *
 * The one thing this test does differently from a real buyer is the
 * wallet: no Freighter extension exists in this environment (a
 * long-documented limitation of this project), so the postMessage
 * channel Freighter uses is stubbed and backed by the test's own
 * throwaway keypair — see helpers/freighter.ts.
 */
test.skip(!LIVE, SKIP_REASON);

test("creates a commitment end to end through the real API and testnet", async ({ page }) => {
  // Only the buyer needs a real, funded account here: they're the only
  // party whose signature this flow requires (`initialize` is
  // buyer-signed). The other two are plain addresses the contract stores.
  const buyer = buyerKeypair();
  const cooperative = Keypair.random();
  const warehouse = Keypair.random();
  await ensureFunded(buyer.publicKey());

  await connectInjectedWallet(page, buyer);
  await page.goto("/");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.locator(".wallet-address")).toContainText(buyer.publicKey().slice(0, 4));

  await page.getByRole("button", { name: "Create commitment" }).click();
  await page.getByLabel("Cooperative address").fill(cooperative.publicKey());
  await page.getByLabel("Warehouse operator address").fill(warehouse.publicKey());
  await page.getByLabel("Token contract address").fill(NATIVE_TOKEN_CONTRACT);
  await page.getByLabel("Total amount (stroops)").fill("1000000000");
  await page.getByLabel("Advance 1 share (basis points)").fill("1500");
  await page.getByLabel("Advance 2 share (basis points)").fill("2000");
  await page.getByLabel("Claim window (seconds)").fill("3600");
  await page.getByLabel("Remainder-payment window (seconds)").fill("3600");
  await page.getByLabel("Delivery window (seconds)").fill("86400");
  await page.getByLabel("Contracted quantity").fill("1000");
  await page.getByLabel("Grade price schedule").fill("10000,9000,7500");
  await page.getByLabel(/Roles & Responsibilities/).check();

  // Grab the freshly deployed contract's ID from the API's own response
  // (the UI only renders it truncated, with the full value in a title).
  const deployResponse = page.waitForResponse(
    (res) => res.url() === `${API_URL}/commitments/deploy` && res.request().method() === "POST",
  );
  await page.locator("form.create-commitment-form button[type=submit]").click();
  const { contractId } = (await (await deployResponse).json()) as { contractId: string };
  expect(contractId).toMatch(/^C[A-Z2-7]{55}$/);

  // The UI read-back: detail view opens on the new commitment, showing
  // its real on-chain status (read live from testnet through the API).
  await expect(page.locator(".detail-header .badge")).toHaveText("Draft", { timeout: 120_000 });
  await expect(page.locator(".detail-header .contract-id")).toHaveAttribute("title", contractId);

  // The chain truth, read independently of the UI: every field the form
  // submitted genuinely landed on the contract.
  const commitment = await getCommitment(contractId);
  expect(commitment.status).toBe("Draft");
  expect(commitment.buyer).toBe(buyer.publicKey());
  expect(commitment.cooperative).toBe(cooperative.publicKey());
  expect(commitment.warehouse_operator).toBe(warehouse.publicKey());
  expect(commitment.token).toBe(NATIVE_TOKEN_CONTRACT);
  expect(commitment.total_amount).toBe("1000000000");
  expect(commitment.contracted_quantity).toBe(1000);
  expect(commitment.grade_price_bps).toEqual([10_000, 9_000, 7_500]);
});

/** Connects the injected wallet and opens `contractId` — the shared first UI steps of the QA flow below. */
async function connectAndLookUp(page: Page, publicKey: string, contractId: string): Promise<void> {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.locator(".wallet-address")).toContainText(publicKey.slice(0, 4));
  await page.locator("#contract-lookup").fill(contractId);
  await page.getByRole("button", { name: "Look up" }).click();
}

/**
 * Manual Freighter QA coverage for #45 — see
 * docs/qa/manual-freighter-qa-45-54-59-60.md for the write-up this test
 * backs. Real browser, real API, real testnet; only the extension is
 * stubbed (helpers/freighter.ts, speaking Freighter's real postMessage
 * protocol).
 *
 * Note what "propose reassigning" actually does: it POSTs a staged
 * multi-party proposal and invokes no wallet call at all. The Freighter
 * popup belongs to the next step — the cooperative and incoming buyer
 * each approve by signing their own auth entry (`signAuthEntry`), and
 * the outgoing buyer finalizes with a classic signature. This test
 * asserts the propose made zero signing requests, then drives the
 * incoming buyer's approve through the same UI, rejected once and then
 * accepted, so the signing layer is exercised too.
 */
test("#45 proposes reassigning the buyer position end to end", async ({ page }) => {
  const buyer = buyerKeypair();
  const cooperative = cooperativeKeypair();
  const warehouse = Keypair.random();
  const incomingBuyer = Keypair.random();

  // The cooperative and incoming buyer will both sign auth entries later,
  // and an address-credentials check reads a real account — fund both.
  // The warehouse operator is only a stored address in this flow.
  await Promise.all([
    ensureFunded(buyer.publicKey()),
    ensureFunded(cooperative.publicKey()),
    ensureFunded(incomingBuyer.publicKey()),
  ]);
  const contractId = await deployAndInitialize({ buyer, cooperative, warehouse });

  const wallet = await connectInjectedWallet(page, buyer);
  await page.goto("/");
  await connectAndLookUp(page, buyer.publicKey(), contractId);
  await expect(page.locator(".detail-header .badge")).toHaveText("Draft", { timeout: 120_000 });

  await page.locator("#new-buyer-address").fill(incomingBuyer.publicKey());
  await page.getByRole("button", { name: "Propose reassignment" }).click();

  await expect(page.locator(".reassign-section")).toContainText(
    "Reassignment proposed — waiting for the cooperative and the new buyer to approve.",
  );
  const proposed = await getReassignBuyerProposal(contractId);
  expect(proposed.proposal).not.toBeNull();
  expect(proposed.proposal!.status).toBe("pending");
  expect(proposed.proposal!.proposer_address).toBe(buyer.publicKey());
  expect(proposed.proposal!.pending_entries.map((e) => e.address).sort()).toEqual(
    [cooperative.publicKey(), incomingBuyer.publicKey()].sort(),
  );
  // Proposing opened no Freighter popup — nothing was signed here.
  expect(wallet.signRequests).toEqual([]);
  // The outgoing buyer still owns the position until finalization.
  expect((await getCommitment(contractId)).buyer).toBe(buyer.publicKey());

  // The signing half is the approvals. Drive the incoming buyer's through
  // the same app UI, rejecting once first.
  const incomingPage = await page.context().newPage();
  const incomingWallet = await connectInjectedWallet(incomingPage, incomingBuyer);
  await incomingPage.goto("/");
  await connectAndLookUp(incomingPage, incomingBuyer.publicKey(), contractId);
  await expect(incomingPage.getByRole("button", { name: "Approve reassignment" })).toBeVisible({
    timeout: 120_000,
  });

  await setInjectedSigningRejected(incomingPage, true);
  await incomingPage.getByRole("button", { name: "Approve reassignment" }).click();
  await expect(incomingPage.locator(".reassign-section .error-banner")).toContainText(
    "The user rejected this request.",
  );
  expect((await getReassignBuyerProposal(contractId)).proposal!.pending_entries).toHaveLength(2);

  await setInjectedSigningRejected(incomingPage, false);
  await incomingPage.getByRole("button", { name: "Approve reassignment" }).click();
  await expect(incomingPage.locator(".reassign-section")).toContainText(
    "Approved — waiting for the other party to approve too.",
  );
  await expect
    .poll(async () => (await getReassignBuyerProposal(contractId)).proposal!.pending_entries.length, {
      timeout: 120_000,
    })
    .toBe(1);
  expect((await getReassignBuyerProposal(contractId)).proposal!.pending_entries[0].address).toBe(
    cooperative.publicKey(),
  );
  expect(incomingWallet.signRequests).toContain("SUBMIT_AUTH_ENTRY");
  // Still the old buyer until the cooperative approves and the current
  // buyer finalizes.
  expect((await getCommitment(contractId)).buyer).toBe(buyer.publicKey());
});

/**
 * Issues #50/#51: the two non-proposing parties approve the staged
 * resolve_dispute auth entries from buyer-app, then the proposer finalizes
 * the ready envelope. Everything except the extension is real here: real
 * API, real testnet, real contracts, and Freighter's real postMessage
 * channel backed by throwaway keypairs.
 */
test("#50/#51 approves and finalizes a dispute resolution end to end", async ({ page }) => {
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
  await flagDispute(contractId, warehouse);
  await proposeResolveDispute(contractId, buyer);

  // Approver #1: the cooperative, with a declined attempt first (#50's
  // rejection-handling half).
  await connectInjectedWallet(page, cooperative);
  await page.goto("/");
  await connectAndLookUp(page, cooperative.publicKey(), contractId);
  const approveButton = page.getByRole("button", { name: "Approve resolution" });
  await expect(approveButton).toBeVisible({ timeout: 120_000 });

  await setInjectedSigningRejected(page, true);
  await approveButton.click();
  await expect(page.locator(".dispute-section .error-banner")).toContainText("The user rejected this request.");
  expect((await getResolveDisputeProposal(contractId)).proposal!.pending_entries).toHaveLength(2);

  await setInjectedSigningRejected(page, false);
  await approveButton.click();
  await expect(page.locator(".dispute-section")).toContainText(
    "Approved — waiting for the remaining party to approve too.",
  );

  // Approver #2: the warehouse operator, whose wallet is a different party
  // and therefore a different signed auth entry.
  const warehousePage = await page.context().newPage();
  const warehouseWallet = await connectInjectedWallet(warehousePage, warehouse);
  await warehousePage.goto("/");
  await connectAndLookUp(warehousePage, warehouse.publicKey(), contractId);
  await warehousePage.getByRole("button", { name: "Approve resolution" }).click();
  await expect
    .poll(async () => (await getResolveDisputeProposal(contractId)).proposal!.status, { timeout: 120_000 })
    .toBe("ready");
  expect(warehouseWallet.signRequests).toContain("SUBMIT_AUTH_ENTRY");
  expect((await getCommitment(contractId)).status).toBe("Disputed");

  // Finalize (#51) as the proposer. The UI keeps the ready action until the
  // parent's live chain read shows the dispute is actually over.
  const buyerPage = await page.context().newPage();
  const buyerWallet = await connectInjectedWallet(buyerPage, buyer);
  await buyerPage.goto("/");
  await connectAndLookUp(buyerPage, buyer.publicKey(), contractId);
  await expect(buyerPage.getByRole("button", { name: "Finalize resolution" })).toBeVisible({ timeout: 120_000 });
  await buyerPage.getByRole("button", { name: "Finalize resolution" }).click();

  await expect(buyerPage.locator(".detail-header .badge")).toHaveText("Locked", { timeout: 120_000 });
  expect(buyerWallet.signRequests).toContain("SUBMIT_TRANSACTION");
  const commitment = await getCommitment(contractId);
  expect(commitment.status).toBe("Locked");
  expect(commitment.dispute_pre_status).toBe("Draft");
});
