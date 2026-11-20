import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { LIVE, SKIP_REASON, buyerKeypair, cooperativeKeypair, warehouseKeypair } from "./helpers/env";
import { connectInjectedWallet, setInjectedSigningRejected } from "./helpers/freighter";
import {
  deployAndInitialize,
  ensureFunded,
  flagDispute,
  getAllocationLedger,
  getCommitment,
  getResolveDisputeProposal,
  submitMethod,
} from "./helpers/api";

/**
 * Issue #199: one real end-to-end smoke test for coop-pwa. Unlike this
 * app's own vitest suite (fetch and wallet fully mocked), this drives a
 * real browser against a real API and real testnet: the cooperative
 * claims advance tranche 1 through the actual UI, signed by a throwaway
 * testnet keypair injected in place of a Freighter extension.
 *
 * Claiming needs a commitment that's already Locked with advance 1
 * released — state no single-app UI can reach on its own — so the test
 * sets that up first through the same real HTTP routes and testnet
 * transactions, driven from Node (helpers/api.ts). That setup is real,
 * not mocked: the browser then reads it back live and the claim itself
 * is the only step under test.
 */
test.skip(!LIVE, SKIP_REASON);

test("claims advance tranche 1 end to end through the real API and testnet", async ({ page }) => {
  const buyer = buyerKeypair();
  const cooperative = cooperativeKeypair();
  const warehouse = warehouseKeypair();

  // All three parties' accounts must really exist: `lock` needs the
  // buyer funded (it escrows real testnet XLM), `release_advance_1`
  // needs the warehouse operator's account for its auth check, and the
  // cooperative's own signature on the claim reads their account too.
  await Promise.all([
    ensureFunded(buyer.publicKey()),
    ensureFunded(cooperative.publicKey()),
    ensureFunded(warehouse.publicKey()),
  ]);

  const contractId = await deployAndInitialize({ buyer, cooperative, warehouse });
  await submitMethod(contractId, "lock", buyer);
  await submitMethod(contractId, "release_advance_1", warehouse);

  await connectInjectedWallet(page, cooperative);
  await page.goto("/");

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.locator(".wallet-address")).toContainText(cooperative.publicKey().slice(0, 4));

  await page.locator("#contract-lookup").fill(contractId);
  await page.getByRole("button", { name: "Look up" }).click();

  const advance1Row = page.locator(".tranches tbody tr").first();
  await expect(advance1Row).toContainText("pending", { timeout: 120_000 });
  await advance1Row.getByRole("button", { name: "Claim", exact: true }).click();

  // UI read-back: the state cell flips to "claimed" once the app re-reads
  // the commitment from chain after its submit.
  await expect(advance1Row.getByText("claimed")).toBeVisible({ timeout: 120_000 });

  // Chain truth, independent of the UI.
  const commitment = await getCommitment(contractId);
  expect(commitment.advance1_claimed).toBe(true);
  expect(commitment.advance1_expired).toBe(false);
});

/** Connects the injected wallet and opens `contractId` — the shared first UI steps of every flow below. */
async function connectAndLookUp(page: Page, publicKey: string, contractId: string): Promise<void> {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.locator(".wallet-address")).toContainText(publicKey.slice(0, 4));
  await page.locator("#contract-lookup").fill(contractId);
  await page.getByRole("button", { name: "Look up" }).click();
}

/**
 * Manual Freighter QA coverage for #54, #59, #60 — see
 * docs/qa/manual-freighter-qa-45-54-59-60.md for the write-up these
 * tests back. Same real-browser/real-API/real-testnet mechanism as the
 * #199 test above; only the extension is stubbed, at its real
 * postMessage protocol.
 *
 * The propose flows (#60 here, #45 in buyer-app) invoke no wallet call
 * at all: the API stages the other parties' auth entries, and the
 * Freighter popup appears later when those parties approve
 * (`signAuthEntry`) or when the proposer finalizes (`signTransaction`).
 * The tests assert that directly (zero signing requests at propose) and
 * then drive a real, rejected-then-accepted approve, so the signing
 * layer these issues ask about is still exercised.
 */
test("#54 records a member allocation ledger end to end", async ({ page }) => {
  const buyer = buyerKeypair();
  const cooperative = cooperativeKeypair();
  const warehouse = warehouseKeypair();
  const phoneA = "+2348012345678";
  const phoneB = "+2348098765432";

  await Promise.all([
    ensureFunded(buyer.publicKey()),
    ensureFunded(cooperative.publicKey()),
    ensureFunded(warehouse.publicKey()),
  ]);
  const contractId = await deployAndInitialize({ buyer, cooperative, warehouse });

  await connectInjectedWallet(page, cooperative);
  await page.goto("/");
  await connectAndLookUp(page, cooperative.publicKey(), contractId);

  // Draft with no ledger yet is the only state that offers the form.
  await expect(page.getByText("No allocation ledger has been recorded yet.")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Record member allocation" })).toBeVisible();

  await page.getByLabel("Member 1 phone number").fill(phoneA);
  await page.getByLabel("Member 1 share (basis points)").fill("6000");
  await page.getByRole("button", { name: "Add member" }).click();
  await page.getByLabel("Member 2 phone number").fill(phoneB);
  await page.getByLabel("Member 2 share (basis points)").fill("4000");

  // Rejected in the extension: the app reports it, resets, and nothing
  // reaches the chain.
  await setInjectedSigningRejected(page, true);
  await page.getByRole("button", { name: "Record allocation" }).click();
  await expect(page.locator(".allocation-section .error-banner")).toContainText(
    "The user rejected this request.",
  );
  await expect(page.getByRole("button", { name: "Record allocation" })).toBeEnabled();
  expect(await getAllocationLedger(contractId)).toBeNull();

  // Accepted on retry: the UI re-reads the ledger from chain and renders
  // hashes + shares, never a phone number.
  await setInjectedSigningRejected(page, false);
  await page.getByRole("button", { name: "Record allocation" }).click();

  const ledgerRows = page.locator(".allocation-table tbody tr");
  await expect(ledgerRows).toHaveCount(2, { timeout: 120_000 });
  await expect(page.locator(".allocation-table")).toContainText("60.00%");
  await expect(page.locator(".allocation-table")).toContainText("40.00%");
  await expect(page.locator("body")).not.toContainText(phoneA);
  await expect(page.locator("body")).not.toContainText(phoneB);

  // Chain truth, independent of the UI.
  const ledger = await getAllocationLedger(contractId);
  expect(ledger).not.toBeNull();
  expect(ledger!.map((m) => m.shareBps).sort((a, b) => b - a)).toEqual([6000, 4000]);
  for (const member of ledger!) {
    expect(member.memberHash).toMatch(/^[0-9a-f]{64}$/);
  }
  expect((await getCommitment(contractId)).status).toBe("Draft");
});

test("#59 flags a dispute end to end", async ({ page }) => {
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

  await connectInjectedWallet(page, cooperative);
  await page.goto("/");
  await connectAndLookUp(page, cooperative.publicKey(), contractId);
  await expect(page.locator(".detail-header .badge")).toHaveText("Locked", { timeout: 120_000 });

  // Rejected: stays Locked, the button comes back.
  await setInjectedSigningRejected(page, true);
  await page.getByRole("button", { name: "Flag a dispute" }).click();
  await expect(page.locator(".dispute-section .error-banner")).toContainText(
    "The user rejected this request.",
  );
  await expect(page.getByRole("button", { name: "Flag a dispute" })).toBeEnabled();
  expect((await getCommitment(contractId)).status).toBe("Locked");

  // Accepted: the UI re-reads the commitment and flips to Disputed.
  await setInjectedSigningRejected(page, false);
  await page.getByRole("button", { name: "Flag a dispute" }).click();

  await expect(page.locator(".detail-header .badge")).toHaveText("Disputed", { timeout: 120_000 });
  await expect(page.locator(".dispute-section")).toContainText("every other action is frozen");
  await expect(page.getByRole("button", { name: "Propose resolving this dispute" })).toBeVisible();

  const commitment = await getCommitment(contractId);
  expect(commitment.status).toBe("Disputed");
  expect(commitment.dispute_pre_status).toBe("Locked");
});

test("#60 proposes resolving a dispute end to end", async ({ page }) => {
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

  const cooperativeWallet = await connectInjectedWallet(page, cooperative);
  await page.goto("/");
  await connectAndLookUp(page, cooperative.publicKey(), contractId);

  await expect(page.locator(".detail-header .badge")).toHaveText("Disputed", { timeout: 120_000 });
  const proposeButton = page.getByRole("button", { name: "Propose resolving this dispute" });
  await expect(proposeButton).toBeVisible({ timeout: 120_000 });
  await proposeButton.click();

  await expect(page.locator(".dispute-section")).toContainText(
    "Resolution proposed — waiting for the other two parties to approve.",
  );
  const proposed = await getResolveDisputeProposal(contractId);
  expect(proposed.proposal).not.toBeNull();
  expect(proposed.proposal!.status).toBe("pending");
  expect(proposed.proposal!.proposer_address).toBe(cooperative.publicKey());
  expect(proposed.proposal!.pending_entries.map((e) => e.address).sort()).toEqual(
    [buyer.publicKey(), warehouse.publicKey()].sort(),
  );
  // Proposing opened no Freighter popup — nothing was signed here.
  expect(cooperativeWallet.signRequests).toEqual([]);
  expect((await getCommitment(contractId)).status).toBe("Disputed");

  // The signing half of this flow is the other parties' approve. Drive
  // the buyer's through the same UI, rejecting once first.
  const buyerPage = await page.context().newPage();
  const buyerWallet = await connectInjectedWallet(buyerPage, buyer);
  await buyerPage.goto("/");
  await connectAndLookUp(buyerPage, buyer.publicKey(), contractId);
  await expect(buyerPage.getByRole("button", { name: "Approve resolution" })).toBeVisible({
    timeout: 120_000,
  });

  await setInjectedSigningRejected(buyerPage, true);
  await buyerPage.getByRole("button", { name: "Approve resolution" }).click();
  await expect(buyerPage.locator(".dispute-section .error-banner")).toContainText(
    "The user rejected this request.",
  );
  expect((await getResolveDisputeProposal(contractId)).proposal!.pending_entries).toHaveLength(2);

  await setInjectedSigningRejected(buyerPage, false);
  await buyerPage.getByRole("button", { name: "Approve resolution" }).click();
  await expect(buyerPage.locator(".dispute-section")).toContainText(
    "Approved — waiting for the remaining party to approve too.",
  );
  await expect
    .poll(async () => (await getResolveDisputeProposal(contractId)).proposal!.pending_entries.length, {
      timeout: 120_000,
    })
    .toBe(1);
  expect((await getResolveDisputeProposal(contractId)).proposal!.pending_entries[0].address).toBe(
    warehouse.publicKey(),
  );
  expect(buyerWallet.signRequests).toContain("SUBMIT_AUTH_ENTRY");
  // Still disputed until the third party approves and the proposer finalizes.
  expect((await getCommitment(contractId)).status).toBe("Disputed");
});
