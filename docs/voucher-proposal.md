# Voucher issuance and redemption tracking — proposal

**Status:** proposal for #6, for discussion before any code. Nothing here is built.
**Date:** 2026-11-20
**Builds on:** [`voucher-design-options.md`](./voucher-design-options.md) (the #185 spike), which compares four mechanisms in depth and recommends an off-chain API registry. This document does not repeat that comparison. It answers the questions #6 asks — what a voucher is, who issues and redeems it, how it relates to the allocation ledger, who confirms redemption, and how the pilot metric is measured — and turns the spike's recommendation into a concrete, buildable shape.

---

## 0. TL;DR

| Question (#6) | Proposed answer |
|---|---|
| What is a voucher, technically? | An **off-chain, closed-loop input credit** recorded in the API's Postgres, worth a fixed amount of the commitment's settlement token, redeemable only for farm inputs at a registered supplier, through a single-use code sent by SMS. It is **not** an on-chain asset. The funds behind it are the advance tranche the cooperative has already claimed. |
| When is it issued? | When a **tranche advance is claimed** (`advance1_claimed` / `advance2_claimed` becomes true), not at settlement. That is where the PRD puts vouchers (§4.8 "Voucher-preferred", OQ 08 "vouchers or capped cash"). |
| Who issues it? | The cooperative chooses the voucher/cash split. The API issues the voucher records automatically when it sees the claim on chain. HarvestLock never holds or moves the money. |
| Per member or per cooperative? | **Per member** when an allocation ledger exists (each member's voucher is sized by their `share_bps`). If there is no ledger, one cooperative-level voucher. |
| Who redeems it? | The **member** presents the code at a **registered input supplier**. |
| Who confirms redemption? | **The supplier**, through a minimal supplier-facing surface. The redemption counts as complete only when the cooperative-signed payment to the supplier lands on chain, and the member gets an SMS receipt. The warehouse operator does not confirm redemptions, and neither does the cooperative on its own (§5 explains why). |
| Pilot metric | **Split** = voucher value issued ÷ advance value claimed. **Redemption rate** = redeemed value ÷ value of vouchers that have reached the end of their life. Both come straight from the voucher tables (§7). |
| Settlement-time vouchers? | **Not in v1.** At Rung 1, settlement pays the cooperative wallet as one lump sum. Revisit together with SDP (#4) when Rung 2 direct payouts exist (§8). |
| Gate | PRD **Open Question 08**: is there a vetted supplier who will accept vouchers? Without one, v1 uses the PRD's own fallback, capped cash. |

---

## 1. A framing correction: vouchers attach to the advance, not to settlement

Issue #6 describes vouchers as "an alternative to cash for farmer-level payouts, alongside the SDP-based cash disbursement path." The PRD places them elsewhere, and the difference changes the design:

- **Goals, v1:** *"Capped, tranched pre-harvest advance, **preferentially as input vouchers**."*
- **§4.8 Release events:** Advance tranche 1 is *"Claimable balance to the cooperative wallet … **Voucher-preferred.**"* Tranche 2 is *"Same mechanism."* Settlement (event 3) says nothing about vouchers.
- **Edge cases:** *"Lead absconds with advance — Mitigated by **voucher-first**, two-signer wallet, tranching."*
- **Open Question 08:** *"Is there a vetted input supplier who will accept vouchers, or does v1 default to **capped cash**?"* The "cash" in the success metric "Voucher versus cash split" is this capped **cash advance**. It is not the SDP settlement payout.
- **Users table:** the input supplier's only role is *"Voucher redemption."*

The reasoning holds together. Before harvest, a farmer needs **inputs** (seed, fertiliser, crop protection). An advance paid as input credit cannot be diverted into cash as easily, which is the anti-abscond argument. It also keeps the advance looking like a purchase of inputs rather than a loan (PRD §4.5, OQ 04(b)). After settlement the harvest has been sold and the farmer is owed money. Paying that in vouchers would be a much harder product and regulatory sell, and at Rung 1 HarvestLock has no member-level settlement flow to attach a voucher to.

**This proposal follows the PRD.** Settlement-time vouchers are covered in §8 as a later option. If maintainers actually intend the #6 framing (a choice at payout time), §8 says what changes. Most of the data model carries over.

---

## 2. What a voucher is, technically

A voucher is a row in Postgres. It records that **a named entitlement holder is owed `amount` of the commitment's settlement token, spendable only on inputs at a registered supplier, until `expires_at`**.

Properties:

- **Denomination:** the escrow's `token`, in its smallest units (the same `bigint`-as-string convention the API already uses for `total_amount`). There is no new unit and no FX conversion at redemption.
- **Backing:** the advance tranche the cooperative has **already claimed** into its own wallet. Vouchers are issued only after the claim is observed (§3), so they never promise funds that the buyer could still reclaim. Once `advanceN_claimed` is true, `reclaim_advance_N` is no longer possible, so the voucher cannot outlive its backing for that reason. (This is simpler than the spike's §4 "void on reclaim". That rule is only needed if vouchers are issued before the claim, and this proposal does not do that.)
- **Closed-loop:** redeemable only at an `input_suppliers` row with `status = 'active'`. No cash-out, no transfer between members in v1. A member can **nominate** someone to redeem on their behalf only by having the cooperative reissue the voucher (audited). This is the cleanest regulatory shape (spike §4 regulatory note) and should be confirmed with counsel alongside OQ 04.
- **Single-use code:** a random code of at least 10 characters (alphanumeric, without the ambiguous characters O/0, I/1) sent to the member's phone. Only an **HMAC of the code** is stored, the same as how member phone numbers are hashed for the chain. The code is the bearer secret, so the redeem route is rate-limited and locks a code out after N failed attempts.
- **Partial redemption:** allowed. One voucher can be redeemed against several supplier invoices until the full amount is used. Each redemption is its own `voucher_redemptions` row. Farmers buy inputs in more than one trip.
- **Not on chain.** The on-chain parts are the escrow's existing advance claim and the payment to the supplier at redemption. Both are ordinary transactions that anyone can verify. The voucher itself, the record linking the two, lives off chain. The spike's Options 2/3 (pre-signed payments, a voucher contract) remain upgrade paths. Neither is needed to measure the pilot metric.

---

## 3. Who issues it, and when

### 3.1 The cooperative elects the split

The PRD says "voucher-preferred," not "voucher-only," and OQ 08 makes cash the fallback. So the split is a **choice**, and the cooperative records it:

- For each commitment and tranche, the cooperative records a **voucher election**: either one percentage for the whole tranche, or (if an allocation ledger exists) a voucher/cash choice for each member, entered on the member's behalf. Members have no app and, in v1, no wallet.
- **The default is 100% voucher** ("voucher-preferred").
- **Cash is capped.** A per-commitment `max_cash_bps` limits how much of each tranche can be elected as cash. The cap value belongs to OQ 03 (advance cap), not to this document. The API enforces it on the election, not on chain.
- The election can be recorded or changed any time **before the claim is observed**. Once vouchers have been issued, it is frozen. If the cooperative claims without having recorded an election, the default applies.
- This happens in **`coop-pwa`**, next to the existing "claim advance" action. It is an API write and does not need a cooperative signature on chain. Until #5 settles phone-based auth, it is authenticated the same way the other `coop-pwa` writes are: a signed message from the cooperative's connected wallet. The API checks that the signer is the commitment's `cooperative`.

### 3.2 The API issues on the observed claim

- **Trigger:** the API observes `advance1_claimed` (or `advance2_claimed`) as `true` on a commitment read. This is observation-triggered, the same model as `applyReputationConsequences` and with the same staleness caveat: if nobody reads the contract, nothing is issued until someone does. `POST /transactions/submit?refreshContractId` after a claim makes this immediate in normal use.
- **Idempotency:** a UNIQUE constraint on `(contract_id, tranche, holder_key)`, inserted with `ON CONFLICT DO NOTHING`. **Do not compare against `previousStatus`.** The spike suggested that, but `api/src/reputation.ts` explains why it is wrong in both directions: concurrent first reads can double-issue, and a failed write is never retried. The `standing_events` UNIQUE-constraint pattern is the one to copy.
- **Amount:** `tranche_amount = total_amount × advanceN_bps / 10_000`, then:
  - with an allocation: for each member, `tranche_amount × share_bps / 10_000 × member_voucher_fraction`
  - without one: `tranche_amount × voucher_bps / 10_000`, a single voucher held by the cooperative
  - Rounding remainders go to the cooperative-level row, so the voucher total never exceeds the claimed amount.
- **Delivery:** one SMS per member with the code, the amount, the expiry, and the supplier's name and location. **No SMS provider is integrated in this repo today.** That is a hard dependency, shared with the "SMS notification" must-have. Until one exists, `coop-pwa` can show the cooperative the codes once, to hand out in person. That is weaker, because the cooperative sees members' codes, and should be marked as a stand-in.
- **Cash portion:** recorded too (`advance_cash_records`, or a `kind = 'cash'` row) so the split can be measured. Nothing is issued for it. The cash is already in the cooperative's wallet.

### 3.3 Expiry

The PRD calls the advance non-recoverable, and once it is claimed the escrow has no way to take it back. So expiry is a **policy deadline**, not a chain constraint:

- Proposed default: `expires_at = delivery_deadline`. Inputs bought after the delivery deadline cannot help that season's crop.
- On expiry, unredeemed value **stays in the cooperative's wallet**, because that is where it already is. The voucher moves to `expired` and keeps its unredeemed balance on record. **That record is the anti-abscond signal:** a cooperative that claimed a voucher-elected advance and never redeemed it leaves a visible, member-attributable gap. HarvestLock can surface it, feed it into the cooperative's standing (as `standing_events` already does for forfeiture), and act on it at the next season's re-verification. This is as far as a layered design can go. The spike's §3 explains why only an escrow change (Option 4) could actually prevent it.
- A later `Cancelled` / `Defaulted` / `Disputed` status **does not void** issued vouchers. The advance was non-recoverable and was already claimed.

---

## 4. How this relates to the allocation ledger (#2)

There is less to design here than #2 suggests, because the allocation ledger is **already built, including the UI**. Issue #2 says no frontend exists, but `coop-pwa/src/components/AllocationLedgerSection.tsx` has been in place since 4 Oct 2026 (`api/HANDOFF.md`, Next steps item 9, struck through as done). **#2 looks stale and could probably be closed or re-scoped.** Maintainers should confirm.

What vouchers need from the ledger, all of it already present:

| Need | Where it comes from |
|---|---|
| The member list and shares | `get_allocation` on chain (source of truth) and `allocation_members.share_bps` |
| A stable identity to attach a voucher to | `allocation_members.member_hash` (the voucher's `holder_key`). The voucher row **never stores a phone number.** |
| A phone number to send the code to | `allocation_members.phone_number`, read once at issuance and never copied |
| Guarantee it exists before vouchers do | `set_allocation` only works in `Draft`, before `lock`. Any allocation is final before `Advance1Released`, so the issuer never races it. |

NDPA s.34 erasure (`DELETE /allocation-members/:memberHash`) continues to work. The voucher row references `member_hash` and amounts only, so erasing the phone number unlinks the voucher from the person exactly as it unlinks the on-chain entry. An erased member's **outstanding** voucher stays redeemable by code. The code was already delivered, and the person still holds the entitlement. The SMS receipt (§5) is skipped, because there is no phone number to send it to.

There is no ledger change, no contract change, and no reason to delay #2 (or reopen it) for vouchers.

---

## 5. Who confirms redemption

#6 asks whether redemption needs a merchant-facing surface or whether the cooperative or warehouse operator confirms it. Each candidate:

| Confirmer | Verdict | Why |
|---|---|---|
| **Warehouse operator** | **No** | The operator is the *independent attesting counterparty* whose neutrality the whole architecture depends on (PRD §4.1, OQ 01 [BLOCKING]). Making it confirm input purchases gives it a stake in a flow it does not witness. Inputs are bought at a supplier's shop, not delivered into the warehouse, and it would add work for the one partner the pilot cannot afford to lose. |
| **Cooperative alone** | **No** | The voucher exists to protect against the cooperative absconding with the advance. A cooperative confirming its own redemptions makes the record meaningless. |
| **Member alone** | No (as the only confirmer) | The member has no app or wallet in v1. A member's SMS reply is useful as a cross-check, not as the record. |
| **Supplier** | **Yes, as the primary confirmer** | The supplier is the party that hands over goods, is "vetted, contracted" (PRD Users table), and gets paid. Its claim is checked by the payment landing on chain and by the member's receipt. |

**Proposed redemption flow, v1 (spike Option 1b):**

1. **Verify.** The supplier enters the member's code and the invoice amount. The API checks the code's HMAC, the status (`issued` / `partially_redeemed`), the remaining balance, `expires_at`, and that the supplier is `active`. It **re-reads the commitment from chain** before going further, because a wrongly honoured voucher is a real money bug and the cache can be stale.
2. **Hold.** The API reserves the amount (`voucher_redemptions.status = 'pending_payment'`, decremented under `SELECT … FOR UPDATE`) so the same balance cannot be spent twice at the same time.
3. **Pay.** The API builds an **unsigned** token payment, cooperative wallet → supplier's registered address, for the redemption amount, and makes it available to the cooperative in `coop-pwa` (a "voucher payments to sign" list). The cooperative signs it using the same build → sign → submit flow every other write uses. HarvestLock never holds a key. The PRD's two-signer cooperative wallet (#3) is the second factor here.
4. **Release goods.** The supplier releases the goods once the payment shows as confirmed on its view. `POST /transactions/submit` with a new `voucherRedemptionId` side effect marks the redemption `paid`. This side effect is stored in `pending_submissions` so a slow transaction still completes, matching the #405 pattern.
5. **Receipt.** The member gets an SMS: "₦X of inputs redeemed at Supplier Y, balance ₦Z." A member who did not make that purchase has a channel to object. Objections become disputes recorded against the voucher, not against the escrow.
6. **Unsigned payments time out.** If the cooperative has not signed after N hours, the hold is released and the redemption is marked `abandoned`. Repeated abandonment is itself a recorded signal, like an expired voucher.

**The known weakness, stated plainly:** step 3 needs the cooperative to be reachable at the moment of redemption. If OQ 08's supplier will not accept that, there are two upgrades, both on the same tables:

- **Batched settlement.** The supplier extends trade credit and the cooperative signs one combined payment per day or week. This is a commercial choice the supplier makes. It does not change the design.
- **Spike Option 2 (pre-signed payments).** The cooperative signs time-bounded payment envelopes at issuance, and the supplier (or the API) submits them at redemption without the cooperative. This adds sequence-number management. Worth it only if a supplier asks for it.

**Supplier surface:** v1 has one supplier (pilot scope), so this is **one small page, not a fourth app**: code + amount → verify → wait for payment → done, plus a list of the supplier's own redemptions. It can live in `coop-pwa` behind a supplier role, or as a standalone static page against the API. Maintainers should pick whichever has less overhead. The supplier authenticates as the other parties do today, with a signed message from the Stellar address in its `input_suppliers` row. Suppliers are institutional and KYB-checked, so they can reasonably hold a wallet. Phone-based supplier auth follows whatever #5 decides.

**Supplier onboarding** (`input_suppliers` rows) is a HarvestLock operator action through an admin-only route. This mirrors the PRD's "vetted, contracted": a supplier is added after a contract is signed, not through self-signup.

---

## 6. Data model and API sketch

This is a starting point for review, not a final schema. It follows the patterns already in `api/src/db/` (append-only event logs, UNIQUE-constraint idempotency, no phone numbers outside `allocation_members`).

```sql
-- 008_vouchers.sql (sketch)

CREATE TABLE input_suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  stellar_address TEXT NOT NULL UNIQUE,        -- payout destination + auth identity
  location        TEXT,
  status          TEXT NOT NULL CHECK (status IN ('active','suspended')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE voucher_elections (               -- the cooperative's split choice
  contract_id     TEXT NOT NULL,
  tranche         SMALLINT NOT NULL CHECK (tranche IN (1,2)),
  holder_key      TEXT NOT NULL,               -- member_hash, or 'coop'
  voucher_bps     INTEGER NOT NULL CHECK (voucher_bps BETWEEN 0 AND 10000),
  supplier_id     UUID REFERENCES input_suppliers(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  frozen_at       TIMESTAMPTZ,                 -- set at issuance; no edits after
  PRIMARY KEY (contract_id, tranche, holder_key)
);

CREATE TABLE vouchers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     TEXT NOT NULL,
  tranche         SMALLINT NOT NULL,
  holder_key      TEXT NOT NULL,               -- member_hash or 'coop'; never a phone number
  kind            TEXT NOT NULL CHECK (kind IN ('voucher','cash')),  -- cash rows: metric only
  amount          NUMERIC(39,0) NOT NULL,      -- token base units (i128-safe)
  remaining       NUMERIC(39,0) NOT NULL,
  code_hmac       TEXT UNIQUE,                 -- NULL for kind='cash'
  supplier_id     UUID REFERENCES input_suppliers(id),
  status          TEXT NOT NULL CHECK (status IN
                    ('issued','partially_redeemed','redeemed','expired','void')),
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  UNIQUE (contract_id, tranche, holder_key, kind)   -- issuance idempotency
);

CREATE TABLE voucher_redemptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id      UUID NOT NULL REFERENCES vouchers(id),
  supplier_id     UUID NOT NULL REFERENCES input_suppliers(id),
  amount          NUMERIC(39,0) NOT NULL CHECK (amount > 0),
  status          TEXT NOT NULL CHECK (status IN ('pending_payment','paid','abandoned')),
  tx_hash         TEXT,                        -- the coop→supplier payment, once landed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at      TIMESTAMPTZ
);

CREATE TABLE voucher_events (                  -- append-only audit trail
  id              BIGSERIAL PRIMARY KEY,
  voucher_id      UUID NOT NULL REFERENCES vouchers(id),
  event           TEXT NOT NULL,               -- issued|redeem_pending|paid|abandoned|expired|reissued|objected
  detail          JSONB,
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Routes (names illustrative):

| Route | Caller | Purpose |
|---|---|---|
| `PUT /commitments/:id/vouchers/election` | cooperative (signed message) | Record or replace the split for a tranche, before its claim is observed. Enforces `max_cash_bps`. |
| `GET /commitments/:id/vouchers` | anyone | Per-tranche totals: issued, redeemed, outstanding, expired. Per-member rows by `member_hash` only. |
| `GET /commitments/:id/vouchers/payments` | cooperative | Pending coop → supplier payments to sign |
| `POST /vouchers/redeem/verify` | supplier (signed message) | Code + amount → hold the amount, return a redemption ID and the unsigned payment |
| `GET /vouchers/redemptions/:id` | supplier, cooperative | Status for the "release goods" step |
| `POST /transactions/submit` (+ `voucherRedemptionId`) | cooperative | Existing route, plus one new side effect |
| `POST /admin/input-suppliers` | HarvestLock operator | Supplier onboarding |
| `GET /metrics/vouchers` | anyone | Pilot metric (§7) |

Issuance is not a route. It is a side effect of the commitment refresh, placed next to `applyReputationConsequences`. Expiry is checked lazily on read and redemption, and later swept by a scheduled job if one ever exists. That is consistent with the project's current decision not to build pollers ahead of real usage (see `realtime-updates-spike.md`).

---

## 7. The pilot metric: definitions

PRD Success Metrics: *"Voucher versus cash split, and redemption rate."* Both need exact definitions, or a pilot can report numbers that are not comparable:

- **Voucher vs cash split (by value):** `Σ vouchers.amount WHERE kind='voucher'` ÷ `Σ vouchers.amount` (voucher + cash), over claimed tranches. Also reported **by member count** (the share of members who took any voucher) and **per tranche**, because tranche 1 (before planting) and tranche 2 (mid-season) can reasonably differ.
- **Redemption rate (by value):** `Σ paid redemptions` ÷ `Σ amount of vouchers that have reached the end of their life` (`redeemed` or `expired`). Vouchers that are still live are left out of the denominator so the rate is not understated mid-season. Report alongside it:
  - **Expired-unredeemed value**, the anti-abscond signal, attributed to the cooperative.
  - **Median time from issue to first redemption**, to show whether the supplier is actually reachable.
  - **Abandoned-payment count**, which shows whether the cooperative-online requirement is causing problems (§5).
- **Unit:** token base units, plus the NGN amount at the commitment's oracle rate when one is configured, for reporting.

Every input lives in the tables in §6, so the metric is a SQL query, not a separate pipeline. Matching the PRD's own attitude toward data, **a cooperative that elects 0% voucher is a recorded finding, not an error.**

---

## 8. Settlement-time vouchers (the #6 framing): deferred, and why

If maintainers do want vouchers as a choice at **settlement payout**:

- At **Rung 1** (the v1 default, PRD §4.9), `settle` pays the cooperative wallet one lump sum, and the allocation ledger records entitlement only. HarvestLock has no per-member payout to replace with a voucher. Any "settlement voucher" would be the cooperative paying members in kind, which HarvestLock can only record, not deliver.
- At **Rung 2** (opt-in direct payment through SDP, #4), a per-member payout does exist. The natural place for a voucher choice is the moment SDP's disbursement batch is built: each member's line is either an SDP cash payment or a voucher row like the ones above, paid to a supplier on redemption. Everything in §2, §5, §6 and §7 carries over. The only change is the issuance trigger (`Settled` + a Rung 2 opt-in instead of `advanceN_claimed`).
- Recommendation: **do not build this until Rung 2 is real.** The PRD treats moving up the ladder as a *finding*, and the SDP integration that Rung 2 needs (#4) has only reached a partial spike (`sdp-spike.md`). Building it now would mean building ahead of two unanswered questions.

---

## 9. Phasing and gates

| Phase | Scope | Gate |
|---|---|---|
| **P0** | This proposal, discussed and roughly agreed | — |
| **P1 — tracking** | Migration `008`, election route + `coop-pwa` election UI, observed-claim issuance, read routes, `/metrics/vouchers`. Codes shown in `coop-pwa` as the stand-in for SMS. Testnet-exercisable against a **test supplier row**. | P0 agreed. Can proceed **before** OQ 08 if maintainers want the Phase 1 testnet tranche complete. It is small and supplier-independent. |
| **P2 — redemption** | Supplier page, verify/hold, coop payment-signing list, `voucherRedemptionId` submit side effect, abandonment timeout | **OQ 08 answered yes**, with the actual supplier's redemption expectations known (online cooperative OK? trade credit? bank vs wallet payout) |
| **P3 — delivery** | SMS issuance + receipts + objection channel | An SMS provider integrated (shared with the SMS-notification must-have) |
| Later | Spike Option 2 (pre-signed payments), settlement-time vouchers (§8), Option 3/4 | A supplier requirement for redemption without the cooperative online / Rung 2 live / contract budget |

If OQ 08 comes back **no**, P1's tables still record the (100% cash) split, so the metric still reports something honest, and P2/P3 wait.

---

## 10. Decisions needed from maintainers

1. **Framing (§1):** agree that v1 vouchers attach to advance tranches, with settlement-time vouchers deferred to Rung 2? (Recommended.)
2. **Who elects (§3.1):** the cooperative records a per-member election on members' behalf, defaulting to 100% voucher, with a capped cash share? Or a single per-tranche split only, which is simpler but gives coarser metric data?
3. **Expiry default (§3.3):** `delivery_deadline`, or a fixed number of days after the claim?
4. **Redemption confirmer (§5):** supplier-confirmed + on-chain payment + member SMS receipt, with the warehouse operator explicitly excluded?
5. **Supplier surface (§5):** a role-gated page inside `coop-pwa`, or a standalone page?
6. **P1 before OQ 08 (§9):** build tracking now for testnet completeness, or hold all voucher code until OQ 08?
7. **Issue #2:** close or re-scope it, given `AllocationLedgerSection.tsx` already exists?

Questions for outside parties (not maintainers): OQ 08 (supplier), counsel on the closed-loop/non-transferable shape (with OQ 04), and the SMS provider choice.

---

## References

- `docs/PRD.md`: Goals v1; §4.1 (warehouse-anchored); §4.5 (custody/regulatory); §4.8 (release events, allocation ledger); §4.9 (transparency ladder); Users table (input supplier); Edge cases ("Lead absconds with advance"); Success metrics; Open Questions 03, 04, 08.
- [`docs/voucher-design-options.md`](./voucher-design-options.md): mechanism comparison (Options 1–4), regulatory note, the limits of a layered design (§3).
- `api/src/reputation.ts`: observation-triggered side effects, and why `previousStatus` must not be the idempotency guard.
- `api/src/db/migrations/005_allocation_members.sql`, `api/src/db/allocationMembers.ts`: member hash/salt model, NDPA erasure.
- `api/src/stellar/client.ts` `Commitment`: `total_amount`, `advance{1,2}_bps`, `advance{1,2}_claimed`, `delivery_deadline`.
- `api/HANDOFF.md`: build-unsigned / client-signs / submit; `pending_submissions` side effects (#405); allocation ledger UI done (Next steps item 9).
- `coop-pwa/src/components/AllocationLedgerSection.tsx`: the existing allocation ledger UI (#2).
- `docs/sdp-spike.md`: SDP status (#4), relevant to §8.
- Related issues: #2 (allocation ledger UI), #3 (social recovery / two-signer wallet), #4 (SDP), #5 (identity/session model), #185 (voucher design spike, closed).
