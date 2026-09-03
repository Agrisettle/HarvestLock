import "dotenv/config";
import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { getStanding, recordBuyerDefault, recordCooperativeForfeiture } from "../src/db/reputation.js";
import { applyReputationConsequences } from "../src/reputation.js";
import type { Commitment } from "../src/stellar/client.js";

/**
 * Against the real local Postgres — no mocks, same discipline as the rest
 * of this repo's tests. Each test uses a fresh random address (`Keypair.
 * random()`, not funded — no testnet call needed, this never touches
 * Stellar itself) so tests can't collide with each other's rows; no
 * cleanup needed for the same reason stellar.test.ts's throwaway contract
 * instances don't get cleaned up either.
 */

function randomAddress(): string {
  return Keypair.random().publicKey();
}

function baseCommitment(overrides: Partial<Commitment>): Commitment {
  return {
    buyer: randomAddress(),
    cooperative: randomAddress(),
    warehouse_operator: randomAddress(),
    token: randomAddress(),
    total_amount: 1_000_000_000n,
    advance1_bps: 1500,
    advance2_bps: 2000,
    claim_window_secs: 3600n,
    remainder_window_secs: 3600n,
    status: "Locked",
    created_at: 0n,
    delivery_deadline: 0n,
    advance1_deadline: 0n,
    advance1_claimed: false,
    advance1_expired: false,
    advance2_deadline: 0n,
    advance2_claimed: false,
    advance2_expired: false,
    remainder_deadline: 0n,
    remainder_funded: false,
    contracted_quantity: 1_000,
    grade_price_bps: [10_000],
    delivered_quantity: 0,
    grade_index: 0,
    settlement_bps: 0,
    ...overrides,
  };
}

describe("db/reputation", () => {
  it("getStanding returns null for an address with no history", async () => {
    expect(await getStanding(randomAddress())).toBeNull();
  });

  it("recordBuyerDefault bars immediately, on the first occurrence -- no strike counter", async () => {
    const buyer = randomAddress();
    await recordBuyerDefault(buyer, "CFAKECONTRACT1");

    const standing = await getStanding(buyer);
    expect(standing?.barred).toBe(true);
    expect(standing?.barred_reason).toBe("buyer_default");
    expect(standing?.barred_at).not.toBeNull();
  });

  it("recordBuyerDefault called twice for the same address doesn't overwrite the original barred_at", async () => {
    const buyer = randomAddress();
    await recordBuyerDefault(buyer, "CFAKECONTRACT1");
    const first = await getStanding(buyer);

    await new Promise((r) => setTimeout(r, 20));
    await recordBuyerDefault(buyer, "CFAKECONTRACT2");
    const second = await getStanding(buyer);

    // .toEqual, not .toBe -- pg returns TIMESTAMPTZ columns as Date
    // objects, so two equal-valued timestamps are still different object
    // references.
    expect(second?.barred_at).toEqual(first?.barred_at);
  });

  it("recordCooperativeForfeiture increments the strike count without barring on the first two", async () => {
    const cooperative = randomAddress();

    const after1 = await recordCooperativeForfeiture(cooperative, "CFAKECONTRACT1");
    expect(after1.strike_count).toBe(1);
    expect(after1.barred).toBe(false);

    const after2 = await recordCooperativeForfeiture(cooperative, "CFAKECONTRACT2");
    expect(after2.strike_count).toBe(2);
    expect(after2.barred).toBe(false);
  });

  it("recordCooperativeForfeiture bars on the third strike", async () => {
    const cooperative = randomAddress();
    await recordCooperativeForfeiture(cooperative, "CFAKECONTRACT1");
    await recordCooperativeForfeiture(cooperative, "CFAKECONTRACT2");
    const after3 = await recordCooperativeForfeiture(cooperative, "CFAKECONTRACT3");

    expect(after3.strike_count).toBe(3);
    expect(after3.barred).toBe(true);
    expect(after3.barred_reason).toBe("cooperative_forfeiture_3x");
  });

  it("a fourth forfeiture after the bar keeps incrementing but doesn't touch barred_at", async () => {
    const cooperative = randomAddress();
    await recordCooperativeForfeiture(cooperative, "C1");
    await recordCooperativeForfeiture(cooperative, "C2");
    const barredAt3 = await recordCooperativeForfeiture(cooperative, "C3");
    const after4 = await recordCooperativeForfeiture(cooperative, "C4");

    expect(after4.strike_count).toBe(4);
    expect(after4.barred).toBe(true);
    expect(after4.barred_at).toEqual(barredAt3.barred_at);
  });
});

describe("reputation/applyReputationConsequences", () => {
  it("does nothing when the status hasn't changed", async () => {
    const buyer = randomAddress();
    const commitment = baseCommitment({ buyer, status: "Defaulted" });

    // previousStatus === commitment.status -- this is a re-observation of
    // an already-known Defaulted commitment, not a fresh transition.
    await applyReputationConsequences("CFAKECONTRACT", "Defaulted", commitment);

    expect(await getStanding(buyer)).toBeNull();
  });

  it("does nothing for a non-terminal status transition", async () => {
    const buyer = randomAddress();
    const commitment = baseCommitment({ buyer, status: "Locked" });

    await applyReputationConsequences("CFAKECONTRACT", "Draft", commitment);

    expect(await getStanding(buyer)).toBeNull();
  });

  it("bars the buyer on a fresh transition into Defaulted", async () => {
    const buyer = randomAddress();
    const commitment = baseCommitment({ buyer, status: "Defaulted" });

    await applyReputationConsequences("CFAKECONTRACT", "ReadyForDelivery", commitment);

    const standing = await getStanding(buyer);
    expect(standing?.barred).toBe(true);
    expect(standing?.barred_reason).toBe("buyer_default");
  });

  it("strikes the cooperative, not the buyer, on a fresh transition into Forfeited", async () => {
    const buyer = randomAddress();
    const cooperative = randomAddress();
    const commitment = baseCommitment({ buyer, cooperative, status: "Forfeited" });

    await applyReputationConsequences("CFAKECONTRACT", "Locked", commitment);

    expect(await getStanding(buyer)).toBeNull();
    const coopStanding = await getStanding(cooperative);
    expect(coopStanding?.strike_count).toBe(1);
    expect(coopStanding?.barred).toBe(false);
  });
});
