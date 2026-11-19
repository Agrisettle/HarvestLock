# `reassign_buyer` propose / sign / finalize — sequence diagram

How a buyer-position reassignment (PRD §4.8, contract `reassign_buyer()`) is
completed when the three required signers are on separate devices and no
script or process ever holds more than one private key. This is the same
staged multi-party mechanism `cancel` (two parties) and `resolve_dispute`
(three parties) use — see `../README.md`'s "Staged multi-party signing"
section for the shared design, and `../HANDOFF.md` for what's live-verified.

**Checked against the code, not from memory:** `src/server.ts` (routes),
`src/stellar/multiParty.ts` (propose/finalize), `src/db/pendingMultisigProposals.ts`
(Postgres staging), `src/db/migrations/004_generalize_multisig_proposals.sql`,
`src/stellar/tx.ts` (submit), and `HarvestLock-Contracts`'
`contracts/escrow/src/lib.rs` (`reassign_buyer`, `require_once_each`) as of
18 Oct 2026. If any of those change, update this file in the same change.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    actor B as Outgoing buyer (wallet)
    participant API as HarvestLock API (Fastify)
    participant DB as Postgres (pending_multisig_proposals)
    participant RPC as Stellar RPC / escrow contract
    actor C as Cooperative (wallet)
    actor N as Incoming buyer (wallet)

    rect rgb(238, 246, 255)
    note over B,RPC: Propose — only the current buyer may start this
    B->>API: POST /commitments/:id/tx/reassign-buyer/propose<br/>{ proposerPublicKey, newBuyer }
    API->>API: validate contract ID and both G-addresses (400 if malformed)
    API->>DB: findActiveProposal(contractId, "reassign_buyer")
    alt a reassign_buyer proposal is already active
        DB-->>API: existing row
        API-->>B: 200 existing proposal (idempotent — no duplicate staged)
    else none
        API->>RPC: getCommitment(contractId) — live read
        RPC-->>API: commitment (with current buyer)
        API->>API: proposerPublicKey must equal commitment.buyer, else 403
        API->>RPC: getAccount(proposer) + simulateTransaction(<br/>reassign_buyer(newBuyer), source = proposer)
        RPC-->>API: simulation success + resource footprint + 3 auth entries<br/>(1 source-account + 2 address entries)
        API->>RPC: getLatestLedger
        RPC-->>API: latest ledger sequence
        API->>API: set signatureExpirationLedger = latest + 17,280 (~24 h)<br/>on each non-source entry, server-side, before any XDR reaches a wallet
        API->>DB: INSERT proposal (status=pending, expires_at=now+24 h,<br/>func_xdr, soroban_data_xdr, auth_entries)
        DB-->>API: row
        API-->>B: 201 { id, status:"pending", pending_entries:[cooperative, incoming buyer] }
    end
    end

    rect rgb(245, 245, 245)
    note over C,N: Sign — each other party, own device, own request, own wallet
    C->>API: GET /commitments/:id/tx/reassign-buyer/propose (UI polls every 10 s)
    API->>DB: findActiveProposal
    DB-->>API: row
    API-->>C: { proposal: { pending_entries:[ {address, entry_xdr}, ... ] } }
    N->>API: same GET
    API-->>N: same proposal

    C->>C: Freighter signAuthEntry(my entry_xdr) — NOT signTransaction<br/>(signs one Soroban auth entry, no other party's key involved)
    C->>API: POST /commitments/:id/tx/propose/:proposalId/sign<br/>{ signerPublicKey, signedEntryXdr }
    API->>DB: SELECT ... FOR UPDATE; find this signer's unsigned entry
    API->>DB: UPDATE auth_entries (signer's entry now signed)
    DB-->>API: row (status still pending, other entry unsigned)
    API-->>C: { status:"pending", pending_entries:[ {incoming buyer} ] }

    N->>N: Freighter signAuthEntry(its own entry_xdr)
    N->>API: POST /commitments/:id/tx/propose/:proposalId/sign
    API->>DB: SELECT ... FOR UPDATE; mark signed
    note over API: every non-source entry is now signed
    API->>RPC: getAccount(proposer) — fresh, propose/finalize can be hours apart
    RPC-->>API: current sequence number
    API->>API: rebuild the tx from func_xdr + the original sorobanData +<br/>the signed entries (no re-simulation — that would mint fresh nonces)
    API->>DB: status=ready, final_xdr = rebuilt unsigned XDR
    API-->>N: { status:"ready", ready_xdr }
    end

    rect rgb(238, 255, 240)
    note over B,RPC: Finalize — an ordinary signed transaction, existing endpoint
    B->>API: GET proposal (polls) — sees status "ready"
    B->>B: Freighter signTransaction(ready_xdr) — an ordinary envelope signature;<br/>the source-account auth entry is satisfied by this, not signAuthEntry
    B->>API: POST /transactions/submit<br/>{ xdr, refreshContractId, completeProposalId }
    API->>RPC: sendTransaction + poll getTransaction
    RPC->>RPC: verify all 3 auth entries (each party exactly once),<br/>then buyer := newBuyer; save
    RPC-->>API: SUCCESS { hash }
    API->>DB: markCompleted(proposalId) — best-effort; not a new submit endpoint
    API->>RPC: getCommitment(refreshContractId) — best-effort cache refresh
    API->>DB: upsert mirrored commitment + reputation consequences — best-effort
    API-->>B: { status:"SUCCESS", hash }
    B->>API: GET /commitments/:contractId (UI refreshes detail)
    API-->>B: commitment.buyer == newBuyer, proposal no longer active
    end
```

GitHub renders Mermaid fenced blocks natively; the same block works in the
VS Code Markdown preview (with Mermaid support) and at <https://mermaid.live>.

## Step-by-step, with where each piece lives

| # | Step | Where |
|---|---|---|
| 1 | Current buyer proposes with `{ proposerPublicKey, newBuyer }`. | `src/server.ts` `POST /commitments/:contractId/tx/reassign-buyer/propose` |
| 2 | Existing active `reassign_buyer` proposal is returned as-is (200); a new one is inserted (201). `cancel` and `resolve_dispute` proposals are separate rows and don't block it. | `findActiveProposal` (`src/db/pendingMultisigProposals.ts:71`), `createProposal` (`:34`) |
| 3 | Proposal is limited to the *current* buyer (403 otherwise) — unlike cancel/dispute, which more than one party may start. | `src/server.ts:749-756` |
| 4 | Simulation is sourced from the proposer, so the proposer's own auth entry is `source_account` and is never handed to a wallet. | `buildMultiPartyProposal` (`src/stellar/multiParty.ts:89`) |
| 5 | `signatureExpirationLedger` is set **server-side** on every non-source entry (~17,280 ledgers ≈ 24 h). Freighter's `signAuthEntry(entryXdr)` takes no expiration argument, so this can't be done at signing time. | `src/stellar/multiParty.ts:87,114-117` |
| 6 | The proposal row stores the function XDR, the original simulation's `sorobanData` (resource footprint), and the entries; TTL is 24 h, kept roughly in sync with the ledger-sequence expiry. | `MULTISIG_PROPOSAL_TTL_MS` (`src/server.ts:203`), migration `004_generalize_multisig_proposals.sql` |
| 7 | Any viewer polls `GET .../reassign-buyer/propose`, which returns `{ proposal: … \| null }`; `pending_entries` contains only entries still unsigned. | `src/server.ts:778`, `serializeProposal` (`:206`) |
| 8 | Each other party signs their own `entry_xdr` with their wallet's `signAuthEntry` and posts it back. The route is method-agnostic — a proposal ID is already globally unique. | `POST .../tx/propose/:proposalId/sign` (`src/server.ts:843`) |
| 9 | Signing is a locked read-modify-write (`SELECT … FOR UPDATE`), so two parties signing at once can't clobber each other; a wrong signer or a repeat signature is rejected (400). | `signProposalEntry` (`src/db/pendingMultisigProposals.ts:102`) |
| 10 | When every non-source entry is signed, the API rebuilds the transaction from stored pieces (deliberately **not** re-simulating) and flips the proposal to `ready`. | `finalizeMultiPartyProposal` (`src/stellar/multiParty.ts:140`), `markReady` (`:139`) |
| 11 | The proposer signs `ready_xdr` classically and submits through the existing endpoint with `completeProposalId`; on success the proposal is marked `completed`. | `POST /transactions/submit` (`src/server.ts:895`), `markCompleted` (`src/db/pendingMultisigProposals.ts:143`) |
| 12 | On-chain, all three parties' auth is verified and `buyer` is rewritten; no funds move. | `reassign_buyer` + `require_once_each` (`HarvestLock-Contracts/contracts/escrow/src/lib.rs`) |

## Edge cases and checks (all enforced in code, not just documented)

- **Who may propose:** only the commitment's current buyer — 403 for the
  cooperative or the incoming buyer, checked against a live chain read.
- **Idempotent propose:** proposing again while a `reassign_buyer` proposal
  is active for that contract returns the existing one; a `cancel` proposal
  on the same contract is independent and doesn't collide.
- **Wrong signer / double sign:** 400 — the signer must have an unsigned
  entry on *this* proposal, so signing twice or signing someone else's
  entry fails without corrupting the staged row.
- **Expiry:** proposals expire after 24 h (`expires_at`); signing an
  expired proposal is rejected with "propose a fresh one". The auth entries
  themselves also carry a ~24 h on-chain `signatureExpirationLedger`, so a
  stale staged row can't produce a submittable transaction.
- **Reachable states:** `Draft`, `Locked`, `Advance1Released`,
  `CheckpointPassed`, `Advance2Released`, `ReadyForDelivery`. Simulating
  from any other status fails with the contract's `InvalidState`, because
  past `Delivered` the buyer field gates no remaining action.
- **Distinct/overlapping parties:** the contract's `require_once_each`
  calls `require_auth()` once per distinct address, so if `newBuyer` were
  the cooperative, only the cooperative's single entry would need signing
  — the API doesn't special-case this; it stages however many auth
  entries the simulation returns. (The deployed Deployment 10 WASM
  predates this dedupe — contract main's 16 Oct 2026 fix for overlapping
  roles — so against that instance a repeated role would fail during
  simulation with a host auth error instead.)
- **Failure surfaces:** a simulation failure (e.g. `InvalidState`) at
  propose time returns a typed 409 with the contract's `{code, name}`
  (`contractError`), not an opaque 500; Postgres `completeProposalId` /
  `refreshContractId` side effects after a successful submit are
  best-effort and logged, never masking a landed transaction
  (`src/server.ts:932`).
