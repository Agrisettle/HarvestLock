# API identity and session model — design decision (issue #5)

**Status: proposal, not implemented.** This is the design-first deliverable
issue #5 asks for. It unblocks phone-based auth in `coop-pwa`; it does not
add auth code. Companion documents:
[`cooperative-wallet-recovery.md`](./cooperative-wallet-recovery.md) (issue
#3 — the recovery half of the same problem) and PRD §4.6 / §16.1. This
document is the day-to-day-auth half.

---

## 1. The decision

**Phone number is a verification factor, not the signing key and not the
identity root.** HarvestLock does **not** custody a cooperative keypair and
bind it to an OTP. The cooperative's identity is its **entity**, whose
on-chain anchor is the address in the escrow commitment (a `G...` account
today, a `C...` smart wallet after issue #3). Authentication proves control
of that address with a standard Stellar challenge/response, and the API
issues a short-lived, stateless JWT. OTP-over-SMS is used only to verify and
rebind the *human's phone number* during enrollment, recovery and
re-association — never to authorise a funds-moving action by itself.

Concretely:

- Reject the custodial option ("API generates/holds a keypair, OTP unlocks
  it"). It recreates exactly the risk `api/HANDOFF.md:40` rejected for the
  deployer key and contradicts PRD §4.6's "no seed phrases surfaced".
- Reject "OTP-only, stateless per-request auth". A phone number is
  SIM-swappable, shared, and not an authorisation capability (PRD §16.1);
  treating it as one would put real escrowed funds behind a 6-digit code.
- Choose **non-custodial challenge → short-lived session → on-chain
  signature for writes**. Sessions make HTTP callers identifiable; the
  chain signature remains the actual authority.

## 2. What exists today, and why this is genuinely blocking

- `coop-pwa/src/wallet.ts:3-11` says plainly that Freighter is a testnet/MVP
  stand-in, "NOT the production auth model".
- The PWA passes a claimed `sourcePublicKey` in JSON bodies. The API
  validates that it is a well-formed public key but does not compare it to
  the commitment's cooperative on single-signer builders (`api/src/server.ts:652-673`),
  `flag-dispute` (`server.ts:735-740`) or `set-allocation` (`server.ts:780-787`).
  Staged `propose` routes compare a *declared* public key with the on-chain
  party (`server.ts:932-934,983-985,1034-1042`), but that string can be
  supplied by anyone; only the later real signatures stop them.
  `/transactions/submit` accepts any parseable signed XDR and caller-supplied
  side-effect fields (`server.ts:1132-1176`).
- There are no sessions, tokens, cookies, challenges, signed messages or
  API nonces anywhere in `api/src` or `coop-pwa/src`. CORS is configured by
  exact origins and is explicitly "a browser permission boundary, not API
  authentication" (`server.ts:147-169`). A global 100 req/min/IP rate limit
  exists (`server.ts:354-381`).
- Phone numbers exist only as allocation-member PII — per-member random salt
  plus `HMAC-SHA256(salt, phoneNumber)` (`api/src/db/allocationMembers.ts:12-19,40-48`).
  Phone reads are intentionally absent because there is no way to gate who
  may see them (`allocationMembers.ts:71-77`; `api/README.md:238-247`).
  No phone ownership has ever been verified.

Enforcement today therefore lives entirely in the contract's
`require_auth()`. That is sound for on-chain safety but leaves the API
unable to answer "which cooperative is this HTTP caller?" — which is what
blocks phone auth, PII read endpoints, voucher issuance and SDP payout
triggers.

## 3. Proposed model

### 3.1 Identity

- Introduce a `coop_entities` row per legal cooperative (the entity PRD §4.6
  says the contract terms bind) and an `coop_identities` row binding that
  entity to: a current Stellar address (`G...` or `C...`), a phone number,
  verification state, and screening status.
- Store the phone number **encrypted at rest**, with a separate keyed hash
  for lookup, and keep it wipeable — the same NDPA discipline as
  `allocation_members`. Do not copy it into challenge, payout or pending
  tables. Note the real gap this must avoid: `pending_submissions` already
  stores staged allocation phone numbers as JSONB with no erasure path; fix
  that before adding another PII copy.
- One entity can have several verified officers, but there is no global
  "one phone = one identity" rule: PRD §16.1 explicitly allows shared
  handsets. Phone ownership is evidence, never identity by itself.
- The entity id, not the address, is the stable subject of reputation,
  vouchers and payouts. Rotation (issue #3) updates the entity's active
  address; strikes and bars follow the entity. Today `party_standing` is
  address-keyed, so a rotation would otherwise reset or evade standing.

### 3.2 Authentication

- **For `C...` cooperative accounts (target):** implement the challenge /
  token endpoints of [SEP-45](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md),
  with a `web_auth_verify` contract published in the API's `stellar.toml`
  as `WEB_AUTH_FOR_CONTRACTS_ENDPOINT` / `WEB_AUTH_CONTRACT_ID` /
  `SIGNING_KEY`. The client signs the auth entry with the account's own
  key material (a passkey, per issue #3); the API simulates the entries and
  issues a JWT. No key is custodied.
- **For `G...` cooperative accounts (transitional stand-in):** the mature
  equivalent is SEP-10 challenge/response. Use it until the smart wallet is
  live, so the API has one session shape (`{ sub: entityId, act: address,
  role: 'cooperative', exp, jti }`) regardless of address type. Freighter
  may still hold the key during this phase; that is a wallet choice, not an
  API custody arrangement.
- Replay protection follows the SEP: a unique server nonce, short challenge
  lifetime, consumed-once semantics, and near-future signature expiration
  ledgers. Store challenge nonces briefly in Postgres (`auth_challenges`
  with `expires_at` / `consumed_at`) and reject reuse.
- JWTs are **stateless and short-lived** (engineering starting point: 30
  minutes, to be revised with pilot behaviour), signed by a server secret,
  with no session table. Revocation works by expires-soon plus a per-entity
  `active` flag checked on each request. Do not build refresh tokens or a
  session store before there is a real user who needs them.
- OTP is a separate, narrowly scoped flow: `POST /coop/phone/challenge`
  (SMS via Termii, per PRD §17; `DRY_RUN` only in local/testnet),
  `POST /coop/phone/verify` (short expiry, attempt cap, per-IP + per-phone
  rate limits). Its only power is to mark a phone verified for an entity or
  to permit a supervised rebind — never to sign a transaction.

### 3.3 Authorization on every write

Authentication answers "who is calling"; authorization must then bind the
session to the commitment:

1. Resolve the commitment's `cooperative` from a **live chain read**, not
   from the JSON body. Compare it with the session's `act` address (or with
   the entity's currently active address after a rotation).
2. Do this for the generic no-arg builders, `flag-dispute`,
   `set-allocation`, the staged `propose` routes and the generic `sign`
   route (which currently matches a signer by address string only,
   `api/src/db/pendingMultisigProposals.ts:117`).
3. Keep the existing rule that the contract is the final authority: the API
   refuses early with 401/403 where it can, and the Soroban
   `require_auth()` still rejects a bad signature on chain. Do not start
   signing transactions server-side to "make auth easier".

This is a small, mechanical change to existing routes once the session
exists, and it also closes the documented stand-in gap in
`docs/voucher-proposal.md:66` ("until #5 settles phone-based auth … the API
checks that the signer is the cooperative", which is currently only partly
true).

### 3.4 Phone binding, SIM swap and recovery

Before any phone is bound or rebound:

- Screen the number against TIRM (or the contracted equivalent, PRD Open
  Question 12 / `ROADMAP.md` Track C). Direct access is unresolved; assume a
  licensed-partner path may be needed.
- Enforce a cooling-off window after a SIM change and refuse a number changed
  inside the current contract cycle without co-signer re-attestation
  (PRD §16.1's hard requirement). These are engineering defaults until a
  partner tells us otherwise — say so in code, as with `claimWindowSecs`.
- A rebind is a supervised operation: phone OTP + the entity's current
  account signature + a co-signer attestation. OTP alone never rotates a
  key. This is where #5 meets #3's 2-of-3 recovery set.
- NDPA erasure deletes the phone/encrypted payload and leaves only the salted
  hash, exactly as `DELETE /allocation-members/:memberHash` does today.

## 4. Risks and how to retire them

- **SEP-45 is still Draft** (v0.1.1, updated 2025-12-16) and Stellar's
  contract-account docs warn that full client support, including
  transaction simulation, is still under development. Do not promise a
  passkey-only UI before a testnet spike proves the browser can sign the
  challenge and a staged auth entry. If it cannot, ship the SEP-10/`G...`
  transitional path and reopen the decision rather than custoding keys.
- **SIM swap and shared handsets** mean a verified phone is weak evidence.
  That is why OTP never authorises money movement and why the smart-wallet
  policy (issue #3) remains the authority.
- **New PII surface**: OTP logs, challenge rows and identity rows must not
  retain phone numbers, codes (only their hashes) or raw SMS payloads.
  Add an erasure test that walks all new tables, matching the existing
  `allocation_members` end-to-end pattern.
- **CORS/rate limits**: exact `CORS_ORIGINS` as today; dedicated limits on
  challenge/token/OTP routes; no wildcard to accommodate a browser flow.

## 5. Implementation sequence (once this decision is agreed)

1. Entity + identity schema, phone OTP with Termii (`DRY_RUN` in testnet),
   TIRM stub with an explicit "not screened" state that blocks real
   disbursement. No code should treat an unscreened number as usable.
2. SEP-10 challenge/token for `G...`, stateless JWT, nonce table, and the
   session middleware on all cooperative write/propose/sign routes.
   `coop-pwa` switches from "claimed address" to session; Freighter can
   still be the signer during this phase.
3. Issue #3's smart wallet lands; add SEP-45 for `C...` against the same
   JWT shape, migrate standing from address keys to entity keys.
4. Only then expose PII-bearing or payout-triggering routes (member
   allocation reads, voucher redemption, SDP payout trigger).
5. Exercise one unaided onboarding with a real non-crypto-native
   cooperative lead — PRD §17.3's mainnet gate — before calling this done.

## 6. Definition of done for issue #5

- [ ] Decision recorded here and agreed; no custodial cooperative key exists.
- [ ] One real phone verified by OTP (testnet `DRY_RUN` is acceptable for the
      first proof only if stated), bound to a cooperative entity and its
      address, with TIRM status recorded.
- [ ] A challenge → short-lived JWT round-trip works against live testnet,
      with replay and expiry tests.
- [ ] Every cooperative HTTP write compares the session entity/address with
      the on-chain commitment; the previous "claimed public key" gap is
      closed and tested.
- [ ] Key rotation preserves reputation because standing is entity-keyed.
- [ ] `coop-pwa` no longer presents Freighter as the auth model; it can
      still be the transitional signer.
- [ ] All new phone/PII tables are covered by the erasure path.

## Sources checked

- PRD §4.6, §16.1, §17 / §17.3 in [`PRD.md`](./PRD.md).
- [`api/HANDOFF.md`](../api/HANDOFF.md) "What's deliberately deferred —
  Auth/sessions" and its non-custodial signing rationale.
- `api/src/server.ts`, `api/src/db/allocationMembers.ts`,
  `api/src/db/pendingMultisigProposals.ts`, `coop-pwa/src/wallet.ts` and
  `coop-pwa/src/api.ts` for exactly what the current stand-in does.
- [SEP-45](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md)
  (Draft) for contract-account web auth, nonce and lifetime guidance;
  Stellar's [Complex Account](https://developers.stellar.org/docs/build/smart-contracts/example-contracts/complex-account)
  example for the client-support caveat.
