/**
 * A handful of errors the route layer needs to distinguish from "the
 * server broke" — client-input problems that deserve a 4xx, not the
 * default 500 every thrown Error gets. See server.ts's setErrorHandler.
 */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

/** The addressed resource does not exist. */
export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message);
  }
}

/** The request is well-formed but not permitted — a barred address trying to appear on a new commitment. */
export class ForbiddenError extends HttpError {
  constructor(message: string) {
    super(403, message);
  }
}

/**
 * A missing/invalid deployment env var (DEPLOYER_SECRET_KEY,
 * ESCROW_WASM_HASH, STELLAR_RPC_URL) — an operator misconfiguration, not
 * anything a caller did. setErrorHandler gives these a generic message
 * instead of naming the specific env var to an external caller, even
 * though none of the current throw sites actually embed a secret *value*
 * (checked, not assumed — see api/HANDOFF.md). Distinct from every other
 * uncaught error (Stellar simulation/submission failures, SDK decoding
 * assertions), which setErrorHandler deliberately still lets propagate
 * with their real message — callers building a transaction need to know
 * *why* simulation failed, that's the API's actual feedback mechanism,
 * not a bug to paper over.
 */
/** The service cannot do this right now (e.g. the deployer account is below its balance floor). */
export class ServiceUnavailableError extends HttpError {
  constructor(message: string) {
    super(503, message);
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * The contract's own `Error` enum, mirroring
 * docs/contract-glossary.md. Codes are append-only on the contract side (a
 * CI guard enforces the discriminants), so this table stays stable; a code
 * the glossary doesn't list yet still comes back structured rather than
 * turning an ordinary on-chain rejection into an opaque 500.
 *
 * Kept in the same order as the glossary so a reviewer can diff the two
 * side by side.
 */
export const CONTRACT_ERROR_NAMES: Readonly<Record<number, string>> = Object.freeze({
  1: "AlreadyInitialized",
  2: "NotInitialized",
  3: "InvalidState",
  4: "InvalidBps",
  5: "ZeroAmount",
  6: "InvalidWindow",
  7: "NotYetOpened",
  8: "AlreadyClaimed",
  9: "AlreadyExpired",
  10: "ClaimWindowPassed",
  11: "ClaimWindowNotPassed",
  12: "TrancheUnresolved",
  13: "RemainderAlreadyFunded",
  14: "RemainderWindowPassed",
  15: "RemainderWindowNotPassed",
  16: "RemainderNotFunded",
  17: "DeliveryDeadlineNotPassed",
  18: "InvalidQuantity",
  19: "InvalidGradeSchedule",
  20: "InvalidGradeIndex",
  21: "AllocationAlreadySet",
  22: "InvalidAllocation",
  23: "AllocationNotSet",
  24: "InvalidOracleConfig",
  25: "OracleNotConfigured",
  26: "OraclePriceUnavailable",
  27: "OracleStale",
  28: "FxAlreadyResolved",
  29: "FxNotResolved",
  30: "FxShortfallUnfunded",
  31: "NoFxShortfall",
  32: "FxShortfallAlreadyFunded",
  33: "FxShortfallWindowPassed",
  34: "FxShortfallWindowNotPassed",
  35: "NotAParty",
  36: "DisputeWindowNotPassed",
  37: "GradeScheduleTooLong",
  38: "AllocationTooLarge",
});

export interface ParsedContractError {
  code: number;
  name: string;
}

/**
 * Pulls `Error(Contract, #N)` out of a Soroban simulation diagnostic. The
 * host formats the first line as `HostError: Error(Contract, #8)` and may
 * append an event log/backtrace underneath, so matching anywhere in the
 * string (not anchoring to the start) is deliberate.
 *
 * Returns null for anything else — an RPC/transport failure, an auth
 * error, or a diagnostic with no contract code. Callers must keep those as
 * 5xx rather than labelling them a contract rejection.
 */
export function parseContractError(diagnostic: string): ParsedContractError | null {
  const match = /\bError\(\s*Contract\s*,\s*#(\d+)\s*\)/.exec(diagnostic);
  if (!match) return null;

  const code = Number.parseInt(match[1]!, 10);
  return { code, name: CONTRACT_ERROR_NAMES[code] ?? `UnknownContractError` };
}

/**
 * True when a simulation failed because the contract instance itself is
 * missing from the ledger — distinct from #2 (an instance that exists but
 * was never initialized). The host reports a missing ledger entry as
 * `Error(Storage, MissingValue)`; some RPC versions also include prose
 * naming the contract instance, so both shapes are accepted.
 */
export function isMissingContractInstance(diagnostic: string): boolean {
  if (/\bError\(\s*Storage\s*,\s*MissingValue\s*\)/.test(diagnostic)) return true;
  return /\b(?:missing|not found)\b[^\n]*\bcontract instance\b/i.test(diagnostic);
}

/**
 * A contract-level rejection, keeping the on-chain code and its glossary
 * name as structured fields. Ordinary state-machine rejections (claiming
 * an already-claimed advance, acting from the wrong status) are a 409
 * Conflict, not a server fault. Read routes pass
 * `notFoundOnMissingInstance` so an uninitialized (#2) or non-existent
 * contract is a 404 instead.
 */
export class ContractError extends HttpError {
  constructor(
    public readonly contractError: { code: number | null; name: string },
    message: string,
    statusCode = 409,
  ) {
    super(statusCode, message);
  }
}

export interface ContractErrorOptions {
  /** Read routes: turn #2 / a missing instance into 404 rather than 409. */
  notFoundOnMissingInstance?: boolean;
  /** Included in the 404 message so a caller knows which address failed. */
  contractId?: string;
}

/**
 * Translates a simulation diagnostic into a typed HTTP error, or returns
 * null when the diagnostic contains no contract rejection (a genuine RPC
 * or transport failure) — the caller should then keep its original Error
 * so that failure stays a 5xx.
 */
export function contractErrorFromSimulation(
  method: string,
  diagnostic: string,
  opts: ContractErrorOptions = {},
): ContractError | null {
  const parsed = parseContractError(diagnostic);
  const subject = opts.contractId ? `contract ${opts.contractId}` : "contract";

  if (opts.notFoundOnMissingInstance) {
    if (parsed?.code === 2) {
      return new ContractError(
        parsed,
        `${subject} is not initialized (NotInitialized, Error(Contract, #2))`,
        404,
      );
    }
    // Only when no contract code was parsed: an actual rejection always
    // wins over a generic storage-missing line elsewhere in the diagnostic.
    if (!parsed && isMissingContractInstance(diagnostic)) {
      return new ContractError(
        { code: null, name: "ContractNotFound" },
        `${subject} was not found on the configured network`,
        404,
      );
    }
  }

  if (!parsed) return null;

  return new ContractError(
    parsed,
    `contract rejected ${method}: ${parsed.name} (Error(Contract, #${parsed.code}))`,
    409,
  );
}
