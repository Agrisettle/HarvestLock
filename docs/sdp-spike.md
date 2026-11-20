# SDP spike — upstream SDP on testnet, simulated phone onboarding

This is a partial spike toward `ROADMAP.md`'s Phase 1 (Testnet tranche)
item: *"SDP integration: deploy (do not fork, PRD §17.1) SDP, get one real
phone-number-provisioned wallet, execute one split payout to it."* The
deployment and testnet transactions below are real, but the phone numbers
are reserved examples, SMS ran in `DRY_RUN`, and passkey registration used
a generated key rather than a browser ceremony. **This does not meet the
roadmap item's real-phone requirement, which remains open.**

**What was verified** (18 Oct 2026, testnet): the upstream platform ran
unmodified, the real SDP API provisioned embedded smart-wallet contracts
using generated P-256 keys, and SDP submitted split-payout transactions
that were verified against Horizon. **What was not verified:** onboarding
a real person's phone number, delivery of an invitation SMS, or a browser
WebAuthn ceremony. No real phone received a message. Those steps still
require an opted-in test recipient, an SMS provider, and a browser wallet
SDK ceremony.

## What this is, and what it deliberately isn't

`PRD.md` §17.1 settles the Go question: "Deploy. Do not fork. Everything
else is TypeScript and Rust." This spike honours that literally — the
deployment runs `stellar/sdp-v2:latest` (reports version 7.0.0) with **no
source changes and no fork**, driven entirely through SDP's own HTTP APIs.
No application code was written for the spike.

| Thing | Status in this spike |
|---|---|
| SDP deploy, unmodified | **Real** — upstream image, upstream migrations, unmodified binaries |
| Tenant, distribution account, on-chain classic payout | **Real** — three batches, all transactions verifiable on Horizon (hashes below) |
| Phone-provisioned wallet | **Partial** — embedded smart-wallet contracts deployed per reserved example number through `POST /embedded-wallets`; no phone was contacted |
| Passkey (WebAuthn) ceremony | **Simulated** — the SDK-facing endpoint was called with a generated P-256 public key; no browser, no authenticator |
| SMS / email delivery | **Dry run** — SDP `DRY_RUN` senders; messages written, nothing sent |
| KYC / TIRM screening, anchor cash-out, mainnet | **Not attempted** — see "What this doesn't cover" |

## What was deployed

Three containers, all from the upstream image `stellar/sdp-v2:latest`:

| Service | Image | Role / ports |
|---|---|---|
| `sdp-api` | `stellar/sdp-v2:latest` | server API `:8000`, admin API `:8003`, metrics `:8002` |
| `sdp-tss` | `stellar/sdp-v2:latest` | transaction submission service (channel accounts, Soroban deploys, payments), metrics `:9002` |
| `sdp-v2-database` | `postgres:14-alpine` | SDP-owned Postgres, db `e2e-sdp`, tenant schema `sdp_harvestlock-spike` |

The compose file is derived from the upstream integration-test harness
(`internal/integrationtests/docker/docker-compose-e2e-tests.yml`) with one
sandbox-only deviation: `network_mode: host` with the DB reached over
`localhost`, because this sandbox blocks inter-container TCP on the compose
bridge network. That is a sandbox artifact, not an SDP limitation — on a
normal host the upstream compose works as-is.

Configured and created:

| Thing | Value |
|---|---|
| Tenant | `harvestlock-spike` (schema `sdp_harvestlock-spike`, org "HarvestLock Spike Org") |
| Distribution account | `GCVSU4JCN73EPAIOXE4M52DG3XPZUU6FS4NTXMVVGSOJJ44EG46MJ3J4` (friendbot-funded) |
| Channel account | `GCTYXFNPIISYYOOWJU7WN2T5R2EJWXB2URPAX2GLV6HDSCM4XCULKAA5` (auto-created and sponsored by the distribution account on TSS startup; pays transaction fees) |
| SEP-10 signing key | `GD7V5DJFV2ZQ4O64Y5ZJIGMGREKKNAVBL3QKWNHMKVORMPXLI3NSEMQV` |
| SMS / email senders | `DRY_RUN` (SDP writes the message, delivers nothing) |
| MFA / reCAPTCHA | disabled (localhost testnet instance, per upstream e2e config) |

The interactive `make setup` wizard was skipped (it expects a terminal);
the tenant was created through the admin API, and the operator user's
password/active flag were set directly in the tenant schema — the same
effective provisioning the upstream e2e harness performs.

## The payouts

All three batches are on testnet, XLM, from the distribution account.
Every hash below can be pasted into
`https://horizon-testnet.stellar.org/transactions/<hash>`.

### Batch 1 — single classic payout

Disbursement `HarvestLock SDP Spike`, contact type
`PHONE_NUMBER_AND_WALLET_ADDRESS` (destination wallet address supplied in
the CSV by the operator; no receiver self-registration needed).

| Receiver | Destination | Amount | Tx hash | Ledger | Time (UTC) | Fee |
|---|---|---|---|---|---|---|
| `+12025550191` | `GCDYFAJSZPH3RCXL6NWMMOY54CXNUBYFTDCBW7GGG6VPBW3WSDKSB2NU` | 0.1 XLM | `1ba9acd06fa8fe659fd3fbbfa34f09c7477ea7a1d3529ce9dda5ac462ef9c2ba` | 5252309 | 00:58:52 | 200 stroops |

### Batch 2 — classic split payout to two members

Same contact type; one disbursement, two rows in the instructions CSV,
two classic payment transactions.

| Receiver | Destination | Amount | Tx hash | Ledger | Time (UTC) | Fee |
|---|---|---|---|---|---|---|
| `farmer-001` `+12025550192` | `GC6HI5IFPADUSFF3IFTHJSSLT2PV6ZSU7S6FOK33BLCVWU7566NFA4WW` | 0.15 XLM | `e22820ca63307d54b80c840818c1f5e2ab4fdba6ae3c559fdd458ef12582a782` | 5252336 | 01:01:07 | 200 stroops |
| `farmer-002` `+12025550193` | `GD2NP7SSSD2B7CKFU7HXJQQKNSQCIET3FLBHDUCCBUBCU4ACELDFLXIW` | 0.05 XLM | `549f071fa09493ddb178edf681d831c8cddad5f3fa911fa6637c3fc0b8f44463` | 5252337 | 01:01:12 | 200 stroops |

### Batch 3 — phone-provisioned (embedded) wallet split payout

This is the one the roadmap item is actually about: contact type
`PHONE_NUMBER`, wallet "Embedded Wallet", CSV carrying **only phone, id
and amount** — no wallet address. SDP provisions a smart-wallet contract
per member from the phone number plus a passkey public key, deploys it via
the TSS, then pays the amount into the contract.

| Member | Phone | Smart wallet (contract address) | Amount | Wallet-creation tx | Payment tx | Ledger | Time (UTC) | Fee |
|---|---|---|---|---|---|---|---|---|
| `member-004` | `+12025550194` | `CAHUCBZR2DLYKQPVMFUO7IMOSOHDKESZZ3YNEUWJ6BUUD27OCMA4B73T` | 0.12 XLM | `4f025687f80eee1deeb04cbf54a8cd71152fc439108b7fc0646eb886c613aa89` | `f4efb1279a9b42336539f587eca282db9a748effa58fb1d8793322f038938461` | 5252442 | 01:09:57 | 730720 |
| `member-005` | `+12025550195` | `CC2GQJBXABZARRKPXSDG3XWKUDI3KYBIQPLSV3QY3FZKNMKX2FSNDUXV` | 0.08 XLM | `8059539df7da8bc6171a1e0908f681eee6976e95a9b900d2d529b4c283fe2687` | `bbc785172c15dbf93f3b20f6d66e6fcdd1488cf7e41d272ec644e5f6fe93812e` | 5252490 | 01:13:57 | 730906 |

Disbursement `HarvestLock Phone Wallet Split` completed at 01:13:58 UTC;
both payments `SUCCESS`. The two payment fees are the Soroban resource
fees for the contract invokes (~0.073 XLM each on testnet) — an order of
magnitude above the 200-stroop classic payments, and worth knowing when
pricing farmer-sized payouts.

## The flow, exactly as executed

Classic (batches 1–2), per SDP's server API:

```
POST /login                                  → JWT (header: SDP-Tenant-Name)
POST /disbursements                          → DRAFT
POST /disbursements/{id}/instructions        → multipart CSV upload → READY
PATCH /disbursements/{id}/status STARTED     → STARTED
   ...TSS picks the payments up and submits the Stellar transactions...
GET /disbursements/{id}/receivers            → per-receiver payment.stellar_transaction_id
                                             → disbursement auto-transitions to COMPLETED
```

Payment state machine observed: `DRAFT → READY → PENDING → SUCCESS`.
Disbursement: `DRAFT → READY → STARTED → COMPLETED`.

Embedded (batch 3): the CSV upload creates a `receiver_wallet` per member;
the invitation job then provisions an `embedded_wallets` row with a
one-time token and "sends" the invitation SMS (dry run). The passkey
registration — in production, the wallet SDK after a WebAuthn ceremony —
is a single call:

```
POST /embedded-wallets  { token, public_key, credential_id }   → 202 PENDING
   ...TSS deploys the smart-wallet contract (sponsored, ~10s)...
   ...receiver_wallet becomes REGISTERED with the contract address...
   ...the payment is submitted as an invokeHostFunction (SAC transfer into the contract)...
```

Two transaction-level details worth noting:

- **Memo.** Classic payments carry memo `sdp-0121783acd70` — SDP derives
  it per tenant as `sdp-` + the first 12 hex chars of
  `SHA256(tenant BaseURL)` (here `http://localhost:8000`). It identifies
  *the tenant*, not the payment, and is the easy way to find HarvestLock's
  classic payouts on-chain. The smart-wallet contract invokes carry **no
  memo** — match those through the API's payment records instead.
- **Events.** Every disbursement wrote outbox events
  (`disbursement.created / approved / submitted / completed`) to the
  tenant's `events` table. With `organization.webhook_url` set, the
  `event_delivery_job` (30s cadence) POSTs each event as JSON signed with
  `X-SDP-Timestamp` and `X-SDP-Signature: sha256=<HMAC-SHA256(secret,
  timestamp + "." + payload)>`, and it refuses to deliver to private
  addresses. The events are batch-level and carry the `disbursement_id`,
  not per-payment hashes.

## The failure worth keeping: one passkey key, two wallets

The first attempt at batch 3 reused a single generated P-256 public key
for both members. `member-004`'s contract deployed; `member-005`'s deploy
failed at RPC simulation:

```
HostError: Error(Storage, ExistingValue)
"contract already exists"
```

The smart-wallet contract address is derived from the passkey key (plus
the known WASM hash and deployer), so the same key produced the same
predicted address and the second deploy collided. SDP marked that wallet
`FAILED` and did **not** auto-retry ("cannot be retried" in the TSS
crash-tracker log). Recovery was an operator-level retry: reset the
`embedded_wallets` row to `PENDING` with null key material and re-call
`POST /embedded-wallets` with a distinct key. Two takeaways:

1. A concrete operational requirement — the wallet SDK must generate a
   fresh key per receiver, and a failed provisioning has no self-healing
   path in SDP today.
2. The failure surfaced cleanly in both the API and the database, with
   the RPC error preserved — the kind of failure mode the wiring below
   has to monitor, not assume away.

## What application-side wiring would look like

A thin SDP client module in the HarvestLock API (TypeScript, per PRD
§17.2), never browser-side:

1. **Config** — SDP base URL, tenant name, and a dedicated operator
   credential held in the backend's secret store. Login returns a JWT;
   the tenant travels in the `SDP-Tenant-Name` header.
2. **Payout trigger** — when a commitment's settlement/attribution flow
   produces the per-member split (PRD §4.9: Rung 1 pays the cooperative
   wallet, Rung 2 adds per-member rows), map each allocation row to
   `{ phone, external_id, amount }`. `external_id` should be the
   allocation/member id — it is the idempotency anchor if a batch is
   replayed. Members with a wallet address can go in the
   `..._AND_WALLET_ADDRESS` variant; members without one get an embedded
   wallet (batch 3 above) — the two can coexist inside one contract
   settlement because they are separate disbursements.
3. **Execution** — create disbursement → upload the instructions CSV →
   mark `STARTED`. For embedded wallets, no further operator action:
   invitation, passkey registration (the wallet SDK's job), contract
   deployment and payment all proceed on their own.
4. **Completion signal** — configure the tenant webhook URL and consume
   the `disbursement.*` events for batch-level state (verify the HMAC
   signature and bound replay by timestamp). Because events don't carry
   per-payment transaction hashes, follow up with
   `GET /disbursements/{id}/receivers` and read
   `payment.stellar_transaction_id` per member; store it against the
   off-chain allocation record next to the delivery NFT/contract state.
   (Alternatively, stream Horizon for the distribution account; for
   classic payments the tenant memo filters those cleanly.)
5. **Surfacing** — the warehouse-app's delivery detail and the
   cooperative PWA's member view are the natural places to show
   "paid, tx <hash>" per member. Nothing in SDP needs to change for any
   of this — it is one more API client from HarvestLock's side.

## What this doesn't cover

- **Real messaging and a real passkey.** `DRY_RUN` senders and a
  generated P-256 key mean the last mile to an actual farmer's phone was
  not exercised. A production switch means a Twilio/SES-class sender and
  the SDP wallet SDK doing a real WebAuthn ceremony in a browser.
- **The SEP-24 external-wallet path.** SDP also supports receivers who
  bring their own wallet (phone + OTP + wallet address via SEP-24). Not
  exercised here; the embedded path is the one the roadmap item names.
- **KYC / TIRM screening** (PRD §16.1's hard requirement) — not part of
  this spike and not part of SDP.
- **Anchor cash-out, Circle/USDC, mainnet.** All testnet, all XLM.
- **Key management.** The distribution seed lived in the container
  environment for the spike; production needs the KMS/DB-vault option
  SDP supports, funded from buyer deposits rather than friendbot.
