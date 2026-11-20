# SDP integration plan — closing the spike (issue #4)

**Status: proposal, not implemented.** The SDP *spike* was real; the
application integration described here has not been written. This document
decides the shape of that integration before code lands. Companion:
[`sdp-spike.md`](./sdp-spike.md), PRD §17 / §17.1, `ROADMAP.md` Phase 1
(Testnet tranche).

---

## 1. Decisions requested

1. **Deploy SDP as-is, never fork.** This was already settled in PRD §17.1
   and honoured by the spike; it is not reopened here. Go stays out of this
   codebase; HarvestLock calls SDP's HTTP API from TypeScript.
2. **Manual trigger first, automatic later.** The first real payout is
   triggered explicitly, per commitment, after settlement and after the
   cooperative has elected the member split. Do not silently pay members on
   `Settled`: today's settlement pays the *cooperative* wallet, the ledger is
   record-only, and PRD §4.9 treats member-level distribution as a
   transparency rung the cooperative opts into. Automation is a later PR,
   gated on a real pilot run.
3. **Farmers are still SMS-only.** No farmer app. The embedded-wallet
   WebAuthn ceremony needed by one roadmap proof is an opted-in test
   recipient's ceremony, not evidence that HarvestLock is about to ship an
   app to seasonal users. Whether direct member wallets are the pilot's
   payout channel at all is an open counterparty question (§6).

## 2. What the spike actually proved

From [`docs/sdp-spike.md`](./sdp-spike.md), 18 Oct 2026 on testnet:

- Upstream `stellar/sdp-v2:latest` (v7.0.0) ran unmodified — no fork, no
  source changes. Tenant `harvestlock-spike` with `DRY_RUN` senders.
- Three real payout batches, all verifiable on Horizon: one classic payment,
  one classic split to two members, and — the roadmap-relevant one — a split
  into two **phone-provisioned embedded smart wallets**, with contract-deploy
  and payment hashes recorded.
- The exact API sequence: `POST /login` (tenant in `SDP-Tenant-Name`),
  `POST /disbursements`, multipart `POST /disbursements/{id}/instructions`,
  `PATCH /disbursements/{id}/status STARTED`, then
  `GET /disbursements/{id}/receivers` for per-payment transaction hashes.
- Embedded-wallet provisioning goes through
  `POST /embedded-wallets { token, public_key, credential_id }` after.
  SDP's invitation; TSS deploys the wallet contract and pays into it.
- Webhooks are signed with `X-SDP-Timestamp` and
  `X-SDP-Signature: sha256=<HMAC-SHA256(secret, timestamp + "." + payload)>`,
  deliver batch-level events (not per-payment hashes), and run on a 30s job.

**Not proved:** a real person's phone, real SMS delivery, or a real browser
WebAuthn ceremony. Passkeys were generated P-256 keys driven through the
same endpoint the SDK calls; SMS was `DRY_RUN`. A reused passkey key collided
at contract-deploy time (`contract already exists`) and SDP did not auto-retry
— the wiring must generate a fresh key per receiver and monitor `FAILED`
wallets.

## 3. Where HarvestLock attaches today

- **Allocation ledger**: `POST /commitments/:contractId/tx/set-allocation`
  stages `{ phoneNumber, shareBps }`; `api/src/db/allocationMembers.ts`
  computes a fresh random salt per member and
  `memberHash = HMAC-SHA256(salt, phoneNumber)`. Only the salt, hash and
  share go on chain; the phone number is persisted (after confirmed submit)
  in `allocation_members`, and `DELETE /allocation-members/:memberHash`
  nulls it for NDPA s.34 erasure. `getAllocationMembers()` deliberately
  excludes the phone column — there is no phone-number read endpoint because
  there is no auth/session model yet (`api/README.md:238-247`).
- **Settlement**: `settle` is a generic no-arg contract method; all writes go
  through `POST /transactions/submit`, whose side-effect pipeline
  `applySubmitSideEffects` (`api/src/server.ts:96-145`) currently handles
  cache refresh, staged-proposal completion and allocation-member persistence
  only. Slow submissions persist side-effect fields in `pending_submissions`
  (migration `007`) and return 202; `GET /transactions/:hash` applies them
  once. **A payout trigger must be threaded through both paths**, or it will
  vanish exactly when the network is slow.
- **No SDP code exists**: no client module, env vars, webhook route, config
  or compose file is committed. All SDP mentions are documentation.

One caveat worth fixing before this integration: `pending_submissions` stores
the staged allocation array as JSONB, including `phoneNumber` and `salt`. The
erasure endpoint only nulls `allocation_members.phone_number`; it does not
touch that JSON copy. Do not add a third phone-number copy in a payout table.
Design payout rows around `member_hash` and resolve the phone only at the
moment of execution, through one audited accessor.

## 4. Proposed components

### 4.1 API module (TypeScript, server-side only)

- `api/src/sdp/client.ts` — login (operator credential), tenant header,
  disbursement create/instructions/start, receiver lookup, and webhook
  signature/timestamp verification. One function per SDP call the spike
  exercised; no generic HTTP escape hatch.
- `api/src/sdp/payouts.ts` — turn a cooperative-elected split into SDP rows,
  enforce idempotency, own the state machine (`DRAFT → READY → STARTED →
  COMPLETED` plus HarvestLock's `FAILED`/`RECONCILING` states), and record
  per-member transaction hashes from `/receivers`.
- `api/src/db/migrations/008_sdp_payouts.sql` — a `sdp_payout_batches`
  table (contract, settlement tx hash, elected split, SDP disbursement id,
  status, timestamps) and `sdp_payouts` rows keyed by
  `(batch_id, member_hash)` with amount, currency, `external_id`, status and
  `stellar_transaction_id`. `UNIQUE (batch_id, member_hash)` is the
  idempotency gate — the `standing_events` lesson applies here too: never
  key exactly-once behaviour on an observed status transition, since
  concurrent reads can double-pay and failed writes can lose a payment
  record permanently.

### 4.2 Trigger and routes

- For the first testnet proof, invoke the module from a script with an
  operator credential. **Do not expose an unauthenticated HTTP trigger**:
  this is a funds-moving action, and issue #5's identity/session decision is
  the blocker. The existing unauthenticated write routes are a documented
  MVP stand-in for signed Soroban calls, not a basis for paying out money.
- Once #5 lands: `POST /commitments/:contractId/sdp-payouts` (cooperative
  session only, with the elected split in the body), `GET
  /commitments/:contractId/sdp-payouts` (read status/hashes), and
  `POST /webhooks/sdp` (HMAC + bounded timestamp, no auth session).
- If automatic-on-settlement is added later, the trigger belongs in
  `applySubmitSideEffects` **and** the 202 pending-submission claim path,
  wrapped in the same best-effort convention as the other side effects —
  an SDP failure must not turn an already-confirmed on-chain settlement into
  a 500 for the caller. "Best effort" must mean *recorded and retryable*,
  not silently dropped.

### 4.3 Configuration and secrets

Add to `api/.env.example` and `render.yaml` (Render values `sync: false`,
filled in the dashboard, same as `DATABASE_URL` / `DEPLOYER_SECRET_KEY`):

- `SDP_BASE_URL`, `SDP_TENANT_NAME`
- `SDP_OPERATOR_USERNAME`, `SDP_OPERATOR_PASSWORD` (backend secret store only)
- `SDP_WEBHOOK_SECRET`
- `SDP_DISTRIBUTION_ACCOUNT`

SMS sender is **Termii** per PRD §17 — SDP's `DRY_RUN` sender is acceptable
for local/testnet development and explicitly not for a real recipient. The
distribution account seed stays in a KMS/vault, not an env var; for the
pilot it is funded from buyer deposits, not friendbot. Testnet observed fee
was ~0.073 XLM per smart-wallet invoke, an order of magnitude above classic
payments — price member-sized payouts accordingly.

## 5. Execution flow for the first real payout

1. **Screen before touching the phone.** TIRM (or its contracted
   equivalent) must clear the number; enforce the SIM-change cooling-off and
   the "no payout to a number changed inside this contract cycle without
   co-signer re-attestation" rule from PRD §16.1. This is a hard requirement
   and is not implemented anywhere yet.
2. **Elect the split.** Cooperative records, per member, the amount and
   whether it is cash/voucher/wallet payout. With an allocation ledger, map
   `share_bps` to amounts from the settled total; rounding remainders go to
   the cooperative, never over the escrowed total. Store the election before
   any SDP call and freeze it once the batch starts.
3. **Resolve recipients.** For members with a wallet address, use the
   `PHONE_NUMBER_AND_WALLET_ADDRESS` disbursement variant. For members
   without one, use embedded wallets (`PHONE_NUMBER`): SDP sends the
   invitation SMS, the member's wallet SDK performs a real WebAuthn
   ceremony, and HarvestLock receives `token`/`public_key`/`credential_id`
   via SDP's own flow. One fresh P-256 key per receiver — see the spike's
   collision failure. HarvestLock never sees or stores a private key.
4. **Create and start the disbursement** through `api/src/sdp/client.ts`,
   with `external_id` set to the allocation/member id (the replay anchor).
   Upload CSV instructions; `STARTED`.
5. **Reconcile.** Verify the webhook HMAC and timestamp, treat events as
   at-least-once, then call `GET /disbursements/{id}/receivers` for each
   member's `payment.stellar_transaction_id` (events are batch-level only).
   Store the hash against the `sdp_payouts` row and surface "paid, tx
   <hash>" in `coop-pwa` and `warehouse-app`.
6. **Erasure still works.** Deleting the off-chain phone mapping must leave
   the on-chain hash and the payout record intact but permanently
   unlinkable; add a test that follows the existing
   `DELETE /allocation-members/:memberHash` end-to-end pattern.

## 6. Open counterparty questions (do not code around these)

- PRD §13 P3 and §16.1 say seasonal farmers get SMS, no app, and shared
  handsets are common. A browser passkey ceremony sits awkwardly with that.
  Is the real first payout a proof with one opted-in smartphone user, or
  should the pilot stay at Rung 1 (aggregate settlement to the cooperative,
  member distribution off-chain) and defer member wallets entirely?
- Is SDP's SEP-24 "receiver brings a wallet" path preferable for this
  cooperative? The spike did not exercise it.
- Who owns TIRM screening access — HarvestLock directly, or a licensed
  partner (PRD Open Question 12)? This gates step 5 above and is currently
  assigned to the mainnet tranche in `ROADMAP.md`; it should be revisited
  before any real disbursement, testnet or not.
- The site's Roles & Responsibilities page discloses release to the
  cooperative only (`site/src/components/RolesPage.tsx`); a Rung 2 direct
  payout needs that disclosure updated before it happens.

## 7. Definition of done for issue #4 (the narrow roadmap item)

- [ ] One opted-in real phone number, with a real SMS delivered through
      Termii (no `DRY_RUN`, no reserved example number).
- [ ] One real browser WebAuthn ceremony producing a fresh passkey per
      receiver.
- [ ] One split payout from HarvestLock's side — two members, real amounts,
      transaction hashes recorded in `sdp_payouts` and shown in the
      cooperative's view.
- [ ] TIRM screening (or the documented contracted equivalent) completed
      before disbursement.
- [ ] Idempotency and webhook-replay tests pass without live network; the
      API module and config are documented in `api/HANDOFF.md` and
      `api/.env.example`.
- [ ] `docs/sdp-spike.md` remains the honest record of what the spike did
      **not** prove; `ROADMAP.md` is updated only when the above are real.

## 8. Suggested PR order

1. This design decision (no code).
2. SDP client + payout schema + webhook verification, with network-free
   tests and secret config — no live trigger exposed.
3. Operator-run testnet payout with one real opted-in recipient, recorded
   with hashes (the issue #4 "done" step).
4. `coop-pwa` split-election and payout-status UI, after #5's session model.
5. Automatic-on-settlement, only after the first manual run has been
   reconciled against SDP and the transparency-rung question is answered.
