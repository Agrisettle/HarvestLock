import "dotenv/config";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { getStanding, recordBuyerDefault, recordCooperativeForfeiture } from "../src/db/reputation.js";
import { applyReputationConsequences } from "../src/reputation.js";
import { pool } from "../src/db/pool.js";
import type { Commitment } from "../src/stellar/client.js";

/**
 * Against the real local Postgres — no mocks, same discipline as the rest
 * of this repo's tests. Each test uses a fresh random address (`Keypair.
 * random()`, not funded — no testnet call needed, this never touches
 * Stellar itself) so tests can't collide with each other's rows; no
 * cleanup needed for the same reason stellar.test.ts's throwaway contract
 * instances don't get cleaned up either.
 *
 * Contract IDs are random for the same reason, and more importantly now
 * that standing_events is UNIQUE (contract_id, event_type): a fixed fake
 * ID would collide with a previous run of the same test, not just with
 * another test in this file. The one exception is the retry test, whose
 * whole point is calling twice for the same contract.
 */

function randomAddress(): string {
  return Keypair.random().publicKey();
}

function randomContractId(): string {
  return `CFAKE${Keypair.random().publicKey()}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

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
    fx_resolved: false,
    fx_adjusted_total: 0n,
    fx_shortfall_amount: 0n,
    fx_shortfall_funded: false,
    fx_shortfall_deadline: 0n,
    dispute_pre_status: "Draft",
    dispute_deadline: 0n,
    ...overrides,
  };
}

describe("db/reputation", () => {
  it("getStanding returns null for an address with no history", async () => {
    expect(await getStanding(randomAddress())).toBeNull();
  });

  it("recordBuyerDefault bars immediately, on the first occurrence -- no strike counter", async () => {
    const buyer = randomAddress();
    await recordBuyerDefault(buyer, randomContractId());

    const standing = await getStanding(buyer);
    expect(standing?.barred).toBe(true);
    expect(standing?.barred_reason).toBe("buyer_default");
    expect(standing?.barred_at).not.toBeNull();
  });

  it("recordBuyerDefault called twice for the same address doesn't overwrite the original barred_at", async () => {
    const buyer = randomAddress();
    await recordBuyerDefault(buyer, randomContractId());
    const first = await getStanding(buyer);

    await new Promise((r) => setTimeout(r, 20));
    await recordBuyerDefault(buyer, randomContractId());
    const second = await getStanding(buyer);

    // .toEqual, not .toBe -- pg returns TIMESTAMPTZ columns as Date
    // objects, so two equal-valued timestamps are still different object
    // references.
    expect(second?.barred_at).toEqual(first?.barred_at);
  });

  it("recordCooperativeForfeiture increments the strike count without barring on the first two", async () => {
    const cooperative = randomAddress();

    const after1 = await recordCooperativeForfeiture(cooperative, randomContractId());
    expect(after1.strike_count).toBe(1);
    expect(after1.barred).toBe(false);

    const after2 = await recordCooperativeForfeiture(cooperative, randomContractId());
    expect(after2.strike_count).toBe(2);
    expect(after2.barred).toBe(false);
  });

  it("recordCooperativeForfeiture bars on the third strike", async () => {
    const cooperative = randomAddress();
    await recordCooperativeForfeiture(cooperative, randomContractId());
    await recordCooperativeForfeiture(cooperative, randomContractId());
    const after3 = await recordCooperativeForfeiture(cooperative, randomContractId());

    expect(after3.strike_count).toBe(3);
    expect(after3.barred).toBe(true);
    expect(after3.barred_reason).toBe("cooperative_forfeiture_3x");
  });

  it("a fourth forfeiture after the bar keeps incrementing but doesn't touch barred_at", async () => {
    const cooperative = randomAddress();
    await recordCooperativeForfeiture(cooperative, randomContractId());
    await recordCooperativeForfeiture(cooperative, randomContractId());
    const barredAt3 = await recordCooperativeForfeiture(cooperative, randomContractId());
    const after4 = await recordCooperativeForfeiture(cooperative, randomContractId());

    expect(after4.strike_count).toBe(4);
    expect(after4.barred).toBe(true);
    expect(after4.barred_at).toEqual(barredAt3.barred_at);
  });

  it("recording the same forfeiture twice does not increment the strike count twice", async () => {
    const cooperative = randomAddress();
    const contractId = randomContractId();

    const first = await recordCooperativeForfeiture(cooperative, contractId);
    const second = await recordCooperativeForfeiture(cooperative, contractId);

    expect(first.strike_count).toBe(1);
    expect(second.strike_count).toBe(1);
  });
});

describe("reputation/applyReputationConsequences", () => {
  it("records on a re-observation too, but only once -- previousStatus no longer gates it", async () => {
    const cooperative = randomAddress();
    const contractId = randomContractId();
    const commitment = baseCommitment({ cooperative, status: "Forfeited" });

    // previousStatus === commitment.status is exactly the state every
    // later read sees after the cache was already refreshed. It must not
    // suppress the consequence: the event row decides idempotency.
    await applyReputationConsequences(contractId, "Forfeited", commitment);
    await applyReputationConsequences(contractId, "Forfeited", commitment);

    const standing = await getStanding(cooperative);
    expect(standing?.strike_count).toBe(1);
    expect(standing?.barred).toBe(false);
  });

  it("does nothing for a non-terminal status transition", async () => {
    const buyer = randomAddress();
    const commitment = baseCommitment({ buyer, status: "Locked" });

    await applyReputationConsequences(randomContractId(), "Draft", commitment);

    expect(await getStanding(buyer)).toBeNull();
  });

  it("bars the buyer on a fresh transition into Defaulted", async () => {
    const buyer = randomAddress();
    const commitment = baseCommitment({ buyer, status: "Defaulted" });

    await applyReputationConsequences(randomContractId(), "ReadyForDelivery", commitment);

    const standing = await getStanding(buyer);
    expect(standing?.barred).toBe(true);
    expect(standing?.barred_reason).toBe("buyer_default");
  });

  it("strikes the cooperative, not the buyer, on a fresh transition into Forfeited", async () => {
    const buyer = randomAddress();
    const cooperative = randomAddress();
    const commitment = baseCommitment({ buyer, cooperative, status: "Forfeited" });

    await applyReputationConsequences(randomContractId(), "Locked", commitment);

    expect(await getStanding(buyer)).toBeNull();
    const coopStanding = await getStanding(cooperative);
    expect(coopStanding?.strike_count).toBe(1);
    expect(coopStanding?.barred).toBe(false);
  });

  it("records exactly one strike when five observers race on the same forfeiture", async () => {
    const cooperative = randomAddress();
    const contractId = randomContractId();
    const commitment = baseCommitment({ cooperative, status: "Forfeited" });

    // The no-cached-row case from the bug report: every observer sees
    // previousStatus = null, so status-transition idempotency would let
    // all five through. The UNIQUE event key is what makes this one.
    await Promise.all(
      Array.from({ length: 5 }, () => applyReputationConsequences(contractId, null, commitment)),
    );

    const standing = await getStanding(cooperative);
    expect(standing?.strike_count).toBe(1);

    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*) FROM standing_events WHERE contract_id = $1 AND event_type = 'cooperative_forfeiture'",
      [contractId],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it("retries a failed record attempt and still lands the strike", async () => {
    const cooperative = randomAddress();
    const contractId = randomContractId();
    const commitment = baseCommitment({ cooperative, status: "Forfeited" });

    // Simulate the lost-strike failure path: the first observation's
    // consequence write throws, but its commitments upsert already
    // committed. Every later read then has previousStatus === "Forfeited".
    const connectSpy = vi.spyOn(pool, "connect").mockRejectedValueOnce(new Error("simulated database outage"));

    await expect(applyReputationConsequences(contractId, null, commitment)).rejects.toThrow(
      "simulated database outage",
    );

    connectSpy.mockRestore();
    await applyReputationConsequences(contractId, "Forfeited", commitment);

    const standing = await getStanding(cooperative);
    expect(standing?.strike_count).toBe(1);
  });
});
