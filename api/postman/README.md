# Postman / Insomnia collection

[`harvestlock-api.postman_collection.json`](./harvestlock-api.postman_collection.json)
has a request for every route registered in [`../src/server.ts`](../src/server.ts),
including one request per method that the generic `POST /commitments/:contractId/tx/:method`
route accepts. It is a Postman v2.1 collection; Insomnia imports the same file
(**Import → From File**).

`test/postmanCollection.test.ts` checks the collection against `server.ts`, so
adding, removing or renaming a route without updating the collection fails
`npm test`. Request bodies follow the shapes documented in
[`../README.md`](../README.md) and [`../openapi.yaml`](../openapi.yaml); those
remain the reference for every field and response.

## Setup

1. Import the collection.
2. Edit the collection variables:
   - `baseUrl`: `http://localhost:3000` for a local API (see the Setup section
     in `../README.md`), or the deployed API's URL.
   - `buyer`, `cooperative`, `warehouse`: funded testnet G-addresses, one per
     party. `curl -s "https://friendbot.stellar.org/?addr=G..."` funds one.
   - `token`: the token (USDC) contract's C-address.
   - `newBuyer`: only needed for the reassign-buyer requests.

Every other variable is either filled in automatically by a request's test
script or pasted in by you, as described below.

## How a write works

Postman never holds a private key, the same as the API itself. Every write is
three steps:

1. Run a **Build … XDR** request. Its test script saves the unsigned envelope to
   `unsignedXdr`. Set `sourcePublicKey` in the body to the party who will sign.
2. Sign `unsignedXdr` with that party's own key, outside Postman: Freighter, or
   `stellar tx sign --network testnet --sign-with-key <identity>`.
3. Paste the signed envelope into `signedXdr` and run **Submit → Submit signed
   transaction**.

Built transactions are time-bounded (60 seconds, or 300 seconds for a finalized
proposal), so sign and submit promptly, or rebuild the XDR.

## Suggested order for a fresh commitment

1. **Health → Health check**
2. **Deploy and initialize → Deploy escrow instance** (saves `contractId`)
3. **Deploy and initialize → Build initialize XDR**, sign as the buyer, submit
4. **Lifecycle (no-argument methods) → Build lock XDR**, sign as the buyer, submit
5. **Reads → Get commitment (live)** to confirm the new status

## Staged multi-party calls

`cancel`, `reassign_buyer` and `resolve_dispute` need more than one party's
auth, so they use the staged flow in the **Staged multi-party signing** folder:

1. Run the matching **Propose** request (saves `proposalId`).
2. Each pending party signs its own `entry_xdr` from the proposal with its wallet
   (`signAuthEntry`, not `signTransaction`), pastes it into `signedEntryXdr`, sets
   `signerPublicKey`, and runs **Sign proposal entry**.
3. Once the matching **Get active … proposal** request shows `"status": "ready"`,
   the proposer signs `ready_xdr` and submits it with `completeProposalId` set to
   `{{proposalId}}` in the Submit body.

## Allocation ledger

**Build set-allocation XDR** saves the staged members to `stagedMembers` and the
first member's hash to `memberHash`. After signing, add
`"allocationContractId": "{{contractId}}"` and `"allocationMembers": <the staged
members array>` to the Submit body so the phone numbers are stored only once the
on-chain call is confirmed. **Erase allocation member** uses `memberHash`.
