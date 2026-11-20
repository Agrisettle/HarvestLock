# Voucher issuance / redemption — design options

**Status:** design investigation for #185. Nothing here is built. This document exists so the first person to implement vouchers starts from a checked analysis instead of a guess.
**Date:** 2026-10-18
**Follow-up:** [`voucher-proposal.md`](./voucher-proposal.md) (#6) turns the recommendation below into a concrete proposal — issuance trigger, redemption confirmer, allocation-ledger fit, and pilot-metric definitions.
**Scope:** how a voucher — a claimable, transferable entitlement distinct from the direct-payout model this contract uses today — can layer onto the existing escrow **without changing `lib.rs`'s core state machine**. Approaches, trade-offs, and a recommendation. No implementation, no schema, no routes committed here.

## 1. Why vouchers were in scope at all

Three separate places in the PRD name vouchers, and they are not the same ask:

1. **Feature list (PRD §7, "Must have"):** *"Voucher issuance and redemption tracking."* Note the word **tracking**. The must-have is an ability to record who is owed what input credit and whether it was redeemed — not an on-chain bearer instrument.
2. **Advance tranches (PRD §4.8):** tranche 1 is *"Claimable balance to the cooperative wallet… Voucher-preferred."* §7's edge-case table gives the reason: *"Lead absconds with advance — Mitigated by voucher-first, two-signer wallet, tranching."*
3. **API ownership (PRD §17.2):** the API is listed as owning `contracts · allocation · vouchers · attestation intake`. `api/README.md` line 6 repeats it; `api/HANDOFF.md`'s "What's deliberately deferred" and `api/README.md`'s "What's not built yet" both say nothing exists.

Open Question 08 in the PRD is the gate on all of this: *"Is there a vetted input supplier who will accept vouchers, or does v1 default to capped cash?"* **That question is still open.** A voucher mechanism with no accepting supplier is dead code — the recommendation in §9 is ordered around that fact.

## 2. What "voucher" has to mean to fit this product

A voucher here is an entitlement, issued out of an advance tranche, that:

- is **denominated in the escrow's settlement token** (the same `token` the commitment was initialized with — PRD §4.2's NGN-unit/stablecoin-rail model doesn't change);
- is **redeemable at vetted input suppliers** for farm inputs, not cash (that is what keeps it a mitigation against the "lead absconds" case and keeps HarvestLock out of the lending/money-transmission question the PRD is careful about);
- should be **transferable** at least to the extent a member can nominate who redeems it, and ideally between members; and
- must **expire** on the same clock as the on-chain claim window, because the funds backing it disappear back to the buyer when `reclaim_advance_1/2` runs.

Two facts about the current implementation constrain every design below:

- **The advance is claimed to a party's wallet, not to a program.** `claim_advance_1/2` is cooperative-gated and pays the cooperative; `reclaim_advance_1/2` is buyer-gated and returns the funds once `claimWindowSecs` lapses. The escrow has no "pay this other address instead" parameter and no voucher concept.
- **The API never holds a party's key** (`api/README.md`, "the API never holds a party's private key"). Any design where HarvestLock itself holds or moves the funds contradicts the one architecture principle the regulatory posture leans on hardest (PRD §4.5: "HarvestLock holds no keys to escrowed funds").

## 3. The honest limit of every layered design

Because `lib.rs` cannot change, the escrow will always have paid the advance to the cooperative's own wallet before any voucher layer sees it. **No layered design can programmatically prevent a cooperative that has claimed the advance from simply keeping it.** What a voucher layer can add is:

- a recorded, member-visible entitlement with a deadline;
- a redemption path that pays a supplier without the cooperative needing to be present (depending on the approach);
- an audit trail tying issuance to redemption; and
- social/operational pressure: a cooperative that claims and does not redeem has left a visible, expiring obligation on record.

Hard prevention requires changing what `claim_advance_*` pays *to* (an escrow-layer change; see Option 4). That is named below only so the difference is not discovered later by someone assuming a layered voucher is stronger than it is. The issue's constraint — no `lib.rs` state-machine change — puts Option 4 out of scope for any near-term build.

## 4. Option 1 — API-layer voucher registry (off-chain, record-only)

The smallest thing that satisfies the literal PRD must-have ("tracking"). Vouchers exist only in the API's Postgres, alongside the allocation ledger's off-chain identity map.

**Mechanics**

- On observing a fresh transition into `Advance1Released`/`Advance2Released` — the same observation-triggered point `applyReputationConsequences` already uses (idempotency via a UNIQUE constraint, as `standing_events` does — **not** a `previousStatus` comparison, which `api/src/reputation.ts` documents as wrong in both directions) — the API issues one voucher record per allocation member, sized by the member's on-chain share (`allocation_members` / `get_allocation`), or one tranche-sized voucher for the cooperative when no allocation exists. Issuance must be idempotent: cache refreshes can re-observe a status many times.
- New tables, mirroring the `party_standing` / `standing_events` audit-log pattern: `vouchers` (contract, tranche, member hash where applicable, amount, status `issued|redeemed|expired|void`, issued at, expires at, redemption code hash, supplier, redeemed at, tx reference) and `voucher_events` (append-only). A small `input_suppliers` registry (name, payout address/bank details, KYC state) is the allow-list.
- Redemption: the supplier (or a coop officer on the supplier's behalf) presents a one-time code; the API checks status/expiry, marks the row redeemed in one transaction (`UPDATE … WHERE status='issued'` — the same `SELECT … FOR UPDATE` shape that makes reputation idempotent), records the event, and **records or initiates payment**. With no auth/session model yet (`api/HANDOFF.md`), the code *is* the authentication, so codes are long, single-use, hashed at rest, and rate-limited like any other route.
- Payment itself has two sub-modes, and the difference matters:
  - **1a — tracked promise:** the cooperative pays the supplier itself; the API only records it. Trivial, but adds no redemption autonomy.
  - **1b — staged payout:** at redemption the API builds a token-payment transaction from the cooperative to the supplier for the cooperative to sign — reusing the same build-unsigned/client-signs/submit model as `buildInvokeTransaction`, or SDP for fiat/bank payout. The cooperative is still on the hook to sign, but the paperwork, amount, and deadline are done for them.
- Expiry: voucher expiry is derived from `claimWindowSecs` and voided the moment the API observes `reclaim_advance_1/2` (the on-chain reclaim). A voucher can never outlive its backing. A stale voucher row is a cache-staleness instance, the same accepted caveat as `GET /commitments` — but a wrongly-honoured voucher would be a real money bug, so redemption must re-read the chain for that contract before paying, not trust the cache.
- Transferability: in this option, a voucher is not a bearer instrument. The strongest version is a signed reassignment (`POST .../vouchers/:id/reassign` with the current holder's Stellar signature over the voucher ID, verified server-side) — verifiable but API-mediated, and pointless offline.

**Trade-offs**

| For | Against |
|---|---|
| Zero contract changes; zero new audit surface; smallest build | Entitlement has no on-chain representation at all — DB loss loses the ledger (the escrowed state is unaffected) |
| Reuses Postgres, Termii SMS codes, the allocation ledger's phone-number model and NDPA erasure story | Double-redemption and expiry are DB invariants, not chain finality; the API operator is trusted |
| Works for suppliers with no wallet (1a/SDP bank payout) and for the SMS-only farmer channel (PRD §17) | Not third-party verifiable; a supplier can't check a voucher without this API |
| Matches the "record-only in v1" precedent the allocation ledger already set | Weakest anti-abscond mitigation of the four options — it makes misappropriation visible, not impossible |

**Regulatory note (flag to counsel, not a conclusion):** a closed-loop voucher redeemable only for inputs at registered suppliers, expiring, non-cash, and non-P2P-transferable is the cleanest version to argue as not stored value / not e-money. Any move toward cash-out or open transfer moves it the other way.

## 5. Option 2 — pre-signed, time-bounded disbursement orders ("signed voucher cheque")

No new contract and no custody: a voucher is a **pre-signed Stellar transaction** the cooperative produces once, which anyone (a supplier) can submit at redemption.

**Mechanics**

- At issuance the API builds a token-payment transaction: source = a dedicated cooperative-controlled voucher account (or the cooperative's wallet), destination = the registered supplier, amount = voucher value, `timeBounds` = voucher expiry, sequenced for one-time use. The cooperative signs it once; the signed envelope (or its hash) is the voucher record. The API stores it in the same `vouchers` row shape as Option 1; the supplier gets an SMS code mapped to it.
- Redemption = code → API returns the signed envelope → supplier (or the API on the supplier's behalf) submits it to the network. Stellar's sequence-number rules make a second submission invalid; `timeBounds` makes it expire; low fees can be solved with a fee-bump transaction (HarvestLock as fee source spends only XLM, never escrow funds, and the inner signature survives the bump).
- Issuance and redemption are on-chain-verifiable without any new code deployed — the Stellar network is the enforcement layer.
- The API can optionally be the submitter of last resort on redemption, but it never needs to hold a key to do so.

**Trade-offs**

| For | Against |
|---|---|
| No new contract, no new audit surface; genuinely non-custodial | Pre-signed transactions are unforgeable and **unrevocable** — if a code leaks, only the sequence/time bound limits the damage |
| Double-redemption prevented by core Stellar semantics, not a DB flag | One destination per order: P2P transferability means re-issuing (and invalidating the old order by consuming its sequence), i.e. the cooperative must sign again |
| Expiry is native (`timeBounds`), no API clock to trust | Sequence management is real operational sharpness: any later transaction from the same source account can invalidate every outstanding pre-signed order. Needs a dedicated voucher account per tranche or per issuance |
| Supplier can redeem without the cooperative being online (submission is permissionless) | Wallet/UX support for holding and submitting a pre-signed envelope is not something a rural supplier will do unaided; realistically the API submits it, which softens the "no custody" story only slightly but fully removes supplier-side key handling |
| Smallest *non-custodial* autonomous-redemption option | Partial redemption is impossible without splitting into multiple pre-signed orders up front |

This option is the best answer to "suppliers want programmatic redemption and there is no budget for a second contract." It is worse than Option 3 at transferability and partial redemption, and worse than Option 1 at operational simplicity.

## 6. Option 3 — dedicated Soroban voucher contract (on-chain entitlement)

A separately deployed voucher contract; the escrow is untouched. The cooperative claims the advance as today, then funds the voucher contract; the contract issues entitlements (non-transferable claims) or SEP-41-style tokens (bearer, transferable).

**Mechanics**

- `issue(issuer = cooperative, token, amount, expiry, supplier_allowlist?)` — the cooperative moves the claimed tokens into the voucher contract and mints against them. Can be one bulk issuance for the cooperative or one per allocation member (batched in a single invocation to keep fees sane for 200 members — note PRD §4.3 explicitly prices the 200-payment split via SDP; on-chain per-member vouchers are a different cost class).
- `redeem(holder, supplier, amount)` — burns/claims and transfers the backing token to a registered supplier. Requires the supplier's auth or an allow-list, and optionally a HarvestLock-issued attestation, depending on how much control is wanted.
- `transfer(from, to, amount)` — real bearer transferability if the entitlement is token-shaped; omitted by design if not.
- `expire` — permissionless after the deadline; unspent backing returns to the issuer (or a configured refund address).
- No escrow status or method changes anywhere: the voucher contract's lifecycle hangs off the cooperative's wallet balance, and its expiry is set ≤ the escrow's remaining claim window by the issuing frontend.

**Trade-offs**

| For | Against |
|---|---|
| Only option with real, on-chain transferability and partial redemption | New contract → new deploy flow, new tests, and a second audit before mainnet money. It would also need its own audit budget, which PRD §17's current plan does not include |
| Third-party verifiable; supplier integration is wallet-native, no API trust | The cooperative must still claim and then fund it — a determined defaulter is not stopped, just documented more expensively |
| Atomic redemption and expiry; no API key, no DB-as-truth | Requires suppliers (or their wallets) to exist on Soroban; PRD OQ 08 is unanswered and the answer is probably "not yet" |
| Fits the existing deploy-per-commitment pattern; a single shared contract with per-commitment balances avoids one deploy per commitment | Per-member split for 200 members is either 200 objects or a real batching/settlement design; bearer tokens also carry the heaviest regulatory framing of the three options |

*Sub-variant worth naming but not recommending:* make the **voucher contract the cooperative party** at `initialize` (a C-address), so advance claims land in the voucher contract directly and hard-prevent misappropriation. This requires `initialize` to accept C-addresses, every cooperative-gated escrow method to be invoked through the voucher contract, and the multi-party signing machinery to mediate contract auth — an architectural change far larger than "layering," and still a `lib.rs`-adjacent change. Out of scope.

## 7. Option 4 — escrow-native voucher destination (out of scope; named for completeness)

Add a voucher destination to the advance release in `lib.rs`, so `claim_advance_*`/a new release path pays the voucher contract (or a registered supplier) instead of the cooperative. This is the only approach that **hard-prevents** the claim-and-abscond case, and it is the literal "voucher-first" reading of the PRD. It is excluded here by the issue's own constraint: it changes the contract's release semantics (though arguably not its status machine — statuses and transitions could stay identical). Cost: contract change, new deployment/hash, API `initialize`/build-path changes, and the contracts repo's own audit/verification cycle. Decision belongs to a contracts-repo issue, not this one.

## 8. Comparison

| | Option 1 — API registry | Option 2 — pre-signed orders | Option 3 — voucher contract | Option 4 — escrow-native |
|---|---|---|---|---|
| Contract change | none | none | new contract | `lib.rs` release change |
| Who holds the money | cooperative's wallet | cooperative's voucher account | voucher contract | voucher contract / supplier |
| Redemption needs coop online | 1a: no (record) / 1b: yes (signs) | no (submit is permissionless) | no | no |
| Double-redemption guard | DB invariant | Stellar sequence | contract state | contract state |
| Expiry guard | API clock + chain re-read at redemption | `timeBounds` | contract deadline | contract deadline |
| Transferable | API-mediated, signed | no (re-issue required) | yes (if token-shaped) | yes (if token-shaped) |
| Partial redemption | yes | no | yes | yes |
| Supplier needs a wallet | no (SDP/bank possible) | to self-submit; else API | yes | yes |
| Third-party verifiable | no | via network | yes | yes |
| New audit surface | none | none | yes (second contract) | yes (escrow re-audit) |
| Hard-prevents absconding | no | no | no | **yes** |
| Build size | smallest | small | large | contract-cycle |

## 9. Recommendation

1. **Do not start with Option 3 or 4.** Option 3's prerequisites are unmet (OQ 08 — no confirmed supplier accepting on-chain vouchers; no budget named for a second contract audit), and Option 4 is deliberately out of scope for a layered design.
2. **Pilot answer: Option 1, exactly scoped to closed-loop input vouchers.** The PRD must-have is *tracking*; Option 1 delivers issuance, redemption, expiry, member-level split via the existing allocation ledger, SMS delivery via the existing channel, NDPA-consistent handling of phone numbers, and an audit trail — with no new contract. Start with **1b (staged payout)** rather than 1a, so redemption actually moves funds with the cooperative signing once, not twice. Keep it closed-loop: no cash-out, no open P2P transfer in v1 (reassignment only, signed, audited).
3. **Build it only after OQ 08 has a yes.** The implementation order is: confirm the supplier → agree redemption mechanics and payout rail (SDP/bank vs wallet) → voucher schema + issuance hook at the `previousStatus` orchestration point → redemption route → SMS. If the answer to OQ 08 is "no supplier yet," the correct v1 is PRD's own stated fallback: capped cash advances, and this document stays a document.
4. **Option 2 is the upgrade path** if a supplier requires autonomous, coop-offline redemption before a contract budget exists. It is a small addition on top of Option 1's data model (the `vouchers` row gains a signed envelope instead of a code).
5. **Option 3 becomes worth revisiting** only when all three of these are true: a supplier accepts on-chain redemption; transferability/partial redemption is an actual demand, not a hypothetical; and a second contract's audit is funded. None are true today.

## 10. Open questions carried forward

- OQ 08 (blocking): is there a vetted supplier who will accept vouchers? Everything above is sequenced after this.
- Do vouchers attach to the **cooperative** (one bulk input credit) or to **members** (per-member entitlements sized by the allocation ledger)? The PRD's anti-abscond rationale favors members; the v1 allocation ledger is record-only, and splitting 200 members is the expensive case for Options 2/3 but cheap for Option 1.
- Redemption authentication with no auth/session model: code-based (Option 1) vs signature-based (Options 2/3). Code-based needs rate limiting and hashing discipline; signature-based needs supplier onboarding/KYB.
- Regulatory read on transferability: closed-loop, non-transferable is materially easier to defend than a bearer token (flag to Nigerian counsel alongside PRD §4.5's existing questions).
- Reconciliation with `settle`: PRD says settlement pays the cooperative wallet and the allocation ledger is record-only in v1. Vouchers must not be allowed to change `settle`'s behavior or the escrow's ability to settle; they are an overlay on the advance, not a second payout path.

## References

- `docs/PRD.md` §4.2 (denomination), §4.5 (custody/regulatory posture), §4.8 (contract design, advance tranches), §4.9 (staged disbursement), §7 (feature list, edge cases), §17 (stack, ownership), Open Question 08.
- `api/HANDOFF.md` — "What's deliberately deferred" (voucher item, line 33), "Design decisions and why" (build-unsigned/client-signs/submit; no custodial signing).
- `api/README.md` — API architecture (never holds a party's key), allocation ledger (per-member salted hashes, NDPA erasure), "What's not built yet" (voucher/SDP).
- `ROADMAP.md` Week 3–4 — the implemented claim/reclaim window that a voucher's expiry must mirror.
- `api/src/reputation.ts` — `applyReputationConsequences`, the existing observation-triggered hook any issuance trigger should sit beside (idempotent via UNIQUE constraint, not `previousStatus`).
