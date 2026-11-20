import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import { Keypair, Networks, StrKey, TransactionBuilder, WebAuth } from "@stellar/stellar-sdk";
import { randomBytes } from "node:crypto";
import { pool } from "../src/db/pool.js";
import { ConfigurationError } from "../src/errors.js";
import {
  kybConfigFromEnv,
  createKybChallenge,
  verifyBuyerWithAnchor,
  getBuyerVerification,
  requireKybVerified,
  type KybConfig,
  type KybDeps,
} from "../src/kyb.js";

/**
 * Issue #11. The anchor is faked at the network boundary only. Its
 * SEP-10 challenges are real ones, built and signed with the SDK's own
 * WebAuth helpers by a throwaway anchor keypair, so the API's challenge
 * validation runs exactly as it would against a live anchor. Postgres is
 * real. Each test uses a fresh random buyer account, so no cleanup is needed.
 */

const PASSPHRASE = Networks.TESTNET;
const ANCHOR = "anchor.example.com";
const WEB_AUTH = `https://${ANCHOR}/auth`;
const KYC = `https://${ANCHOR}/kyc`;

function config(overrides: Partial<KybConfig> = {}): KybConfig {
  return {
    enforcement: "off",
    trustedAnchors: [ANCHOR],
    validityDays: 182,
    customerType: null,
    networkPassphrase: PASSPHRASE,
    ...overrides,
  };
}

function fakeJwt(sub: string): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub, iss: WEB_AUTH })}.sig`;
}

interface FakeAnchorOpts {
  sep12Status?: string | null; // null => 404
  acceptSignature?: boolean;
  tokenSubject?: (account: string) => string;
  challengeSigner?: Keypair;
  toml?: Record<string, unknown>;
}

/** A minimal SEP-1/10/12 anchor. Records every request it receives. */
function fakeAnchor(opts: FakeAnchorOpts = {}) {
  const server = Keypair.random();
  const calls: { method: string; url: string; auth?: string | null }[] = [];
  const deps: KybDeps = {
    resolveToml: async (domain) => {
      if (domain !== ANCHOR) throw new Error("unexpected domain");
      return (
        opts.toml ?? {
          NETWORK_PASSPHRASE: PASSPHRASE,
          WEB_AUTH_ENDPOINT: WEB_AUTH,
          KYC_SERVER: KYC,
          SIGNING_KEY: server.publicKey(),
        }
      );
    },
    fetch: (async (input: URL | string, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      calls.push({ method, url: url.toString(), auth: headers.get("authorization") });
      if (url.pathname === "/auth" && method === "GET") {
        const transaction = WebAuth.buildChallengeTx(
          opts.challengeSigner ?? server,
          url.searchParams.get("account")!,
          ANCHOR,
          300,
          PASSPHRASE,
          ANCHOR,
        );
        return Response.json({ transaction, network_passphrase: PASSPHRASE });
      }
      if (url.pathname === "/auth" && method === "POST") {
        if (opts.acceptSignature === false) return Response.json({ error: "bad signature" }, { status: 400 });
        const { transaction } = JSON.parse(String(init!.body));
        const { clientAccountID } = WebAuth.readChallengeTx(transaction, server.publicKey(), PASSPHRASE, ANCHOR, ANCHOR);
        return Response.json({ token: fakeJwt(opts.tokenSubject ? opts.tokenSubject(clientAccountID) : clientAccountID) });
      }
      if (url.pathname === "/kyc/customer") {
        if (opts.sep12Status === null) return Response.json({ error: "not found" }, { status: 404 });
        return Response.json({ id: "cust-123", status: opts.sep12Status ?? "ACCEPTED" });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch,
  };
  return { deps, calls, server };
}

function sign(challengeXdr: string, kp: Keypair): string {
  const tx = TransactionBuilder.fromXDR(challengeXdr, PASSPHRASE);
  tx.sign(kp);
  return tx.toXDR();
}

/** The whole buyer-side walk: challenge → wallet signs → verify. */
async function walk(cfg: KybConfig, anchor: ReturnType<typeof fakeAnchor>, buyer: Keypair) {
  const { transaction } = await createKybChallenge(cfg, { account: buyer.publicKey(), anchorDomain: ANCHOR }, anchor.deps);
  return verifyBuyerWithAnchor(
    cfg,
    { account: buyer.publicKey(), anchorDomain: ANCHOR, transaction: sign(transaction, buyer) },
    anchor.deps,
  );
}

describe("kybConfigFromEnv", () => {
  it("defaults to off with no anchors, so dev and testnet work is never blocked", () => {
    expect(kybConfigFromEnv(PASSPHRASE, {})).toMatchObject({ enforcement: "off", trustedAnchors: [], validityDays: 182 });
  });

  it("parses and normalizes the trusted anchor list", () => {
    expect(kybConfigFromEnv(PASSPHRASE, { KYB_TRUSTED_ANCHORS: " TestAnchor.Stellar.org , a.example.com" }).trustedAnchors).toEqual([
      "testanchor.stellar.org",
      "a.example.com",
    ]);
  });

  it.each([
    [{ KYB_ENFORCEMENT: "maybe" }],
    [{ KYB_ENFORCEMENT: "enforce" }], // enforcing with no anchor would block everyone
    [{ KYB_TRUSTED_ANCHORS: "https://anchor.example.com" }],
    [{ KYB_VALIDITY_DAYS: "0" }],
    [{ KYB_VALIDITY_DAYS: "abc" }],
  ])("refuses %o at boot", (env) => {
    expect(() => kybConfigFromEnv(PASSPHRASE, env)).toThrow(ConfigurationError);
  });
});

describe("createKybChallenge", () => {
  it("returns the anchor's challenge after validating it", async () => {
    const anchor = fakeAnchor();
    const buyer = Keypair.random();
    const res = await createKybChallenge(config(), { account: buyer.publicKey(), anchorDomain: ANCHOR }, anchor.deps);
    expect(res.networkPassphrase).toBe(PASSPHRASE);
    expect(WebAuth.readChallengeTx(res.transaction, anchor.server.publicKey(), PASSPHRASE, ANCHOR, ANCHOR).clientAccountID).toBe(
      buyer.publicKey(),
    );
  });

  it("rejects an untrusted anchor before making any network call (no open relay)", async () => {
    const anchor = fakeAnchor();
    await expect(
      createKybChallenge(config(), { account: Keypair.random().publicKey(), anchorDomain: "evil.example.com" }, anchor.deps),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(anchor.calls).toHaveLength(0);
  });

  it("rejects a malformed account", async () => {
    await expect(createKybChallenge(config(), { account: "nope", anchorDomain: ANCHOR }, fakeAnchor().deps)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("refuses to pass on a challenge not signed by the anchor's SIGNING_KEY (502)", async () => {
    const anchor = fakeAnchor({ challengeSigner: Keypair.random() });
    await expect(
      createKybChallenge(config(), { account: Keypair.random().publicKey(), anchorDomain: ANCHOR }, anchor.deps),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it.each([
    ["a non-https auth endpoint", { WEB_AUTH_ENDPOINT: `http://${ANCHOR}/auth` }],
    ["a different network", { NETWORK_PASSPHRASE: Networks.PUBLIC }],
    ["no signing key", { SIGNING_KEY: undefined }],
  ])("rejects an anchor whose stellar.toml has %s", async (_label, patch) => {
    const base = { NETWORK_PASSPHRASE: PASSPHRASE, WEB_AUTH_ENDPOINT: WEB_AUTH, KYC_SERVER: KYC, SIGNING_KEY: Keypair.random().publicKey() };
    const anchor = fakeAnchor({ toml: { ...base, ...patch } });
    await expect(
      createKybChallenge(config(), { account: Keypair.random().publicKey(), anchorDomain: ANCHOR }, anchor.deps),
    ).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("verifyBuyerWithAnchor", () => {
  it("records an ACCEPTED verification with a validity window and sends the token only to the anchor", async () => {
    const anchor = fakeAnchor({ sep12Status: "ACCEPTED" });
    const buyer = Keypair.random();
    const before = Date.now();
    const result = await walk(config({ validityDays: 30 }), anchor, buyer);

    expect(result).toMatchObject({ account: buyer.publicKey(), anchor_domain: ANCHOR, sep12_status: "ACCEPTED", verified: true });
    const days = (new Date(result.expires_at!).getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    const customerCall = anchor.calls.find((c) => c.url.startsWith(`${KYC}/customer`));
    expect(customerCall?.auth).toMatch(/^Bearer /);
    // The token never reaches Postgres.
    const { rows } = await pool.query("SELECT row_to_json(b)::text AS j FROM buyer_verifications b WHERE account = $1", [
      buyer.publicKey(),
    ]);
    expect(rows[0].j).not.toContain(customerCall!.auth!.slice(7));

    expect(await getBuyerVerification(config(), buyer.publicKey())).toMatchObject({ verified: true });
  });

  it.each([["NEEDS_INFO"], ["PROCESSING"], ["REJECTED"]])("records %s as not verified", async (status) => {
    const buyer = Keypair.random();
    const result = await walk(config(), fakeAnchor({ sep12Status: status }), buyer);
    expect(result).toMatchObject({ sep12_status: status, verified: false, expires_at: null });
    expect((await getBuyerVerification(config(), buyer.publicKey())).verified).toBe(false);
  });

  it("treats a SEP-12 404 (unknown customer) as NEEDS_INFO", async () => {
    const result = await walk(config(), fakeAnchor({ sep12Status: null }), Keypair.random());
    expect(result.sep12_status).toBe("NEEDS_INFO");
  });

  it("keeps an earlier ACCEPTED in force while showing a later check as latest", async () => {
    const buyer = Keypair.random();
    await walk(config(), fakeAnchor({ sep12Status: "ACCEPTED" }), buyer);
    await walk(config(), fakeAnchor({ sep12Status: "PROCESSING" }), buyer);
    const status = await getBuyerVerification(config(), buyer.publicKey());
    expect(status.verified).toBe(true);
    expect(status.current?.sep12_status).toBe("ACCEPTED");
    expect(status.latest?.sep12_status).toBe("PROCESSING");
  });

  it("stops counting an anchor's verdicts as soon as it leaves the trusted list", async () => {
    const buyer = Keypair.random();
    await walk(config(), fakeAnchor(), buyer);
    expect((await getBuyerVerification(config({ trustedAnchors: ["other.example.com"] }), buyer.publicKey())).verified).toBe(false);
  });

  it("refuses a challenge signed for a different account than claimed", async () => {
    const anchor = fakeAnchor();
    const buyer = Keypair.random();
    const someoneElse = Keypair.random();
    const { transaction } = await createKybChallenge(config(), { account: someoneElse.publicKey(), anchorDomain: ANCHOR }, anchor.deps);
    await expect(
      verifyBuyerWithAnchor(
        config(),
        { account: buyer.publicKey(), anchorDomain: ANCHOR, transaction: sign(transaction, someoneElse) },
        anchor.deps,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("returns 403 when the anchor rejects the signature", async () => {
    await expect(walk(config(), fakeAnchor({ acceptSignature: false }), Keypair.random())).rejects.toMatchObject({ statusCode: 403 });
  });

  it("refuses a token issued for a different subject", async () => {
    const anchor = fakeAnchor({ tokenSubject: (a) => `${a}:12345` });
    await expect(walk(config(), anchor, Keypair.random())).rejects.toMatchObject({ statusCode: 502 });
  });

  it("rejects a missing signed transaction", async () => {
    await expect(
      verifyBuyerWithAnchor(config(), { account: Keypair.random().publicKey(), anchorDomain: ANCHOR }, fakeAnchor().deps),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("requireKybVerified", () => {
  it("is a no-op when enforcement is off", async () => {
    await expect(requireKybVerified(config(), Keypair.random().publicKey(), "buyer")).resolves.toBeUndefined();
  });

  it("blocks an unverified buyer and admits a verified one under enforcement", async () => {
    const cfg = config({ enforcement: "enforce" });
    const buyer = Keypair.random();
    await expect(requireKybVerified(cfg, buyer.publicKey(), "buyer")).rejects.toMatchObject({ statusCode: 403 });
    await walk(cfg, fakeAnchor(), buyer);
    await expect(requireKybVerified(cfg, buyer.publicKey(), "buyer")).resolves.toBeUndefined();
  });

  it("blocks a buyer whose verification has expired", async () => {
    const cfg = config({ enforcement: "enforce" });
    const buyer = Keypair.random();
    await pool.query(
      `INSERT INTO buyer_verifications (account, anchor_domain, sep12_status, checked_at, expires_at)
       VALUES ($1, $2, 'ACCEPTED', now() - interval '200 days', now() - interval '18 days')`,
      [buyer.publicKey(), ANCHOR],
    );
    await expect(requireKybVerified(cfg, buyer.publicKey(), "buyer")).rejects.toMatchObject({ statusCode: 403 });
  });
});

// Last: buildServer's onClose ends the shared pool.
describe("HTTP wiring (enforcement on)", () => {
  const anchor = fakeAnchor();
  const cfg = config({ enforcement: "enforce" });
  let app: Awaited<ReturnType<typeof import("../src/server.js").buildServer>> | undefined;
  const contractId = StrKey.encodeContract(randomBytes(32));
  const token = StrKey.encodeContract(randomBytes(32));

  afterAll(async () => {
    await app?.close();
  });

  function initializeBody(buyer: string) {
    const other = Keypair.random().publicKey();
    // Deliberately incomplete past the addresses. A request that gets past
    // the KYB gate fails the next validation (totalAmount) with a 400,
    // which proves the gate let it through without touching the network.
    return { buyer, cooperative: other, warehouseOperator: other, token, sourcePublicKey: buyer };
  }

  it("serves /kyb/config", async () => {
    const { buildServer } = await import("../src/server.js");
    app = await buildServer({ kybConfig: cfg, kybDeps: anchor.deps });
    const res = await app.inject({ method: "GET", url: "/kyb/config" });
    expect(res.json()).toEqual({ enforcement: "enforce", trustedAnchors: [ANCHOR], validityDays: 182 });
  });

  it("walks challenge → sign → verify → status over HTTP, then admits the buyer to initialize", async () => {
    const buyer = Keypair.random();

    const blocked = await app!.inject({ method: "POST", url: `/commitments/${contractId}/tx/initialize`, payload: initializeBody(buyer.publicKey()) });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().message).toContain("anchor KYB");

    const challenge = await app!.inject({ method: "POST", url: "/kyb/challenge", payload: { account: buyer.publicKey(), anchorDomain: ANCHOR } });
    expect(challenge.statusCode).toBe(200);
    const verify = await app!.inject({
      method: "POST",
      url: "/kyb/verify",
      payload: { account: buyer.publicKey(), anchorDomain: ANCHOR, transaction: sign(challenge.json().transaction, buyer) },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({ verified: true, sep12_status: "ACCEPTED" });

    const status = await app!.inject({ method: "GET", url: `/kyb/buyers/${buyer.publicKey()}` });
    expect(status.json()).toMatchObject({ account: buyer.publicKey(), verified: true });

    const admitted = await app!.inject({ method: "POST", url: `/commitments/${contractId}/tx/initialize`, payload: initializeBody(buyer.publicKey()) });
    expect(admitted.statusCode).toBe(400);
    expect(admitted.json().message).toContain("totalAmount");
  });

  it("blocks reassignment to an unverified new buyer on both reassign routes", async () => {
    const newBuyer = Keypair.random().publicKey();
    const direct = await app!.inject({
      method: "POST",
      url: `/commitments/${contractId}/tx/reassign-buyer`,
      payload: { newBuyer, sourcePublicKey: Keypair.random().publicKey() },
    });
    expect(direct.statusCode).toBe(403);
    const staged = await app!.inject({
      method: "POST",
      url: `/commitments/${contractId}/tx/reassign-buyer/propose`,
      payload: { newBuyer, proposerPublicKey: Keypair.random().publicKey() },
    });
    expect(staged.statusCode).toBe(403);
  });

  it("rejects a malformed address on the status route", async () => {
    expect((await app!.inject({ method: "GET", url: "/kyb/buyers/not-an-address" })).statusCode).toBe(400);
  });
});
