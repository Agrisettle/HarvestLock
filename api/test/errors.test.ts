import { describe, it, expect } from "vitest";
import {
  CONTRACT_ERROR_NAMES,
  ContractError,
  contractErrorFromSimulation,
  isMissingContractInstance,
  parseContractError,
} from "../src/errors.js";

/**
 * Network-free coverage for the simulation-diagnostic parser. The #2 and
 * missing-instance strings below were captured verbatim from live
 * testnet simulation on 19 Nov 2026 (a freshly deployed, uninitialized
 * contract, and a random contract ID that isn't deployed at all). The #8
 * case uses the same host `HostError: Error(Contract, #N)` prefix with an
 * event log appended, which is the shape a state-machine rejection
 * carries — not invented wording the API itself controls.
 */
const ALREADY_CLAIMED =
  'HostError: Error(Contract, #8)\n\nEvent log (newest first):\n   0: [diagnostic event] topics:[symbol: "FnCall"], data:{"method":"claim_advance_1"}';
const NOT_INITIALIZED = "HostError: Error(Contract, #2)";
const ALLOCATION_TOO_LARGE =
  "HostError: Error(Contract, #38)\n\nEvent log (newest first):\n   0: [diagnostic event] topics:[symbol: \"FnCall\"]";
const MISSING_CONTRACT_INSTANCE = "HostError: Error(Storage, MissingValue)";

describe("contract error parsing", () => {
  it("maps an ordinary contract rejection to its glossary code and name", () => {
    expect(parseContractError(ALREADY_CLAIMED)).toEqual({ code: 8, name: "AlreadyClaimed" });
  });

  it("parses the bare NotInitialized diagnostic (no event log appended)", () => {
    expect(parseContractError(NOT_INITIALIZED)).toEqual({ code: 2, name: "NotInitialized" });
  });

  it("parses an appended code at the top of the range", () => {
    expect(parseContractError(ALLOCATION_TOO_LARGE)).toEqual({ code: 38, name: "AllocationTooLarge" });
  });

  it("keeps an unknown future code structured instead of dropping it", () => {
    expect(parseContractError("HostError: Error(Contract, #99)")).toEqual({
      code: 99,
      name: "UnknownContractError",
    });
  });

  it("returns null when the diagnostic has no contract code (a transport/RPC failure)", () => {
    expect(parseContractError("fetch failed")).toBeNull();
    expect(parseContractError("HostError: Error(Auth, InvalidAction)")).toBeNull();
  });

  it("maps every glossary code 1-38 to the same names docs/contract-glossary.md lists", () => {
    const glossaryNames = [
      "AlreadyInitialized",
      "NotInitialized",
      "InvalidState",
      "InvalidBps",
      "ZeroAmount",
      "InvalidWindow",
      "NotYetOpened",
      "AlreadyClaimed",
      "AlreadyExpired",
      "ClaimWindowPassed",
      "ClaimWindowNotPassed",
      "TrancheUnresolved",
      "RemainderAlreadyFunded",
      "RemainderWindowPassed",
      "RemainderWindowNotPassed",
      "RemainderNotFunded",
      "DeliveryDeadlineNotPassed",
      "InvalidQuantity",
      "InvalidGradeSchedule",
      "InvalidGradeIndex",
      "AllocationAlreadySet",
      "InvalidAllocation",
      "AllocationNotSet",
      "InvalidOracleConfig",
      "OracleNotConfigured",
      "OraclePriceUnavailable",
      "OracleStale",
      "FxAlreadyResolved",
      "FxNotResolved",
      "FxShortfallUnfunded",
      "NoFxShortfall",
      "FxShortfallAlreadyFunded",
      "FxShortfallWindowPassed",
      "FxShortfallWindowNotPassed",
      "NotAParty",
      "DisputeWindowNotPassed",
      "GradeScheduleTooLong",
      "AllocationTooLarge",
    ];
    expect(Object.keys(CONTRACT_ERROR_NAMES)).toHaveLength(glossaryNames.length);
    glossaryNames.forEach((name, index) => {
      expect(CONTRACT_ERROR_NAMES[index + 1]).toBe(name);
    });
  });

  it("recognises a missing contract instance, distinct from an uninitialized one", () => {
    expect(isMissingContractInstance(MISSING_CONTRACT_INSTANCE)).toBe(true);
    expect(isMissingContractInstance(NOT_INITIALIZED)).toBe(false);
    expect(isMissingContractInstance("fetch failed")).toBe(false);
  });
});

describe("contractErrorFromSimulation", () => {
  it("turns a write-side contract rejection into a 409 with structured fields", () => {
    const err = contractErrorFromSimulation("claim_advance_1", ALREADY_CLAIMED);
    expect(err).toBeInstanceOf(ContractError);
    expect(err?.statusCode).toBe(409);
    expect(err?.contractError).toEqual({ code: 8, name: "AlreadyClaimed" });
    expect(err?.message).toMatch(/AlreadyClaimed/);
  });

  it("turns #2 on a read into a 404", () => {
    const err = contractErrorFromSimulation("get_commitment", NOT_INITIALIZED, {
      notFoundOnMissingInstance: true,
      contractId: "CABC",
    });
    expect(err?.statusCode).toBe(404);
    expect(err?.contractError).toEqual({ code: 2, name: "NotInitialized" });
  });

  it("turns a missing contract instance on a read into a 404", () => {
    const err = contractErrorFromSimulation("get_commitment", MISSING_CONTRACT_INSTANCE, {
      notFoundOnMissingInstance: true,
      contractId: "CABC",
    });
    expect(err?.statusCode).toBe(404);
    expect(err?.contractError).toEqual({ code: null, name: "ContractNotFound" });
  });

  it("leaves #2 as a 409 on a write (only a read is asking for a missing resource)", () => {
    const err = contractErrorFromSimulation("initialize", NOT_INITIALIZED);
    expect(err?.statusCode).toBe(409);
    expect(err?.contractError).toEqual({ code: 2, name: "NotInitialized" });
  });

  it("returns null for a genuine transport/RPC failure so the caller keeps its 5xx", () => {
    expect(contractErrorFromSimulation("claim_advance_1", "fetch failed")).toBeNull();
  });
});
