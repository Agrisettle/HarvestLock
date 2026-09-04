import "dotenv/config";
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  stageAllocationMembers,
  recordAllocationMembers,
  getAllocationMembers,
  eraseAllocationMember,
} from "../src/db/allocationMembers.js";

/**
 * Against the real local Postgres — no mocks, same discipline as the rest
 * of this repo's tests. Each test uses a fresh random contract_id
 * (`randomUUID()` stands in for one — this module never validates the
 * shape, it's just a grouping key) so tests can't collide with each
 * other's rows.
 */

function fakeContractId(): string {
  return `CTEST${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 50)}`;
}

describe("db/allocationMembers", () => {
  it("stageAllocationMembers generates a distinct salt and hash per member", () => {
    const staged = stageAllocationMembers([
      { phoneNumber: "+2348012345678", shareBps: 6_000 },
      { phoneNumber: "+2348098765432", shareBps: 4_000 },
    ]);
    expect(staged).toHaveLength(2);
    expect(staged[0]!.salt).not.toBe(staged[1]!.salt);
    expect(staged[0]!.memberHash).not.toBe(staged[1]!.memberHash);
    expect(staged[0]!.memberHash).toMatch(/^[0-9a-f]{64}$/);
    expect(staged[0]!.salt).toMatch(/^[0-9a-f]{64}$/);
  });

  it("staging the same phone number twice produces two different hashes (fresh salt each time)", () => {
    // The whole point of salting per-member, not just per-contract: even
    // the same phone number appearing in two different staging calls
    // shouldn't produce a linkable hash.
    const [first] = stageAllocationMembers([{ phoneNumber: "+2348012345678", shareBps: 5_000 }]);
    const [second] = stageAllocationMembers([{ phoneNumber: "+2348012345678", shareBps: 5_000 }]);
    expect(first!.memberHash).not.toBe(second!.memberHash);
  });

  it("recordAllocationMembers persists rows readable via getAllocationMembers, without the phone number", async () => {
    const contractId = fakeContractId();
    const staged = stageAllocationMembers([
      { phoneNumber: "+2348012345678", shareBps: 7_000 },
      { phoneNumber: "+2348098765432", shareBps: 3_000 },
    ]);

    await recordAllocationMembers(contractId, staged);

    const rows = await getAllocationMembers(contractId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.share_bps).sort()).toEqual([3_000, 7_000]);
    expect(rows.map((r) => r.member_hash).sort()).toEqual([staged[0]!.memberHash, staged[1]!.memberHash].sort());
    // No phone_number field at all in the returned rows -- getAllocationMembers
    // never selects it, not even to null it out client-side.
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("phone_number");
    }
    for (const row of rows) {
      expect(row.erased_at).toBeNull();
    }
  });

  it("eraseAllocationMember nulls the phone number and is idempotent", async () => {
    const contractId = fakeContractId();
    const [staged] = stageAllocationMembers([{ phoneNumber: "+2348012345678", shareBps: 10_000 }]);
    await recordAllocationMembers(contractId, [staged!]);

    const firstErase = await eraseAllocationMember(staged!.memberHash);
    expect(firstErase).toBe(true);

    const rows = await getAllocationMembers(contractId);
    expect(rows[0]!.erased_at).not.toBeNull();
    // share_bps and member_hash survive erasure -- only the phone number is gone.
    expect(rows[0]!.share_bps).toBe(10_000);
    expect(rows[0]!.member_hash).toBe(staged!.memberHash);

    // Erasing again is a no-op, not an error, and doesn't overwrite the original erased_at.
    const erasedAtAfterFirst = rows[0]!.erased_at;
    const secondErase = await eraseAllocationMember(staged!.memberHash);
    expect(secondErase).toBe(true);
    const rowsAfterSecondErase = await getAllocationMembers(contractId);
    expect(rowsAfterSecondErase[0]!.erased_at).toEqual(erasedAtAfterFirst);
  });

  it("eraseAllocationMember returns false for a hash that was never recorded", async () => {
    const found = await eraseAllocationMember("0".repeat(64));
    expect(found).toBe(false);
  });
});
