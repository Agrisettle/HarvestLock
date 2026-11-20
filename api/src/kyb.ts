import { StellarToml, StrKey, WebAuth } from "@stellar/stellar-sdk";
import { pool } from "./db/pool.js";
import { BadRequestError, ConfigurationError, ForbiddenError, HttpError } from "./errors.js";

/**
 * Buyer onboarding: KYB via anchor verification (issue #11, PRD §4.5 and
 * the Users table: buyers need "full KYB ... plus existing anchor SEP-12
 * verification", because "requiring pre-existing anchor KYC avoids
 * building a parallel AML programme").
 *
 * What counts as proof: a trusted, licensed anchor's own SEP-12 record
 * for the buyer's Stellar account has status ACCEPTED, read by this API
 * directly from the anchor. Getting there reuses the API's existing
 * "build unsigned → the party's own wallet signs → API submits" shape,
 * applied to SEP-10 instead of a Soroban call:
 *
 *   1. POST /kyb/challenge: the API fetches the anchor's SEP-10 challenge
 *      for the buyer's account and validates it before handing it out
 *      (correct server signature, home domain and web_auth_domain,
 *      sequence 0 so it can never be submitted to the network). A buyer
 *      is therefore never asked to sign anything but a genuine,
 *      unsubmittable auth challenge.
 *   2. The buyer signs it in their own wallet (buyer-app, Freighter).
 *   3. POST /kyb/verify: the API submits the signed challenge to the
 *      anchor, receives the SEP-10 JWT itself, immediately calls the
 *      anchor's SEP-12 GET /customer with it, records the status, and
 *      discards the token.
 *
 * Why this is sound without HarvestLock verifying the anchor's JWT
 * signature (SEP-10 JWTs are usually signed with a secret only the anchor
 * holds): the API never accepts a token from the client. It obtains the
 * token itself, from a challenge that only the buyer's key could have
 * signed, so whatever /customer then reports belongs to that account.
 *
 * HarvestLock holds no keys, documents or personal data here. The anchor
 * remains the KYB system of record, which is the whole point of §4.5.
 */

export type KybEnforcement = "off" | "enforce";

export interface KybConfig {
  /**
   * "off" (default): verification is available and recorded, but never
   * required. Testnet and dev work keep running with a bare wallet,
   * which is issue #11's explicit ask. "enforce": a buyer must be
   * currently verified to be put on a new commitment or to take one
   * over via reassignment.
   */
  enforcement: KybEnforcement;
  /** Home domains of anchors whose SEP-12 verdict is accepted, e.g. testanchor.stellar.org. */
  trustedAnchors: string[];
  /** How long an ACCEPTED check counts (PRD: buyers re-verified every six months). */
  validityDays: number;
  /** Optional SEP-12 customer `type` to query (anchor-specific). */
  customerType: string | null;
  networkPassphrase: string;
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function kybConfigFromEnv(networkPassphrase: string, env: NodeJS.ProcessEnv = process.env): KybConfig {
  const enforcement = (env.KYB_ENFORCEMENT ?? "off").trim().toLowerCase();
  if (enforcement !== "off" && enforcement !== "enforce") {
    throw new ConfigurationError(`KYB_ENFORCEMENT must be "off" or "enforce", got "${enforcement}"`);
  }
  const trustedAnchors = (env.KYB_TRUSTED_ANCHORS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  for (const d of trustedAnchors) {
    if (!DOMAIN_RE.test(d)) throw new ConfigurationError(`KYB_TRUSTED_ANCHORS entry is not a bare domain: "${d}"`);
  }
  if (enforcement === "enforce" && trustedAnchors.length === 0) {
    // Enforcing with nobody able to verify would silently block every
    // new commitment.
    throw new ConfigurationError("KYB_ENFORCEMENT=enforce needs at least one KYB_TRUSTED_ANCHORS domain");
  }
  const validityDays = Number(env.KYB_VALIDITY_DAYS ?? 182);
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 366) {
    throw new ConfigurationError(`KYB_VALIDITY_DAYS must be an integer from 1 to 366, got "${env.KYB_VALIDITY_DAYS}"`);
  }
  return {
    enforcement,
    trustedAnchors,
    validityDays,
    customerType: env.KYB_SEP12_CUSTOMER_TYPE?.trim() || null,
    networkPassphrase,
  };
}

/** The anchor misbehaved or was unreachable: not the caller's fault, not ours. */
export class AnchorError extends HttpError {
  constructor(message: string) {
    super(502, message);
  }
}

export interface KybDeps {
  resolveToml: (domain: string) => Promise<Record<string, unknown>>;
  fetch: typeof fetch;
}

export const defaultKybDeps: KybDeps = {
  resolveToml: (domain) => StellarToml.Resolver.resolve(domain, { timeout: 10_000 }) as Promise<Record<string, unknown>>,
  fetch: (...args) => fetch(...args),
};

interface AnchorEndpoints {
  domain: string;
  webAuthEndpoint: string;
  webAuthDomain: string;
  signingKey: string;
  kycServer: string;
}

function requireTrustedAnchor(config: KybConfig, anchorDomain: unknown): string {
  const domain = typeof anchorDomain === "string" ? anchorDomain.trim().toLowerCase() : "";
  // Allowlist first, before any network call: this is also what keeps the
  // routes from being an open fetch-any-host relay (SSRF).
  if (!config.trustedAnchors.includes(domain)) {
    throw new BadRequestError(`anchorDomain must be one of the trusted anchors: ${config.trustedAnchors.join(", ") || "(none configured)"}`);
  }
  return domain;
}

function httpsUrl(value: unknown, field: string, domain: string): string {
  if (typeof value !== "string") throw new AnchorError(`${domain}'s stellar.toml has no ${field}`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AnchorError(`${domain}'s stellar.toml ${field} is not a URL`);
  }
  if (url.protocol !== "https:") throw new AnchorError(`${domain}'s stellar.toml ${field} must be https`);
  return value.replace(/\/+$/, "");
}

async function resolveAnchor(config: KybConfig, domain: string, deps: KybDeps): Promise<AnchorEndpoints> {
  let toml: Record<string, unknown>;
  try {
    toml = await deps.resolveToml(domain);
  } catch (err) {
    throw new AnchorError(`could not read https://${domain}/.well-known/stellar.toml: ${(err as Error).message}`);
  }
  if (toml.NETWORK_PASSPHRASE !== undefined && toml.NETWORK_PASSPHRASE !== config.networkPassphrase) {
    throw new AnchorError(`${domain} serves a different Stellar network than this API`);
  }
  const webAuthEndpoint = httpsUrl(toml.WEB_AUTH_ENDPOINT, "WEB_AUTH_ENDPOINT", domain);
  // SEP-12: KYC_SERVER, falling back to TRANSFER_SERVER when absent.
  const kycServer = httpsUrl(toml.KYC_SERVER ?? toml.TRANSFER_SERVER, "KYC_SERVER", domain);
  const signingKey = toml.SIGNING_KEY;
  if (typeof signingKey !== "string" || !StrKey.isValidEd25519PublicKey(signingKey)) {
    throw new AnchorError(`${domain}'s stellar.toml has no valid SIGNING_KEY`);
  }
  return { domain, webAuthEndpoint, webAuthDomain: new URL(webAuthEndpoint).host, signingKey, kycServer };
}

/**
 * Validates a SEP-10 challenge (signed or not) as genuine and for
 * `account`. `blame` decides whose fault a bad one is: a bad challenge
 * straight from the anchor is an anchor fault (502), a bad one sent back
 * by the client is the client's (400).
 */
function readChallenge(
  config: KybConfig,
  anchor: AnchorEndpoints,
  transaction: string,
  account: string,
  blame: "anchor" | "client",
): void {
  const fail = (message: string) => (blame === "anchor" ? new AnchorError(message) : new BadRequestError(message));
  let clientAccountID: string;
  let memo: string | null;
  try {
    ({ clientAccountID, memo } = WebAuth.readChallengeTx(
      transaction,
      anchor.signingKey,
      config.networkPassphrase,
      anchor.domain,
      anchor.webAuthDomain,
    ));
  } catch (err) {
    throw fail(`not a valid SEP-10 challenge from ${anchor.domain}: ${(err as Error).message}`);
  }
  if (clientAccountID !== account || memo) {
    throw fail("the challenge is not for this account");
  }
}

async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new AnchorError(`${what} returned a non-JSON response (HTTP ${res.status})`);
  }
  if (typeof body !== "object" || body === null) throw new AnchorError(`${what} returned an unexpected response`);
  return body as Record<string, unknown>;
}

function requireAccount(account: unknown): string {
  if (typeof account !== "string" || !StrKey.isValidEd25519PublicKey(account)) {
    throw new BadRequestError(`account is not a valid public key: ${account}`);
  }
  return account;
}

/** Step 1: a validated, unsigned SEP-10 challenge for the buyer to sign. */
export async function createKybChallenge(
  config: KybConfig,
  body: { account?: unknown; anchorDomain?: unknown },
  deps: KybDeps = defaultKybDeps,
): Promise<{ transaction: string; networkPassphrase: string; anchorDomain: string }> {
  const account = requireAccount(body.account);
  const domain = requireTrustedAnchor(config, body.anchorDomain);
  const anchor = await resolveAnchor(config, domain, deps);

  const url = new URL(anchor.webAuthEndpoint);
  url.searchParams.set("account", account);
  url.searchParams.set("home_domain", domain);
  const res = await deps.fetch(url, { signal: AbortSignal.timeout(15_000) });
  const json = await readJson(res, `${domain} SEP-10 challenge`);
  if (!res.ok || typeof json.transaction !== "string") {
    throw new AnchorError(`${domain} did not issue a SEP-10 challenge (HTTP ${res.status})`);
  }
  if (json.network_passphrase !== undefined && json.network_passphrase !== config.networkPassphrase) {
    throw new AnchorError(`${domain} issued a challenge for a different network`);
  }
  readChallenge(config, anchor, json.transaction, account, "anchor");
  return { transaction: json.transaction, networkPassphrase: config.networkPassphrase, anchorDomain: domain };
}

export interface BuyerVerificationRow {
  account: string;
  anchor_domain: string;
  sep12_status: "ACCEPTED" | "PROCESSING" | "NEEDS_INFO" | "REJECTED";
  sep12_customer_id: string | null;
  checked_at: string;
  expires_at: string | null;
}

const SEP12_STATUSES = new Set(["ACCEPTED", "PROCESSING", "NEEDS_INFO", "REJECTED"]);

function jwtSubject(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const sub = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

/** Steps 3–4: exchange the signed challenge for a token, read SEP-12, record the result. */
export async function verifyBuyerWithAnchor(
  config: KybConfig,
  body: { account?: unknown; anchorDomain?: unknown; transaction?: unknown },
  deps: KybDeps = defaultKybDeps,
): Promise<BuyerVerificationRow & { verified: boolean }> {
  const account = requireAccount(body.account);
  const domain = requireTrustedAnchor(config, body.anchorDomain);
  if (typeof body.transaction !== "string" || body.transaction.length === 0) {
    throw new BadRequestError("transaction must be the signed SEP-10 challenge XDR");
  }
  const anchor = await resolveAnchor(config, domain, deps);
  readChallenge(config, anchor, body.transaction, account, "client");

  const authRes = await deps.fetch(anchor.webAuthEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: body.transaction }),
    signal: AbortSignal.timeout(15_000),
  });
  const auth = await readJson(authRes, `${domain} SEP-10 token`);
  if (!authRes.ok || typeof auth.token !== "string") {
    // The anchor rejected the signature: the caller's problem, not an outage.
    throw new ForbiddenError(`${domain} did not accept the signed challenge (HTTP ${authRes.status})`);
  }
  const token = auth.token;
  // Belt and braces. The token came from the anchor in exchange for a
  // challenge we already checked is for `account`; refuse one claiming
  // to be about anyone else (a muxed or memo'd sub included).
  if (jwtSubject(token) !== account) {
    throw new AnchorError(`${domain} issued a token for a different account`);
  }

  const customerUrl = new URL(`${anchor.kycServer}/customer`);
  if (config.customerType) customerUrl.searchParams.set("type", config.customerType);
  const custRes = await deps.fetch(customerUrl, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const customer = await readJson(custRes, `${domain} SEP-12 customer`);
  // A SEP-12 anchor answers an unknown customer with 200 NEEDS_INFO, or
  // with 404. Treat a 404 as NEEDS_INFO, anything else non-2xx as an
  // anchor fault.
  const status = custRes.status === 404 ? "NEEDS_INFO" : customer.status;
  if ((!custRes.ok && custRes.status !== 404) || typeof status !== "string" || !SEP12_STATUSES.has(status)) {
    throw new AnchorError(`${domain} returned no usable SEP-12 status (HTTP ${custRes.status})`);
  }

  const { rows } = await pool.query<BuyerVerificationRow & { checked_at: Date; expires_at: Date | null }>(
    `INSERT INTO buyer_verifications (account, anchor_domain, sep12_status, sep12_customer_id, expires_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $3 = 'ACCEPTED' THEN now() + make_interval(days => $5) END)
     RETURNING account, anchor_domain, sep12_status, sep12_customer_id, checked_at, expires_at`,
    [account, domain, status, typeof customer.id === "string" ? customer.id : null, config.validityDays],
  );
  const row = serializeRow(rows[0]!);
  return { ...row, verified: row.sep12_status === "ACCEPTED" };
}

function serializeRow(r: BuyerVerificationRow & { checked_at: Date | string; expires_at: Date | string | null }): BuyerVerificationRow {
  return {
    account: r.account,
    anchor_domain: r.anchor_domain,
    sep12_status: r.sep12_status,
    sep12_customer_id: r.sep12_customer_id,
    checked_at: new Date(r.checked_at).toISOString(),
    expires_at: r.expires_at === null ? null : new Date(r.expires_at).toISOString(),
  };
}

export interface BuyerVerificationStatus {
  account: string;
  verified: boolean;
  /** The verification currently in force, if any. */
  current: BuyerVerificationRow | null;
  /** The most recent check of any outcome (e.g. a later NEEDS_INFO). */
  latest: BuyerVerificationRow | null;
}

/**
 * Only verifications from anchors still in the trusted list count. Removing
 * an anchor from KYB_TRUSTED_ANCHORS immediately stops its past verdicts
 * from counting, without rewriting history.
 */
export async function getBuyerVerification(config: KybConfig, account: string): Promise<BuyerVerificationStatus> {
  const { rows } = await pool.query(
    `(SELECT *, 'current' AS kind FROM buyer_verifications
      WHERE account = $1 AND sep12_status = 'ACCEPTED' AND expires_at > now() AND anchor_domain = ANY($2)
      ORDER BY checked_at DESC LIMIT 1)
     UNION ALL
     (SELECT *, 'latest' AS kind FROM buyer_verifications
      WHERE account = $1 ORDER BY checked_at DESC LIMIT 1)`,
    [account, config.trustedAnchors],
  );
  const current = rows.find((r) => r.kind === "current");
  const latest = rows.find((r) => r.kind === "latest");
  return {
    account,
    verified: Boolean(current),
    current: current ? serializeRow(current) : null,
    latest: latest ? serializeRow(latest) : null,
  };
}

/** The gate. No-op unless KYB_ENFORCEMENT=enforce. */
export async function requireKybVerified(config: KybConfig, address: string, fieldName: string): Promise<void> {
  if (config.enforcement !== "enforce") return;
  const { verified } = await getBuyerVerification(config, address);
  if (!verified) {
    throw new ForbiddenError(
      `${fieldName} ${address} has no current anchor KYB verification. Verify via POST /kyb/challenge and /kyb/verify first.`,
    );
  }
}
