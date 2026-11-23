# Buyer Freighter workflows — issues #41–44

## Scope and environment

- #41 settles a Delivered commitment from buyer-app.
- #42 proposes a cancellation from buyer-app.
- #43 approves a cancellation proposed by the cooperative.
- #44 finalizes the ready cancellation and confirms the cancelled chain state.

The Playwright coverage uses the real browser app, local API, Soroban contract, and Stellar testnet. Its wallet stand-in speaks Freighter's postMessage protocol and signs with throwaway testnet keypairs. **A real Freighter extension and its popup were not used or observed.**

In this workspace, the buyer-app suite, production build, lint, and E2E TypeScript check passed. The live Playwright tests were not run here: they are skipped unless `E2E_LIVE=1` is set and the local API/Postgres/testnet prerequisites in `e2e/README.md` are available.

## What the regression coverage exercises

1. `buyer-app/src/App.test.tsx` verifies settlement builds the `settle` transaction from the connected third-party wallet, submits the signed envelope, refreshes the commitment, and displays `Settled`.
2. `buyer-app/src/components/CancelSection.test.tsx` verifies the proposal, approval, and final-submit request payloads, including the signed Soroban auth entry and `completeProposalId`.
3. `e2e/tests/buyer-app.spec.ts` drives the same flows through the browser against the real API and testnet:
   - #41 prepares a Delivered commitment, settles it through buyer-app as an unrelated signer, then checks the chain status.
   - #42 proposes a cancellation and verifies that proposing does not open a signing request.
   - #43/#44 have the cooperative propose, the buyer reject and then approve its auth-entry request, and the cooperative finalize using the freshly rebuilt ready XDR. The test checks the UI and chain both report `Cancelled`.
4. `e2e/tests/helpers/api.ts` prepares delivery state and reads cancellation proposal state using real API routes.

## Expected wallet interactions (not observed in a real extension)

- #41: one transaction-signing request for `settle`.
- #42: no wallet request; the API stages the cooperative's pending auth entry.
- #43: the buyer receives an auth-entry signing request; rejection leaves the proposal pending, and approval makes it ready.
- #44: the cooperative receives a transaction-signing request for the refreshed ready envelope; successful submission transitions the commitment to `Cancelled`.

## Remaining manual check

Install Freighter in a normal browser, fund testnet accounts for the required parties, repeat each flow, and record the actual popup contents, rejection behavior, click-to-popup timing, transaction identifiers, and UI-vs-chain state. The automated tests verify application/API/contract wiring but do not close that real-extension verification gap.
