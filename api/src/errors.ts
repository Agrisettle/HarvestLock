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
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}
