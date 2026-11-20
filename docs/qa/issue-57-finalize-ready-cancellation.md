# QA write-up — issue #57: finalize a ready cancellation (`coop-pwa`)

> **Verification status:** code trace and automated checks completed; no real Freighter popup or testnet transaction was executed in this environment. The expected popup/chain values below are derived from the code and sequence documentation, and are explicitly not presented as observations.

## What I did

- Traced `handleFinalize` in `coop-pwa/src/components/CancelSection.tsx:97-109`: `signTransactionXdr(proposal.ready_xdr, walletAddress)` → `submitTx(signedXdr, contractId, proposal.id)` → `POST /transactions/submit` with `refreshContractId` and `completeProposalId`.
- Cross-checked the API rebuild/sign route (`api/docs/cancel-sequence.md:73-87`, `api/src/server.ts:1140`) and the contract effect (`api/docs/cancel-sequence.md:79-81`).
- Ran `coop-pwa` tests (127/127), typecheck (exit 0), lint (exit 0, 7 pre-existing warnings).

## What Freighter shows at each step

| Step | Wallet call | Expected Freighter UI | Observed here |
|---|---|---|---|
| Poll sees `status: "ready"` | none | no popup | code-verified only |
| Click "Finalize cancellation" | `signTransaction(xdr, { address, networkPassphrase })` | ordinary **Transaction Signing** dialog, network **Test Net**, origin `http://localhost:5173`, signer = proposer, `InvokeHostFunction` on the escrow contract calling `cancel()` with no arguments, two auth entries, base fee + Soroban resource fee | not exercised |
| Approve | none | popup closes, signed XDR returned, submit happens | not exercised |
| Reject | none | error banner, no submit call, proposal stays `ready` | mocked test only |

Unlike #56, this **must** be a full transaction signature: it supplies the proposer's `source_account` auth. A tester should verify the dialog is the transaction one and that the fee/resource line is shown.

## Does the UI match the real chain state?

This is the one step where chain state actually changes. Contract behaviour (`api/docs/cancel-sequence.md`):

- verifies `require_once_each(buyer, cooperative)`;
- requires status in `Draft`…`ReadyForDelivery` (`Delivered`/`Disputed` cannot be cancelled);
- sets `status := Cancelled` and emits `status_changed`;
- transfers the contract's remaining token balance to the buyer; already-claimed advances are not clawed back, and if nothing was locked no transfer occurs.

Expected UI reconciliation: `setProposal(null)` and `onCancelled()` → `App.tsx` reloads the commitment → status badge reads **Cancelled** and `CancelSection` unmounts, since `Cancelled` is not in `CANCELLABLE_STATUSES`. The API also marks the proposal `completed`, refreshes its cache, and updates the mirrored Postgres row on a best-effort basis after the transaction lands.

The tester should compare three sources: the submit response hash on testnet, `GET /commitments/:id` from the chain, and the rendered badge. They should agree.

## Rejection handling

The mocked component test covers the banner and callback behaviour. On a real popup, rejecting should leave the proposal `ready` so the user can retry — no submit call should be made.

## Checklist for the real run

- [ ] Transaction-signing popup with proposer signer, `cancel()`, two auth entries, visible fees.
- [ ] Submit returns `SUCCESS` with a hash that resolves on testnet.
- [ ] Chain status `Cancelled`; remaining escrow returned to buyer; `status_changed` emitted.
- [ ] UI badge `Cancelled`; `CancelSection` no longer rendered.
- [ ] Rejection leaves the proposal `ready` and shows the error banner.
