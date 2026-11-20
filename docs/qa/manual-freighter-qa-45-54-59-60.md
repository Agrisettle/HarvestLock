# Manual Freighter QA: #54, #59, #60 (coop-pwa) and #45 (buyer-app)

> What these four issues ask for is a real, installed Freighter extension
> signing real testnet transactions. This environment cannot install a
> browser extension, and every frontend README already records that gap.
> What this change adds is the strongest verification the repository can
> actually produce — executable end-to-end coverage of the four exact
> flows — plus this write-up of what was verified, what a real Freighter
> popup is expected to show, and the small manual checklist that remains.

## 1. Method: what is real, what is stubbed

The specs added here use the existing `e2e/` harness, not a new mock layer:

| Layer | Status |
| --- | --- |
| Browser, app bundles, API, Postgres, Soroban RPC, Horizon | Real |
| Escrow contract, testnet XLM, transaction confirmation | Real |
| Freighter extension | Stubbed at its real `window.postMessage` protocol (`e2e/tests/helpers/freighter.ts`), backed by a throwaway funded testnet keypair |

Only the extension is replaced. The apps' own `wallet.ts` code paths
(`requestAccess`, `signTransaction`, `signAuthEntry`, timeouts, error
handling) run unmodified. That is the same mechanism the repository's
existing #198/#199 smoke tests use; these specs extend it to the four QA
flows.

Two QA hooks were added to the stub for these tests:

- **Rejection mode** — `setInjectedSigningRejected(page, true)` answers
  signing requests the way a real extension does when the user clicks
  reject: `apiError: { code: -4, message: "The user rejected this request." }`
  (the library's own `FreighterApiDeclinedError`). This exercises the
  reject → error banner → retry path, which is the part unit tests with a
  mocked wallet cannot reach.
- **Signing-request log** — `connectInjectedWallet` now returns the list
  of `SUBMIT_TRANSACTION` / `SUBMIT_AUTH_ENTRY` requests the page actually
  made. That lets a test prove an action opened no wallet popup at all.

Setup state that no single app screen can reach (a Locked commitment, a
pre-existing dispute) is built through the same real HTTP routes and
testnet transactions from Node (`e2e/tests/helpers/api.ts`). The action
under test always goes through the browser UI.

### 1.1 Key finding: "propose" does not open Freighter

Two of the four issues describe a **propose** step, and neither one signs
anything at that point:

- **#60** — `DisputeSection.handlePropose` only calls
  `proposeResolveDispute()`, a `POST /tx/resolve-dispute/propose`. The API
  simulates `resolve_dispute` and stages the *other two* parties' auth
  entries. The proposer's classic signature is only used at finalize.
- **#45** — `ReassignBuyerSection.handlePropose` only calls
  `proposeReassignBuyer()`, a `POST /tx/reassign-buyer/propose`. Same
  shape: the incoming buyer's and cooperative's auth entries are staged,
  and the outgoing buyer signs only when finalizing.

So there is no popup to review during propose, and a "reject" at that step
cannot happen. The tests assert this directly (zero signing requests),
then drive a real approval through the same UI — rejected once, then
accepted — because that is where `signAuthEntry` actually runs.

## 2. #54 — Record a member allocation ledger (coop-pwa)

**Flow:** `coop-pwa/src/components/AllocationLedgerSection.tsx` →
`buildSetAllocationTx` → `signTransactionXdr` → `submitTx` → live
`GET /commitments/:id/allocation` re-read.

**Preconditions:** commitment `Draft`, connected wallet is the
cooperative, no ledger recorded yet.

**Spec:** `e2e/tests/coop-pwa.spec.ts` → `#54 records a member allocation
ledger end to end`.

**What the test verifies**

1. Draft with no ledger shows the "Record member allocation" form to the
   cooperative.
2. Records two members (60% / 40%) after first declining the signature:
   the UI shows `The user rejected this request.`, the submit button
   re-enables, and `GET /allocation` still reports "not set" — nothing
   reached the chain.
3. On retry the UI re-reads the ledger from chain and renders two rows
   with truncated hashes and `60.00%` / `40.00%`.
4. Neither phone number appears anywhere in the rendered page, and the
   on-chain ledger contains only 32-byte hashes plus `share_bps` — the
   contract never stores a phone number.
5. Chain truth matches the UI (two members, shares `6000`/`4000`,
   commitment still `Draft`).

**What a real Freighter popup should show (expected, not observed here):**
transaction signing on **Test Net**; source/account = the cooperative;
contract `C…`; function `set_allocation(Vec<AllocationMember>)`, each
entry `{ member_hash: Bytes, share_bps: u32 }`; fee and memo empty. The
popup should contain no phone numbers — only hashes — which is worth
eyeballing in the extension to confirm the XDR matches this description.

## 3. #59 — Flag a dispute (coop-pwa)

**Flow:** `coop-pwa/src/components/DisputeSection.tsx` →
`buildFlagDisputeTx` → `signTransactionXdr` → `submitTx` →
`onDisputeChanged()` live re-read.

**Preconditions:** any disputable status (`Locked` through `Delivered`);
the connected wallet is one of the three named parties. The test uses
`Locked` and the cooperative.

**Spec:** `e2e/tests/coop-pwa.spec.ts` → `#59 flags a dispute end to end`.

**What the test verifies**

1. Badge reads `Locked`; "Flag a dispute" is offered.
2. Rejecting the signature shows the error banner, re-enables the button,
   and leaves the chain at `Locked`.
3. Retrying flips the UI badge to `Disputed` after the app re-reads the
   commitment, shows the frozen-state copy, and offers "Propose resolving
   this dispute".
4. Chain truth: `status = Disputed`, `dispute_pre_status = Locked`.

**What a real Freighter popup should show (expected):** transaction
signing on **Test Net**, source = the party flagging, function
`flag_dispute(flagger: Address)` where `flagger` equals the source, fee
and no other operations.

## 4. #60 — Propose resolving a dispute (coop-pwa)

**Flow:** `DisputeSection.handlePropose` → `proposeResolveDispute()`
**only** (no wallet call). The signing half of the flow is the approvals:
`signAuthEntry` for each non-proposer, then `signTransactionXdr` for the
proposer's finalize.

**Preconditions:** status `Disputed` (test sets it up via
`flag_dispute` as the warehouse operator). The cooperative proposes.

**Spec:** `e2e/tests/coop-pwa.spec.ts` → `#60 proposes resolving a
dispute end to end`.

**What the test verifies**

1. The disputed state offers "Propose resolving this dispute" to the
   cooperative.
2. Proposing shows "Resolution proposed — waiting for the other two
   parties to approve."
3. The proposal is `pending`, proposer = cooperative, and its two pending
   entries are the buyer and warehouse operator.
4. **No signing request was made** — proving there is no Freighter popup
   at the propose step.
5. Chain status remains `Disputed`.
6. The buyer's subsequent "Approve resolution" in a second page:
   rejecting first shows the declined error and leaves both entries
   pending; accepting signs the auth entry (`SUBMIT_AUTH_ENTRY` observed)
   and drops the pending list to the warehouse operator.
7. Status is still `Disputed` until the third party approves and the
   proposer finalizes (out of scope for this issue, covered by #61/#62).

**What a real Freighter popup should show (expected):**

- **Approve (buyer/warehouse):** an *Authorization Entry*, not a
  transaction — contract `C…`, function `resolve_dispute()`, the entry's
  valid-until ledger, signer = the approving party.
- **Finalize (proposer):** transaction signing on **Test Net**, source =
  the proposer, `resolve_dispute()`, carrying the other two parties'
  signed auth entries.

## 5. #45 — Propose reassigning the buyer position (buyer-app)

**Flow:** `buyer-app/src/components/ReassignBuyerSection.tsx` →
`proposeReassignBuyer()` **only** (no wallet call). Approvals use
`signAuthEntry`; the outgoing buyer finalizes with `signTransactionXdr`.

**Preconditions:** status `Draft` through `ReadyForDelivery`; protected
wallet is the *current* buyer (the API rejects any other proposer with
403). The test uses `Draft`, a fresh incoming-buyer keypair, and a random
warehouse operator address.

**Spec:** `e2e/tests/buyer-app.spec.ts` → `#45 proposes reassigning the
buyer position end to end`.

**What the test verifies**

1. The current buyer sees the "Reassign to a new buyer" form and submits
   the incoming buyer's address.
2. The UI shows "Reassignment proposed — waiting for the cooperative and
   the new buyer to approve."
3. The proposal is `pending`, proposer = current buyer, pending entries =
   cooperative + incoming buyer.
4. **No signing request was made** at propose.
5. Chain `buyer` is unchanged — the outgoing buyer keeps the position
   until finalization.
6. The incoming buyer's "Approve reassignment" in a second page:
   rejecting first shows the declined error and leaves both entries
   pending; accepting signs the auth entry (`SUBMIT_AUTH_ENTRY` observed)
   and leaves only the cooperative pending.
7. Chain `buyer` is still the outgoing buyer until the cooperative
   approves and the outgoing buyer finalizes (covered by #46/#47).

**What a real Freighter popup should show (expected):**

- **Approve (cooperative/incoming buyer):** an *Authorization Entry* for
  `reassign_buyer(new_buyer)` on contract `C…`, signer = the approver.
- **Finalize (outgoing buyer):** transaction signing with all three
  parties' auth entries present.

## 6. Cross-cutting observations (not fixed here)

These are notes from reading the four flows, not new issues filed; they
are out of scope for a QA-verification change and should get their own
issues if the maintainers want them fixed.

- **Error banners are not announced in two components.**
  `DisputeSection.tsx` and `ReassignBuyerSection.tsx` (both apps) render
  `<div className="error-banner">` without `role="alert"`, unlike
  `AllocationLedgerSection.tsx` and `CancelSection.tsx`. A rejected
  signature is therefore not announced to screen readers.
- **`PENDING` submits are typed as impossible on the client.**
  `POST /transactions/submit` can return `202 { status: "PENDING" }`, but
  both apps' `SubmitResult` only admits `SUCCESS | FAILED`. If that path
  occurs, the component treats it as success and immediately re-reads the
  chain before confirmation, briefly showing the pre-action state. Not
  observed on testnet at normal latency, but the type/code mismatch is
  real (`coop-pwa/src/api.ts`, `buyer-app/src/api.ts`).

## 7. Still needs a human with a real extension

Everything below genuinely requires the installed extension and is the
remaining gap the issues are about. Run these against a funded testnet
account, one flow at a time, and record: what the popup showed, how long
it took, what happened on reject, and whether the UI matched the chain
after confirmation.

- [ ] **#54:** confirm the popup's function/args show `set_allocation`
      with hashes only (no phone numbers), approve, and confirm the two
      ledger rows match the on-chain hashes/shares.
- [ ] **#59:** confirm `flag_dispute` shows the connected party as the
      flagger, reject once, then approve; confirm the badge flips to
      `Disputed` only after confirmation.
- [ ] **#60:** confirm proposing shows **no popup**; then approve as one
      of the other two parties and confirm the popup is an authorization
      entry (not a transaction); reject once first and confirm the UI
      error matches the extension's copy.
- [ ] **#45:** confirm proposing shows **no popup**; then approve as the
      incoming buyer (authorization entry), reject once first, and
      confirm the pending list updates without the page reloading.
- [ ] Check extension-specific edges the stub cannot model: locked
      wallet, wrong active account, network mismatch warning, and the
      popup's own copy/timeout behavior.

## 8. Running the automated coverage

```sh
# prerequisites: Postgres + API running, api/.env with DEPLOYER_SECRET_KEY
# and ESCROW_WASM_HASH, e2e deps + browsers installed (see e2e/README.md)
cd e2e
E2E_LIVE=1 npm test
```

Without `E2E_LIVE=1` all specs skip, including these four — the same
mode CI sees, since CI has no funded deployer key.

In this change, `npm run typecheck` and `npm test` (skip mode, 7 specs)
were run in `e2e/`; the live run was **not** executed in the sandbox
because it has no Postgres, deployer key, or contract WASM. No claim of a
live pass is made here.
