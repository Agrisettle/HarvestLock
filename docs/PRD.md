# HarvestLock

*Pre-harvest commodity commitments, settled against an independent warehouse receipt, with farmer-level allocation recorded on chain.*

**Document:** PRD &nbsp;|&nbsp; **Version:** 0.7 &nbsp;|&nbsp; **Date:** 26 Aug 2026 &nbsp;|&nbsp; **Supersedes:** v0.2 – v0.6 &nbsp;|&nbsp; **Status:** Pre-validation

> **This file is the canonical, version-controlled copy of the PRD**, exported
> from the working document it was drafted in. It ships in this repo
> specifically so it doesn't depend on an external, access-gated link to be
> readable — update it here going forward, in the same PR as whatever change
> it's documenting, rather than treating it as a one-time export.

> v0.3 rewrote the architecture — a reader of v0.2 should treat §4 as entirely new. v0.4 added §13–§15, auditing that rewrite against the empirical literature and reaching a conclusion the earlier versions had not: as specified for smallholder cooperatives, the product fails a documented precondition for blockchain deployment in this sector, and the fix is a change of counterparty rather than a change of design.
>
> **v0.5 incorporates an external audit.** Three load-bearing facts in v0.4 were wrong — the regulatory capital exposure, AFEX's scale, and Hiveonline's reach — and are corrected in §4.5, §4.1 and §15.1. A fourth correction reverses an over-correction v0.4 itself made (§11). The most consequential change is **§15.3**, which names something no prior version admitted: the institutional-anchor pivot turns this from a market-access product into B2B infrastructure inside a relationship that already exists.
>
> **v0.6 adds §16**, a dedicated edge-case round. Two findings there are design changes rather than risks: storing member identifiers on chain very likely breaches NDPA 2023 s.34 (corrected in §4.8), and the phone-as-identity model underpinning this document’s primary “why Stellar” claim sits on a channel with a documented 300% rise in SIM-swap fraud.
>
> **v0.7 adds §17**, the implementation stack, with the build order mapped to the SCF tranches. One sequencing note carries beyond the stack: the escrow contract is worth building on testnet *in parallel* with the A1 buyer conversations, because a deployed contract reaches Builder tier for Instawards and is the one build task that is not wasted if A1 fails.

---

## What changed from v0.2, and why

Five changes account for most of this rewrite. Each is explained where it appears; they are listed here so a reader of v0.2 knows what to re-read.

| # | Change | Reason |
|---|---|---|
| 01 | **Warehouse-anchored, not field-anchored.** A commodity warehouse operator becomes the keystone partner and the delivery oracle. | v0.2 made HarvestLock personally responsible for physical delivery verification, grading, and dispute arbitration — a field-operations business a small team cannot run. Nigeria already has this infrastructure at scale. |
| 02 | **Unit of account is NGN; settlement rail is stablecoin.** | v0.2 denominated contracts in USDC, which silently made every forward contract an FX forward as well. Neither party signed up for that exposure. |
| 03 | **The marketplace is cut from v1.** Bring-your-own-counterparty. | A two-sided cold start solved simultaneously with field ops, regulation, and contract development is three problems too many. |
| 04 | **Farmer-level allocation recorded on chain from day one**, with disbursement moving from cooperative wallet to individual wallets progressively. | v0.2's own success metric asked whether benefit reached farmers rather than the lead, and the design had no answer. This is also the strongest available answer to "why does this need Stellar." |
| 05 | **The buyer position is assignable.** | Gives wholesalers an exit, defusing adverse selection, and turns the product from an escrow app into an on-chain instrument. |

---

## Executive summary

HarvestLock lets a farmer cooperative and a commodity buyer agree price and quantity before harvest, with the buyer's deposit held in a Soroban escrow and released against an independent warehouse operator's grading and weighing receipt rather than against anybody's say-so. A capped portion reaches the cooperative before harvest as structured input access. Each member farmer's share of the contract is recorded on chain at lock-in, so what is owed to whom is verifiable by the farmers themselves rather than asserted by the cooperative lead.

Contracts are denominated in Naira and settled in stablecoin. HarvestLock never converts to fiat and never holds a Naira balance; cash-out happens through licensed Stellar anchors.

v1 does not include a marketplace. It serves cooperative-buyer pairs who already trade with each other and lack an instrument, not strangers who need matching.

---

## Problem statement

Smallholders sell at the moment of maximum weakness: harvest, when the crop is perishable, storage is scarce, and every farmer in the region sells at once. The binding constraint is timing, not demand. Four failures compound:

1. **No price certainty before planting.** The farmer alone carries months of input cost against an unknown price.
2. **No cash before harvest.** Even a willing future buyer has no mechanism to advance value when it is actually needed.
3. **No verifiable distribution.** Where cooperatives do capture better prices, individual members cannot confirm what reached them versus what stopped at the lead. This is a trust failure *inside* the cooperative, distinct from the farmer-versus-middleman framing, and largely unaddressed by existing platforms.
4. **No currency transparency.** Farmers price inputs and life in Naira. Any instrument that quietly denominates their income in dollars has moved risk onto them without disclosure.

> **What v0.2 got wrong about this**
>
> It treated (1) and (2) as the whole problem and treated (3) as a reporting metric. On reflection, (3) is the failure blockchain is uniquely suited to solve, and (1) and (2) are the ones it is least suited to solve. The architecture is reorganized around that inversion.

---

## Goals and non-goals

**Goals — v1**

- Forward purchase agreement denominated in NGN, backed by a real stablecoin deposit in a neutral contract.
- Release conditioned on an **independent warehouse operator's grading receipt**, not HarvestLock's judgment.
- Capped, tranched pre-harvest advance, preferentially as input vouchers, that does not make HarvestLock a lender.
- An **on-chain allocation ledger** recording each member farmer's share at lock-in.
- Prove one cooperative and one buyer can complete a full cycle with acceptable friction.
- Reach mainnet with a usable interface — an explicit SCF v7 funding gate, not a nice-to-have.

**Non-goals — v1**

- Marketplace, matching, discovery, auctions.
- Cash-settled futures, derivatives, speculation, liquid secondary market.
- Recoverable loans, credit scoring, collections.
- Tokenized warehouse receipts as tradable instruments (Phase 4).
- Parametric insurance (Phase 4).
- More than one crop, region, warehouse partner.
- HarvestLock ever touching fiat.

---

## Architecture

### 4.1 The keystone decision: warehouse-anchored

v0.2's fatal operational assumption was that HarvestLock would verify physical delivery. It cannot, at any scale worth having, and pretending otherwise put a solo team in rural depots arbitrating whether maize is Grade A.

Nigeria already has this. AFEX runs an electronic warehouse receipt system, weighs and grades professionally, marks commodities to market in real time, links receipts to financiers, and has already explored blockchain-based receipt verification.

**Scale correction:** v0.3 and v0.4 cited "roughly 45 warehouses," a figure from 2020. As of 2024 AFEX operates **over 200 warehouses** across Nigeria, Kenya and Uganda, has reached **over 500,000 farmers**, was named to the *TIME*100 Most Influential Companies list in 2024, holds a $26.5m commitment from British International Investment to add 20 modern warehouses and 230,000 MT of capacity, and is expanding into Ivory Coast and Ghana with Benin, Togo, Tanzania, Ethiopia and Zambia to follow.

Anchoring to a warehouse operator resolves six open problems in v0.2 at once:

| v0.2 problem | Resolved by warehouse anchor |
|---|---|
| Who verifies delivery? | Depot intake: weighed, graded, receipted |
| Who adjudicates grade disputes? | The operator's existing grading process and appeals |
| Who is the independent third signer? (A5) | The operator, with no stake in either side |
| Where does commodity price data come from? | Operator's mark-to-market feed |
| What if storage, not price, is the real constraint? | Storage becomes part of the product |
| What collateral supports later lending? | The receipt itself |

> **This also makes the warehouse operator a competitor — and the corrected scale makes that worse**
>
> AFEX already offers smallholders storage, better price discovery, competitive buyer access, and receipt-backed finance — a meaningful share of what v0.2 proposed to build, already operating at scale. At 45 warehouses that read as a strong regional operator worth approaching. At **200+ warehouses, 500,000+ farmers, DFI backing and an eight-country expansion plan**, it is a dominant incumbent well capitalised enough to build the forward-commitment layer itself, and a pre-product team approaches it as a supplicant rather than a peer. Healthy partner, harder negotiation, larger competitive risk. The wedge against that incumbency is narrow and should be defended narrowly:
>
> - **Pre-planting commitment and capital.** Receipt systems help *after* harvest, once there is grain to deposit. HarvestLock's contract exists before the seed goes in.
> - **Farmer-level distribution transparency.** Operators transact with cooperatives too, and inherit the same opacity about what reaches members.
> - **Cross-border buyers.** Receipt systems are domestic and Naira-denominated. Stablecoin settlement opens the buyer side to diaspora and foreign purchasers.
> - **Programmable multi-party settlement.** Conditional, tranched, split payments a receipt system does not attempt.
>
> If a conversation with an operator reveals they intend to build the forward-commitment layer themselves, that is a redirect signal, not a detail.

### 4.2 Denomination: NGN unit of account, stablecoin rail

v0.2 priced contracts in USDC. Consider what that does over a six-month season with a volatile Naira:

- The **cooperative** buys inputs and lives in Naira but holds a dollar receivable — an unhedged FX position they did not ask for and cannot price.
- The **buyer**, if a domestic wholesaler, earns Naira revenue against a dollar payable. If the Naira depreciates, cost of goods rises sharply in the currency they actually earn. **This is likely a larger deterrent to buyer participation than price risk itself**, and v0.2 did not identify it.

v0.3 denominates the agreement in Naira. Stablecoin is the settlement rail and escrow store of value, not the unit of account. At settlement the oracle converts the agreed Naira amount to stablecoin due.

This has a consequence to surface rather than bury: **someone still bears FX risk between lock-in and settlement**, because escrow holds a dollar asset against a Naira obligation. Three options, decided with pilot partners rather than assumed:

| Opt | Structure | Trade-off |
|---|---|---|
| a | Escrow in NGNC | Cleanest match to the obligation; depends on NGNC liquidity and issuer concentration risk being acceptable |
| b | Escrow in USDC; buyer tops up or is refunded at settlement to meet the Naira obligation | **Recommended default.** Buyer carries FX risk, which is correct — better capitalized, can hedge. Top-up mechanic must be explained at onboarding, not discovered at settlement |
| c | Split escrow across both, sized to expected depreciation | Hedged but operationally heavier; hard to explain |

### 4.3 Why Stellar — the honest version

This section exists because SCF grades "Use of Stellar" explicitly and warns against superficial integration. The weakest version of HarvestLock — two Nigerians trading with each other, settling in stablecoin, when Nigerian bank transfers are already fast and cheap — has no good answer. The architecture below is chosen so the answer is real.

| Capability | Stellar mechanism | Why it is not incidental |
|---|---|---|
| Farmer-level split payment | Stellar Disbursement Platform | 200 payments of ~$50 at ~$0.000065 each. Bank rails cannot do this economically; cash cannot do it verifiably. **Primary justification.** |
| Recipient onboarding without wallets | SDP on-demand wallet creation, phone number and SMS | Removes the blocker that killed farmer-level payment in v0.2. Recipients need no prior blockchain exposure. |
| Conditional, expiring advance tranches | Native claimable balances with time predicates | An advance reverting to the buyer on a missed checkpoint is a native primitive, not custom logic. Smaller audit surface. |
| Cross-asset settlement | Path payments through the Stellar DEX | Buyer pays one asset, cooperative receives another, atomically, at oracle reference. |
| FX reference | Reflector, SEP-40 | Live, standardized, already integrated across the ecosystem. |
| Fiat cash-out | Licensed anchors, SEP-24, NGNC | HarvestLock never touches fiat. Regulatory posture depends on this. |
| Conditional release, tranching, allocation ledger, assignability | Soroban | Genuinely requires programmable contracts. Native multisig cannot express any of it. |

> **Correction to an earlier critique**
>
> I previously said native Stellar multisig could replace the escrow, implying the contract was decorative. That was true of v0.2's escrow *as scoped* — a static 2-of-3 release — but false of tranched conditional release, proportional shortfall adjustment, allocation splitting, and position assignment. Native multisig is a fixed signer set on an account and expresses none of those. The fix was never to concede the point; it was to move the parts that genuinely need Soroban out of "Phase 2" and into v1.

### 4.4 A known oracle gap

Reflector provides FX and crypto price feeds. **It does not provide Nigerian maize, cocoa, or soybean farm-gate prices**, and no on-chain oracle does. v0.2 assumed the "rate checker" requirement was solved by Reflector; only the currency half was.

- Any pricing term referencing local spot — spot-minus-discount, floors, collars — has no trustless data source.
- **v1 therefore uses fixed Naira pricing only.** No spot-linked terms.
- The operator's mark-to-market feed is the candidate source later, introduced as a named, attested, non-trustless input — never presented as an on-chain oracle.

### 4.5 Custody and regulatory posture

> **Correction — v0.3 and v0.4 stated this wrongly**
>
> Earlier versions asserted a flat **₦2 billion** minimum capital requirement as settled law applying to HarvestLock. That conflated two separate instruments and picked the worst tier of each. The accurate position:

| Instrument | Status | Tiers |
|---|---|---|
| **SEC Circular 26-1** 16 Jan 2026 | **Issued and binding.** Compliance deadline 30 June 2027 | Digital Asset Exchanges and custodians **₦2bn** (raised from ₦500m) · Digital Asset Offering Platforms **₦1bn** · Ancillary VASPs **₦300m** |
| **Proposed Rules — Digital and Virtual Asset Operations, Custody and Markets** published 20 Aug 2026 | **[DRAFT]** Comments close **3 Sept 2026** | Exchanges and custodians **₦2bn** · Digital asset platform operators *and real-world asset tokenisation platforms* **₦500m** · VASPs generally **₦200m** · registration fee **₦30m** · fidelity insurance bond ≥25% of minimum paid-up capital |

Three consequences follow, and they improve HarvestLock's position rather than worsening it:

- **₦2bn is the exchange-and-custodian tier, not a floor.** A non-custodial escrow platform that never holds keys and never touches fiat plausibly sits at the ₦200m VASP tier, or ₦500m if it is read as a platform operator. That is a difference of roughly an order of magnitude, and the entire "never touch fiat, never hold keys" design in this section is what argues for the lower tier. The design was right; the stated stake was wrong.
- **The draft names "real-world asset tokenisation platforms" explicitly** at ₦500m. Phase 4's tokenized warehouse receipts now have a named regulatory category and a price — no longer an unmapped risk.
- **The ₦30m registration fee and the 25% fidelity bond were never costed** in any version of this document. They belong in §14.

> **Time-sensitive and cheap: comment on the draft**
>
> The comment window closes **3 September 2026** — eight days from this revision. A short, specific submission to the SEC Rules Committee asking how non-custodial escrow software that never holds keys or fiat should be categorised is low-cost, creates a documented record of good-faith engagement, and opens a regulator relationship at the drafting stage rather than the enforcement stage. This is a materially better near-term regulatory move than the CBN sandbox flagged in §11, which is genuinely too soon.

The scope of "facilitated" remains unsettled and still requires Nigerian counsel. Design responses, in order of strength:

1. **HarvestLock holds no keys to escrowed funds.** Release requires buyer plus warehouse-operator attestation. HarvestLock operates the software; it is not a signer.
2. **HarvestLock never converts to fiat.** The cooperative off-ramps through a licensed anchor, under that anchor's licence and KYC.
3. **Escrow is non-custodial by construction** — release conditions fixed at lock-in, with no unilateral drain, pause, or redirect.
4. **Arbitration is separated from custody.** Where a human tiebreak is unavoidable, the arbitration key sits with a party that is not HarvestLock.

> **Staging honesty**
>
> In a v1 pilot with one warehouse partner, HarvestLock may have no credible alternative to holding a tiebreak key. If so, that is a temporary, disclosed position with a written path to handing it over — not a permanent design. It should be disclosed to the regulator, not discovered by them.

### 4.6 Key management

v0.2 did not address this, and it is a first-order risk for the actual user population. Cooperative officers with low digital literacy cannot be responsible for seed phrases. A key lost mid-season strands funds with no counterparty at fault. The lead's death or incapacity — not remote over a multi-month cycle in rural Nigeria — must not destroy the contract.

- Cooperative wallets use **Soroban account abstraction with social recovery**: a recovery set of the co-signer, the warehouse operator, and one further officer, any two of whom can rotate a lost key.
- **No seed phrases surfaced to cooperative users.** Phone-based authentication, consistent with SDP's recipient model.
- Contract terms bind the **cooperative entity**, not the lead's personal key, so officer turnover does not void an agreement.
- A documented succession path exercised once during onboarding, not written and filed.

### 4.7 System diagram

```
  Cooperative PWA  ─┐                        ┌─ Buyer web app
   (phone auth,     │                        │   (KYB'd, anchor-verified)
    SMS fallback,   │                        │
    offline queue)  │                        │
                    ▼                        ▼
              ┌────────────────────────────────────┐
              │        HarvestLock API             │
              │  contracts · allocation · vouchers │
              └───────┬──────────────┬─────────────┘
                      │              │
          ┌───────────▼──┐      ┌────▼─────────────┐
          │   Soroban    │      │  Warehouse       │
          │   contract   │◄─────┤  operator e-WRS  │
          │  per deal    │ attest│ (weigh · grade) │
          └───┬──────┬───┘      └──────────────────┘
              │      │
   ┌──────────▼─┐  ┌─▼──────────────┐
   │ Reflector  │  │ SDP            │
   │ FX (SEP-40)│  │ split payout   │
   └────────────┘  └─┬──────────────┘
                     │
              ┌──────▼────────────────┐
              │ Farmer wallets        │
              │ (phone-provisioned)   │
              └──────┬────────────────┘
                     │
              ┌──────▼────────────────┐
              │ Licensed anchor       │
              │ NGNC · SEP-24 cash-out│
              └───────────────────────┘
```

HarvestLock sits beside the value flow, not inside it. Funds move buyer → contract → farmers, with the warehouse operator gating release.

### 4.8 Contract design

#### State machine

```
Draft → Locked → Advance1_Released → Checkpoint_Passed → Advance2_Released → Delivered → Settled
                     ↓                    ↓                    ↓
                 Cancelled            Defaulted            Disputed
```

#### Release events

1. **Advance tranche 1** — on lock-in. Claimable balance to the cooperative wallet, expiring back to the buyer if unclaimed within N days. Voucher-preferred.
2. **Advance tranche 2** — on mid-season checkpoint attestation. Same mechanism.
3. **Settlement** — on warehouse receipt. The contract reads delivered quantity and grade from the attested receipt, applies the pre-agreed adjustment schedule, computes stablecoin owed against the NGN obligation at the oracle rate, and releases.

#### Allocation ledger

At lock-in the contract stores member entries and proportional shares summing to one. Immutable after lock-in except by joint buyer-and-cooperative amendment, which is logged. At settlement the contract computes each member’s amount. Whether that amount is *paid* to the member or to the cooperative wallet is a separate, staged decision (§4.9) — but the entitlement is recorded either way.

#### Assignability

The buyer position is transferable to another KYB-verified buyer with cooperative consent, recorded on chain. Deliberately not a market: no order book, no price discovery, no listing. It is a novation mechanism, sized to defuse adverse selection without inviting securities characterization.

#### What the contract deliberately does not do

Auto-release on any purely automated signal. Physical delivery is not verifiable on chain, and a contract that pretends otherwise manufactures false confidence. Every release traces to a named attesting party.

### 4.9 Staged disbursement — the transparency ladder

This addresses the political problem v0.2 missed: **direct farmer payment removes the cooperative lead's control over money, and the lead is the person whose cooperation the pilot depends on.** A design that disintermediates your gatekeeper on day one may simply not get adopted.

Hence a ladder, where each rung is independently valuable:

| Rung | Mechanism | What changes for the lead |
|---|---|---|
| 1 | **Transparent allocation (v1 default).** Payment settles to the cooperative wallet. Each member's entitlement is on chain and readable; members receive an SMS stating their share. | Nothing operationally. Cash-out and physical distribution stay with the cooperative — but shortfalls become visible. |
| 2 | **Opt-in direct payment.** Members with provisioned wallets receive directly; others via the cooperative. Both run in parallel within one contract. | Partial loss of control, by member consent |
| 3 | **Direct by default.** Cooperative wallet receives only its agreed service margin. | Full disintermediation of the money flow |

> The pilot begins at Rung 1 and treats movement up the ladder as a *finding*, not a milestone. **If a cooperative refuses Rung 1, that is significant evidence about where value is actually captured** — and worth more than a clean pilot.

---

## Users

| Role | Verification | Notes |
|---|---|---|
| **Cooperative** (entity) | Tier 0 — existence and track record via the operator's existing relationship, physical visit, or trusted referral | Warehouse partner substantially reduces this burden |
| **Cooperative lead** | Tier 1 — NIN/BVN where available, registration where it exists | Informal Ministry-level registration acceptable |
| **Co-signer** | Tier 1 | Must be a distinct officer; also in the key recovery set |
| **Member farmer** | Tier 3 — identity for allocation, not full KYC | Receiving within tiered anchor limits; full KYC only at cash-out, under the anchor's licence |
| **Buyer** | Tier 2 — full KYB, CAC, principal officers, sanctions screening, **plus existing anchor SEP-12 verification** | Requiring pre-existing anchor KYC avoids building a parallel AML programme |
| **Warehouse operator** | Institutional partner, contracted | Not a platform user; an attesting counterparty |
| **Input supplier** | Vetted, contracted | Voucher redemption |

#### Re-verification

Cooperatives each season, since membership and leadership turn over between cycles. Buyers every six months and on any material increase in transaction size. Sanctions screening on every transaction above a threshold, not at onboarding only. Advance caps scale with completed dispute-free cycles.

---

## Feature list — v1

**Must have**

- Cooperative onboarding with mandatory co-signer and social recovery set
- Buyer onboarding with KYB and anchor verification proof
- Contract creation from an existing counterparty relationship
- Member allocation ledger capture at lock-in
- Soroban escrow: two advance tranches plus adjusted settlement
- Warehouse receipt attestation intake
- Pre-agreed shortfall and grade adjustment schedules
- Reflector FX display as a **range**, labelled an estimate
- Voucher issuance and redemption tracking
- SMS notification for cooperative and members
- Buyer position assignment
- Dispute flagging with defined escalation
- Key recovery flow

**Should have**

- Offline-tolerant PWA with queued submission
- Yoruba, Hausa and Igbo support for member-facing SMS

- Marketplace, matching, discovery
- Automated delivery verification via IoT or satellite
- Tradable receipt tokens
- Lending, credit scoring
- Spot-linked pricing (§4.4)
- Individual farmer full KYC

---

## Edge cases and failure modes

Rows marked **[NEW]**  were absent from v0.2.

| Case | Handling |
|---|---|
| **Side-selling** — cooperative takes advance, sells elsewhere | Advance conditioned on exclusivity; forfeits escrow balance to buyer; permanent bar. Warehouse anchoring materially reduces this: grain must physically arrive at the depot to settle. |
| **Partial delivery** | Pre-agreed proportional adjustment; advance not clawed back |
| **Grade mismatch** | Operator's grading is authoritative; pre-agreed grade-price table; operator's appeals process, not a HarvestLock dispute |
| **Over-delivery** | Buyer right of first refusal at contract unit price; excess otherwise released to cooperative |
| **Total crop failure after advance** | Buyer absorbs. Must be disclosed as the cost of forward purchase, in writing, at onboarding |
| **Buyer defaults on balance** | Escrowed deposit forfeits to cooperative; permanent bar |
| **Lead absconds with advance** | Mitigated by voucher-first, two-signer wallet, tranching — not eliminated |
| **FX move between offer and settlement** | §4.2. NGN is the obligation; top-up or refund mechanic disclosed at onboarding |
| **[NEW]** **Buyer FX exposure deters participation** | The reason for NGN denomination. Monitor whether buyers still balk |
| **[NEW]** **Idle capital cost** | At Nigerian rates above 20%, locking 30–50% for six months is materially expensive and a real deterrent. v1 response: lower deposit percentages, shorter horizons, honest pricing of this against supply assurance. Yield-bearing escrow via Blend is Phase 4 and adds protocol risk |
| **[NEW]** **Key loss, lead death or incapacity** | §4.6 social recovery; contract binds the entity |
| **[NEW]** **Cooperative resists farmer-level transparency** | §4.9 ladder. Treated as a finding |
| **[NEW]** **Correlated regional failure** | Drought hits every contract at once. Buyer concentration limits; region-level exposure caps |
| **[NEW]** **Warehouse operator failure, fraud, or capacity** | A new single point of dependency. Requires the operator's own insurance and bonding, a documented fallback attestation route, and avoiding regional exclusivity |
| **[NEW]** **Warehouse operator becomes competitor** | §4.1. Contractual non-circumvention where obtainable; wedge defended narrowly |
| **[NEW]** **Mutual cancellation** | Defined unwind: advance settled per agreed schedule, remaining escrow returned, no penalty, logged |
| **[NEW]** **No commodity price oracle** | §4.4. Fixed pricing only in v1 |
| **[NEW]** **Connectivity loss at depot** | Offline queue with signed later submission; the receipt is the source of truth |
| **[NEW]** **Member list disputed** | Allocation immutable post-lock-in except by joint amendment; disputes resolve off-chain against the recorded list |
| **[NEW]** **"Why not a bank transfer?"** | For a purely domestic pair, honestly: programmability and distribution transparency, not payment speed. If neither is valued, this pair is not a good pilot fit |
| **Buyer cherry-picks strong cooperatives** | Acknowledged; forward pricing may help the already-strong. Tracked, not solved |
| **Double-commitment** | One active commitment per contract; total committed quantity capped against realistic yield |

---

## Assumptions under test

Reordered by what would most damage the product if false. **A1 was ranked second in v0.2** — it is both more likely to be false and more fatal than the constraint question, so it is promoted.

| ID | Assumption | If false |
|---|---|---|
| A1 | **Buyers will commit ahead at all.** They must accept locked price, early payment, idle capital at 20%+ rates, crop-failure exposure, and FX risk — against simply buying at harvest as they do now. | **Test first, before any build.** If the motivation is real it is supply assurance and grade certainty, not price. Three declines means the structure is wrong. |
| A2 | **Price and payment timing is the binding constraint** — not storage, logistics, or market access. | If it is storage, the warehouse partner already solves it and HarvestLock is redundant |
| A3 | **A cooperative will accept member-level transparency.** | The primary "why Stellar" justification is unavailable and the product reduces to escrow |
| A4 | **A warehouse operator will partner rather than compete.** | The architecture depends on it. No fallback currently exists |
| A5 | **Lead plus co-signer is a real fraud check.** | Both may collude. Genuine independence requires the operator or an apex body in the recovery and release sets |
| A6 | **Farmers want a live FX figure.** | It may erode trust when it moves. Test whether a periodically-fixed reference rate is preferred |
| A7 | **Forward pricing caps upside.** | Must be explained at onboarding in the same breath as the protection |
| A8 | **HarvestLock can be neutral** while recruiting both sides and charging a fee. | Fee structure and recusal must be published before the first contract |

---

## Success metrics — pilot

- One cooperative, one warehouse partner, three or more buyers approached — **decline reasons recorded verbatim; a decline is data, not a failure**
- Five or more contracts completed end to end
- Share of contracts settling without escalation beyond the operator's grading process
- Voucher versus cash split, and redemption rate
- Time from receipt attestation to funds released
- **Share of contract value traceable to named member farmers** — the transparency ladder rung reached
- Farm-gate price achieved versus regional spot at the same date
- Every side-sell, shortfall, dispute and key-recovery event logged regardless of outcome

> **Explicitly not success metrics:** transaction volume, cooperative count, crop count, TVL. Breadth is a later-phase goal and optimizing for it now produces a worse product.

---

## Roadmap

| Phase | Scope |
|---|---|
| 0 ~10 wks | **Validation.** Test A1 with three buyers *before anything is built*. Approach warehouse operators. Recruit a technical co-founder — a hard eligibility floor for SCF Kickstart and a practical floor for the workload. Engage Nigerian counsel on VASP facilitation scope and on whether the non-recoverable advance reads as lending. Assess CBN sandbox Cohort 3 and the SEC's Accelerated Regulatory Incubation Programme. Join the Stellar community in Lagos and begin the Ambassador progression toward Builder tier. |
| 1 | **Testnet.** Escrow with tranches and adjustment, allocation ledger, receipt attestation intake, SDP integration, Reflector, recovery flow. Deployed and exercised against simulated contracts. |
| 2 | **Mainnet pilot.** One crop, one region, one warehouse partner, closed cohort. Transparency ladder Rung 1, moving to Rung 2 if the cooperative allows. |
| 3 | **Prove the loop.** Second cooperative and operator. Rung 3. Assignment used in anger. Multi-crop. |
| 4 | **Build on proven trust.** Tokenized receipts as tradable RWA. Blend-collateralized lending against contracts. Parametric insurance. Marketplace, if discovery is still the unmet need by then. |

---

## Funding path

SCF v7 disburses in four tranches: 10% on award, 20% at MVP, 30% at testnet, 40% at mainnet with demonstrated UX readiness. Seventy percent sits behind software milestones, which suits a rescoped v1 and penalizes a field-ops-heavy one.

| Route | Status | Notes |
|---|---|---|
| **Integration Track** | Probably closed — **verify directly** | The SCF Handbook's Integration Track page states that teams with existing traction are eligible and net-new applications without traction are not. The SCF v7 launch blog describes the track without mentioning any traction requirement. The handbook is the more specific source and likely governs, but the two disagree and this should be confirmed with SCF before being relied on |
| **Instawards** up to $15K | **Reachable sooner than v0.4 claimed** | **Correcting a correction.** v0.4 said this required climbing an Explorer → Contributor → Builder social progression. Builder-tier eligibility is in fact *technical*: deployed smart contracts, a working MVP, or contributions to an SCF-funded project. A working testnet build reaches Builder — a build task, not a networking one, and it sits directly on the Phase 1 path. Ambassador chapters are live in Africa. All Instaward decisions remain subject to SDF review |
| **Open Track** up to $150K | The Build Award route | Round #44 drew 175 submissions, 12 of 50 awarded in Open, recent winners DeFi-native. The farmer-impact narrative differentiates against that field only if "why Stellar" is answered concretely — which §4.3 and §4.9 exist to do |
| **CBN sandbox Cohort 2** | Closes 31 Aug 2026 | Too soon to apply credibly. A weak application spends regulator goodwill that cannot be recovered. Read the eligibility criteria as a specification for Cohort 3 |

---

## Open questions

| # | Question |
|---|---|
| 01 | **[BLOCKING]** Which warehouse operator, and will they partner or compete? The architecture has no fallback |
| 02 | Which crop and region, given the operator's existing footprint? |
| 03 | Deposit percentage and advance cap that helps meaningfully without overexposing the buyer, priced against idle-capital cost at Nigerian rates |
| 04 | Nigerian counsel on (a) **which capital tier a non-custodial escrow platform actually falls under** — tested against the final rule, not the August draft — plus VASP "facilitation" scope, and (b) whether the non-recoverable advance is lending |
| 10 | Submit a comment on the SEC draft rules before **3 September 2026** asking how non-custodial escrow software is categorised (§4.5) |
| 11 | Nigerian data-protection counsel to confirm the salted-hash allocation design satisfies NDPA s.34 and GAID 2025 (§4.8, §16.1) |
| 12 | Can TIRM be accessed directly, or only through a licensed bank or wallet provider? Determines whether SIM-swap screening is buildable or must be contracted (§16.1) |
| 05 | Escrow denomination: NGNC, USDC with top-up, or split (§4.2) |
| 06 | Who holds the arbitration key if not HarvestLock, from day one? |
| 07 | Will a cooperative accept Rung 1 transparency? |
| 08 | Is there a vetted input supplier who will accept vouchers, or does v1 default to capped cash? |
| 09 | **[BLOCKING]** Co-founder. Required for SCF Kickstart eligibility and for delivery |

---

## Institutional preconditions — self-assessment

A 2026 study in *Frontiers in Sustainable Food Systems* — "When verification is not enough" — argues that repeated blockchain pilot failures in smallholder value chains reflect a **misdiagnosis of the constraint**, not inadequate technology. Cryptographic verification concerns the integrity of the record, not the veracity of its content or the reliability of the parties. Blockchain documents fraud permanently without constraining it when enforcement is absent.

It identifies four *joint-sufficiency* preconditions that must hold before deployment, and finds that failed projects — Wala/Dala, Twiga, Binkabi, AgriLedger — lacked several, while the successes (BanQu with AB InBev; AgriDigital in Australia) met all four through institutional anchoring. HarvestLock scored honestly against them:

| P | Precondition | HarvestLock v0.3 |
|---|---|---|
| P1 | **Stable counterparty identity** — persistent verifiable identity tied to legal entities and transaction history | **Partial.** Cooperative and buyer yes, via Tier 0–2 and NIN/BVN/CAC. Individual farmers no — Tier 3 is deliberately shallow. This weakens the allocation ledger, which is precisely the differentiator |
| P2 | **Credible enforcement backstop** — courts, boards, or arbitration actually reachable by smallholders | **Partial, and only via the warehouse anchor.** Deposit forfeiture and a platform ban are weak. Nigerian courts are not realistically reachable by a rural cooperative. A licensed exchange with a grading-appeals process is the only real backstop available — which elevates A4 from architectural preference to precondition supplier |
| P3 | **Sufficient transaction volume** — typically 50+ per year, so value exceeds participation cost | **[FAILS]** **Structurally.** Agriculture is seasonal. One or two contracts per cooperative per year cannot approach 50. A participant who touches the system twice a year will not maintain credentials, habits, or trust. **This is the most serious finding in this document** |
| P4 | **Pre-existing inter-organisational trust** | **Met, by accident of design.** The v0.3 decision to cut the marketplace and serve pairs who already trade turns out to satisfy P4 directly. The scope cut was precondition-satisfying, not merely scope-reducing |

> **What P3 forces**
>
> Frequency cannot come from a cooperative selling once a season. It has to come from the *other* side of the trade. Both documented successes are anchored by a single large institutional buyer transacting continuously — BanQu works because AB InBev anchors it.
>
> **v1 should therefore anchor on one large institutional off-taker** — a brewery, flour mill, feed producer or exporter with an existing outgrower programme — rather than three independent wholesalers. One anchor buyer supplies P2 (their own contracts and reputation become the backstop), P3 (continuous procurement rather than one seasonal purchase), P4 (existing supplier relationships), and improves P1 (large buyers already require supplier registration).
>
> This also matches how the Nigerian agritech survivors adapted: ThriveAgric abandoned retail crowdfunding for institutional partners after its 2020 near-collapse; Farmcrowdy exited crowdfunding for value-chain and logistics work.

---

## Business model and unit economics

**v0.2 and v0.3 contained no revenue model at all.** That is a straightforward omission — SCF asks about sustainability, and the unit economics turn out to bear directly on whether the product can work.

Nigerian maize farmgate prices sat around **USD 187–190 per tonne** in late 2025, after a fall of roughly a third year-on-year — white maize dropped from ₦1,168 to ₦785. Working from that:

| Line | Value | Consequence |
|---|---|---|
| Contract, 100 tonnes maize | ≈ $19,000 | A typical cooperative-scale forward |
| Platform fee at 1.5% | ≈ $285 | Against onboarding, KYB, two advance tranches, checkpoint, attestation, settlement and member allocation |
| Contracts for $500K revenue | ≈ 1,750 | ≈ 175,000 tonnes intermediated — far beyond a pilot team's operational reach at this touch level |
| Same fee on a $500K export invoice | ≈ $7,500 | **26× the revenue for comparable operational work** |

> The sector's own summary of this trap: African agriculture faces a USD 65–80bn annual financing gap, but venture capital expects fintech-like returns that farming cycles cannot deliver. Any plan that assumes smallholder-scale tickets plus high-touch verification plus venture-scale growth is assuming away this arithmetic.
>
> Ticket size, not technology, is the binding constraint on viability. It points the same direction P3 does: larger, institutional, repeat counterparties.

---

## Uniqueness and scalability — honest verdict

### 15.1 What is genuinely unoccupied

An earlier draft rested the thesis on member-level payment transparency being an unfilled niche on Stellar. That claim does not survive checking.

| Claimed differentiator | Status |
|---|---|
| Cooperative management and transparency on Stellar | **Occupied, and more heavily than v0.4 said.** Hiveonline's myCoop has reached **~50,000 smallholder farmers and savings-group members** (not the 18,400 cited in v0.4), with ~10,000 farmers in Mozambique alone, and operates across Mozambique, Niger, Zambia, Uganda, Kenya and Ghana. It uses **SMS receipts to build farmers' credit records** — close to this document's allocation-ledger-plus-SMS design. A multi-year head start on nearly the exact ground |
| Farmer digital wallets and payment records | **Occupied.** Agri-Wallet; BanQu; CottonPay's 2026 offline-first QR crop-valuation wallet |
| Warehouse receipts and grading | **Occupied.** AFEX and the broader African WRS sector |
| Forward contracts for smallholders | **Ancient.** Contract farming; AgriDigital; AgriDex; prior academic proposals |
| Stablecoin escrow | **Generic.** |
| **Forward purchase commitment + tranched escrow + on-chain member allocation, settled against a licensed commodity exchange's receipt, in Nigeria, on Stellar** | **Unoccupied — but narrow.** The uniqueness is in the combination and the jurisdiction, not in any component. It should be claimed that precisely, and never more broadly |

> One thing the literature does validate: contract-farming schemes collapse disproportionately from **mistrust and information asymmetry** — Ghanaian outgrowers with measurably higher yields and incomes still regretted participating, because they did not understand the contract terms. Opacity, not price, is the documented failure mode. That is the problem a verifiable contract is actually built for, and it is a better basis for the pitch than price certainty.

### 15.2 Structural fragility of the instrument

The WRS literature names the dominant failure mode of African commodity contracts as *performance failure — suppliers defaulting on contracts, particularly in rising markets*. Set that against the current market and a symmetry appears:

- **Rising market:** spot exceeds the locked price, the cooperative side-sells, and the buyer gets no grain. Escrow protects the deposit, not the supply.
- **Falling market:** spot drops below the locked price, and the buyer wants out. Nigerian maize fell roughly a third year-on-year into 2026 and the market now favours buyers.

**Whichever party is out of the money at delivery has an incentive to defect, and escrow only half-solves it.** Warehouse anchoring is the real mitigation on the supplier side, because grain must physically arrive to settle. On the buyer side the only protection is a deposit large enough to hurt — which collides with the idle-capital cost in §7.

> **Timing**
>
> A falling maize market is the *best* environment for farmer demand and the *worst* for buyer demand. Buyers currently have every reason to wait and buy cheaper. A1 is being tested at its hardest, and deposit sizing should be calibrated to buyer walk-away risk rather than to side-selling — an inversion of the emphasis in §7.

### 15.3 What the product has actually become

The institutional-anchor pivot in §13 solves the preconditions, but it quietly changes what HarvestLock *is*, and that change has not been acknowledged anywhere else in this document.

The founding thesis was that smallholders could reach better-paying buyers they could not otherwise access. Once the design requires a single large, well-capitalised off-taker, that claim collapses: **large buyers already run outgrower schemes.** The farmer's counterparty is no longer someone new. What HarvestLock adds inside that relationship is transparency and programmable settlement — not market access.

§14's arithmetic independently confirms where the value sits: fee income scales with ticket size, not with farmer count. The customer is the off-taker.

> **Three consequences, none of them optional**
>
> - **The pitch must change.** "Empowers smallholders" cannot carry over by inertia from v0.2. The honest framing is B2B supply-chain infrastructure that reduces leakage, side-selling and reconciliation cost inside an existing outgrower programme, with farmer benefit as a real but second-order effect. Carrying the old framing into a grant application invites a reviewer to find the gap themselves.
> - **The revenue model inverts, and improves.** A corporate off-taker paying a platform or per-transaction fee is better than a percentage skimmed from farmer proceeds — stronger margins, cleaner collections, and none of the optics of taxing the smallholder the product claims to help.
> - **P3 is solved at the platform level, not the farmer level.** An off-taker procuring continuously across many cooperatives generates volume; an individual farmer still touches the system once or twice a year. Farmer-side retention therefore remains unsolved, which argues for SMS-first, no-app-required design — precisely what Hiveonline already does.

> **And it moves toward an occupied position**
>
> BanQu with AB InBev — cited in §13 as the success case to emulate — *is* enterprise-funded supply-chain transparency reaching smallholders. Pivoting to an institutional anchor moves HarvestLock toward BanQu's ground rather than away from it. What still distinguishes it is narrow and should be stated as narrowly as this: **a forward-commitment escrow with tranched pre-harvest capital release, sold as infrastructure to a large off-taker, settled on Stellar against a licensed exchange's receipt.** BanQu is traceability and payment record; it is not forward finance. That gap is real, but it is the whole of the gap.

### 15.4 Scalability verdict

As specified for smallholder cooperatives, HarvestLock does not scale: seasonal frequency fails P3, ticket size cannot carry high-touch verification, and each new region needs a new warehouse partner and new legal ground. It scales only along one axis — **larger, institutional, repeat counterparties**. Every independent line of evidence gathered points there: the P3 precondition, the unit economics, the BanQu and AgriDigital success pattern, and the pivots the Nigerian agritech survivors actually made.

---

## Fourth-round edge cases

The §7 table was written for the cooperative-and-wholesaler model. The §13 pivot to an institutional
      off-taker invalidated some of its assumptions and introduced a class of risk it never contemplated. This
      section covers what §7 misses, grouped by origin. Two findings are severe enough to change the design
      rather than the risk register.

### 16.1 Legal and identity — the two severe ones

| Case | Severity | Handling |
|---|---|---|
| **On-chain personal data breaches NDPA** | **[DESIGN]** | NDPA 2023 s.34 gives a right to erasure that an immutable ledger cannot satisfy, and GAID 2025 speaks to decentralised ledgers directly. **Resolved in §4.8** — salted hashes on chain, wipeable identity map off chain. Had this surfaced after launch it would have meant migrating live contracts |
| **SIM swap defeats phone-as-identity** | **[DESIGN]** | The SDP phone-provisioned wallet is this document’s primary “why Stellar” justification, and it rests on a channel where NIBSS recorded a **300% rise in SIM-swap fraud between 2022 and 2024**, with SIM swap reaching up to 43% of mobile-money fraud in comparable African markets. Mitigation is now available and must be a hard requirement: screen against the **CBN–NCC Telecom Identity Risk Management Portal** (TIRM, agreed April 2026) for recycled, swapped or blacklisted numbers before *any* disbursement, plus a mandatory cooling-off window after a SIM change, and no disbursement to a number changed inside the current contract cycle without co-signer re-attestation |
| **Shared handsets** | High | Rural households routinely share one phone. One number cannot be one wallet identity for three farmers. Requires either per-member PIN over a shared number, or falling back to cooperative-mediated distribution for those members — Rung 1 of §4.9 handles this gracefully, which is a further argument for starting there |
| **Number recycling** | High | Nigerian operators recycle dormant numbers. A recycled number silently transfers wallet control to a stranger. TIRM screening covers this; without it, seasonal gaps between contracts are exactly when dormancy triggers recycling |
| **Withholding tax on split payments** | Medium | Automated per-farmer payment may create withholding obligations for the off-taker, now under a revenue authority explicitly named in the July 2026 coordination order. An off-taker’s tax function can veto the whole integration. Must be raised in the first commercial conversation, not the last |

### 16.2 Introduced by the institutional-anchor pivot

These did not exist in the cooperative-and-wholesaler model. They are the cost of the §13 fix.

| Case | Handling |
|---|---|
| **The off-taker does not want transparency** | The sharpest of these. If procurement agents take undocumented margin, or the buyer prefers no written record of farm-gate prices paid versus market, then member-level transparency is a *threat* to the customer, not a feature. This is §4.9’s political problem moved one level up, where the party who dislikes it is also the one paying. Test it explicitly in the A1 conversation rather than assuming enterprise buyers want daylight |
| **Counterparty concentration** | One off-taker is simultaneously the customer, the revenue, and the counterparty to most contracts. Losing them ends the business, not just a contract. Strictly worse than the warehouse dependency in §7, and needs a named second prospect before the first goes live |
| **Enterprise procurement cycle** | Vendor onboarding at a brewery or multinational mill runs 6–18 months and demands insurance, SLAs, security review, data-processing agreements, sometimes certifications. A two-person team on a testnet build may simply fail vendor qualification. This is a runway risk a grant timeline does not accommodate |
| **Treasury policy forbids stablecoin** | A multinational’s group treasury may prohibit crypto-asset settlement outright regardless of local legality, and Nigerian FX and repatriation constraints make them conservative. The off-taker may be willing but institutionally unable. Ask for the treasury policy early — a “yes” from procurement is not a “yes” from treasury |
| **ERP integration is mandatory, not optional** | Large off-takers run SAP or Oracle. Procurement, goods receipt and payables must reconcile. That integration is real engineering, entirely absent from §6, and probably larger than the escrow contract itself |
| **Off-taker insolvency mid-season** | Escrow protects the deposit; it does not protect the unpaid balance or the advance already disbursed. Concentration makes this systemic rather than isolated |

### 16.3 Protocol and mechanism

| Case | Handling |
|---|---|
| **Contract upgradeability contradicts the non-custodial claim** | A live bug in a deployed escrow holding season-long funds must be fixable; but an upgrade key is exactly the unilateral control §4.5 promises does not exist, and a regulator will read it that way. Unresolved tension. Least-bad answer: no upgrade key, formally verified release paths, an audit before mainnet via the SCF Audit Bank subsidy, and a documented migration requiring both counterparties’ signatures rather than HarvestLock’s |
| **Oracle stale or unavailable at settlement** | Settlement converts an NGN obligation at the oracle rate. If Reflector is stale or down, settlement must not silently use a bad price. Requires a staleness bound, a hold state when breached, and a named manual fallback — none currently specified |
| **Stablecoin depeg or issuer failure** | §4.2 notes NGNC issuer concentration but assigns it no handling. A depeg between lock-in and settlement transfers real loss to whichever side holds the escrowed asset. Needs a depeg threshold that pauses settlement and a stated loss-allocation rule agreed at lock-in |
| **Allocation rounding remainders** | Splitting an indivisible balance across 200 members leaves a remainder. Unspecified remainder handling either strands value or silently favours whoever is last in the list. Name the policy — largest-remainder to the cooperative account, disclosed — rather than letting integer division decide |
| **Member dies or leaves between lock-in and settlement** | Allocation is immutable post-lock-in, so their share still computes. No rule exists for whether it goes to an estate, reverts to the cooperative, or is redistributed. Needs a stated default in the onboarding agreement |
| **Member listed in two cooperatives** | Double-counting across concurrent contracts, and a route to inflating committed quantity beyond real yield. Requires a cross-contract uniqueness check on the hashed reference |

### 16.4 Physical and warehouse

| Case | Handling |
|---|---|
| **Receipt double-pledging** | The historic failure mode of African warehouse receipt systems: the same grain pledged to a HarvestLock contract and to a bank loan simultaneously. A single operator’s e-WRS prevents this internally; nothing prevents it *across* systems. Requires the operator to flag lien status on attestation, and a policy of refusing receipts already encumbered |
| **Quality degrades in storage** | Grade is fixed at intake, but settlement may occur weeks later. Moisture, pests and aflatoxin can move grain between grades. Whoever bears that loss must be stated at lock-in — currently silent, and it sits precisely on the seam between the operator’s liability and the buyer’s |
| **Partial withdrawal before settlement** | A cooperative under cash pressure withdraws part of the deposited lot. Settlement then references grain no longer present. Attestation must be against a locked, non-withdrawable lot for the contract’s duration |
| **Warehouse at capacity in peak season** | Everyone harvests at once — the same seasonality that causes the price crash causes storage contention. A contract that cannot deliver into a full depot fails through no party’s fault. Needs pre-booked capacity as part of the operator agreement, not assumed availability |

> **What this round says about the process**
>
> Two of these — NDPA and SIM swap — were latent in the design since v0.3 and survived three prior audits
>       because every round scrutinised *strategy* and none scrutinised *implementation legality*. Both
>       would have been caught by a Nigerian data-protection lawyer or a payments engineer in a single conversation.
>       That is the strongest available argument for the co-founder in Open Question 09 and for counsel in 04: this
>       document’s blind spots sit systematically where its author has no domain reflex, and no amount of further
>       self-audit finds them.

---

## Implementation stack

Choices below are decisions, not options. Each is driven by the same constraint: a two-person team
      has to reach *mainnet with demonstrated UX readiness*, which is where 40% of SCF funding sits.
      Nothing here optimises for throughput, because there is no throughput problem — this is low-volume,
      high-value settlement.

| Layer | Choice | Why this one |
|---|---|---|
| **Contracts** | Rust · `soroban-sdk` | Not a choice. Soroban is Rust/WASM. Budget a real audit before mainnet and claim the SCF Audit Bank subsidy for it |
| **API service** | TypeScript / Node · `@stellar/stellar-sdk` | Language unification with the frontends is worth more to a two-person team than Go’s runtime advantages. Best-documented Stellar client SDK. See the Go question below |
| **Database** | PostgreSQL | Effectively mandatory after §16.1: NDPA erasure requires a wipeable off-chain identity store, and the hash-to-member map must be relationally sound or the allocation ledger means nothing. Encrypt PII columns at rest. SDP uses Postgres too — one engine covers both |
| **Disbursement** | Stellar Disbursement Platform, **deployed as-is** | SDP is Go. Deploy it and call its HTTP API and you never write Go. **Do not fork it** — that commits a scarce person to a Go codebase you do not control. If you find you must fork, treat that as a signal to re-examine whether SDP fits at all |
| **Cooperative UI** | React + Vite, PWA | Service worker plus IndexedDB for the §7 offline queue. SvelteKit ships smaller bundles, which genuinely matters on rural 3G — but React wins on the Lagos hiring pool, and you are recruiting a co-founder. Take the hiring pool |
| **Buyer UI** | Plain desktop web app | They are at a desk on good connectivity. Can be heavier, and eventually has to speak to their ERP (§16.2) |
| **Farmer channel** | **SMS only. No app.** USSD as the richer fallback | P3 and the shared-handset case together settle this: someone who touches the system twice a year will not install, retain, or re-authenticate into anything |
| **SMS gateway** | Termii | Africa’s Talking has the nicer pan-African API, but Nigeria’s DND registry silently eats transactional SMS and Termii handles it materially better. Deliverability beats API ergonomics when the message *is* the product for your largest user group |
| **Identity screening** | TIRM, via a licensed partner if direct access is refused | Hard requirement before any disbursement (§16.1). Open Question 12 is whether it can be accessed directly |

### 17.1 The Go question, settled

Go is tempting because Stellar’s own infrastructure is Go — Horizon, and SDP itself. The question
      reduces to one thing: **do you fork SDP or merely deploy it?** Deploy it and call its API, and Go
      never enters your codebase. Fork it and you have committed one of two people to maintaining a Go service.

Deploy. Do not fork. Everything else is TypeScript and Rust, which is two languages for two people —
      already the practical ceiling.

### 17.2 What actually runs

```
Soroban contract (Rust/WASM) ......... one instance per commitment, on Stellar
HarvestLock API (TypeScript) ......... contracts · allocation · vouchers · attestation intake
PostgreSQL ........................... app state + off-chain identity map (wipeable, encrypted)
SDP (Go, unmodified) + its Postgres ... phone-provisioned wallets, split payout
Termii ............................... SMS to members and cooperative
Cooperative PWA (React/Vite) ......... offline queue, phone auth
Buyer web app ........................ desktop, ERP integration later
```

### 17.3 Build order

**A caveat that matters more than the stack.** §10 Phase 0 says test A1 with three buyers
      *before anything is built*, and that still holds — if buyers will not commit ahead, no amount of
      correct engineering saves the structure. But one piece is worth building *in parallel* with those
      conversations, because it is not wasted under any outcome:

**Build the escrow contract on testnet while you are testing A1.** It is the highest-technical-uncertainty
      piece, it is needed whichever counterparty type you land, and a deployed contract or working MVP is exactly what
      reaches **Builder tier** and therefore Instawards (§11). It is the one build task that pays off even
      if A1 fails.

| SCF tranche | Build |
|---|---|
| **MVP** 20% | Soroban escrow on testnet implementing the §4.8 state machine — lock-in, two claimable-balance advance tranches, adjusted settlement. Minimal TypeScript API. One counterparty pair, one flow, end to end. No UI polish |
| **Testnet** 30% | Allocation ledger with per-contract salted hashing (§4.8). Off-chain identity map with a working erasure path. Receipt attestation intake. SDP integration and first split payout. Reflector read with a staleness bound and hold state (§16.3). Key recovery flow |
| **Mainnet + UX** 40% | Contract audit cleared. Cooperative PWA with offline queue. SMS notification in Yoruba, Hausa and Igbo. TIRM screening before disbursement. Onboarding flows a non-crypto-native cooperative lead can complete unaided — this is what the tranche is actually gated on, not deployment |

### 17.4 First week, concretely

- Rust toolchain and `stellar-cli`; testnet account funded via friendbot.
- Contract skeleton with the §4.8 states as an enum and the three release events as stubs. Get one lock-in and one advance tranche passing a test before touching anything else.
- Postgres schema with the identity map as its own table, separable and deletable independent of contract state — design the erasure path in on day one rather than retrofitting it.
- Salt strategy decided and written down: per contract, never a bare hash of a phone number.

> **Resolve before choosing a hosting region**
>
> NDPA restricts cross-border transfer of personal data, and the off-chain store holds identifiable farmer
>       data. That may constrain you to Nigerian or adequacy-jurisdiction hosting. Settle it with the same counsel
>       handling Open Question 11 — discovering it after building on the wrong region is an expensive migration
>       of exactly the data you are least free to move.

---

## Appendix A: Review audit

What the review that produced this version got wrong or overstated, recorded so it does not get quietly absorbed as settled.

1. **"The blockchain is decorative; native multisig would do."** Overstated. True of v0.2's escrow as scoped; false of tranched release, proportional adjustment, allocation splitting, and assignment. Corrected in §4.3.
2. **"Use SDP for farmer payouts."** Directionally right and better-supported than I knew — SDP provisions wallets from a phone number via SMS, removing the blocker I assumed existed. But I missed two frictions: it requires a **wallet-provider agreement** before disbursing, and more importantly it **removes the cooperative lead's control over money**, which is a political adoption risk, not a technical one. Hence the ladder in §4.9 rather than direct payment on day one.
3. **"Instawards is your first money."** Right destination, wrong timeline. It requires Builder tier in an Ambassador chapter. Corrected in §11.
4. **"Stop being a signer."** Correct as a target, naive as a v1 requirement — a pilot with one partner may have no alternative. Reframed as a staged, disclosed position in §4.5.
5. **Missed entirely: FX denomination mismatch.** The most consequential omission. A USDC-denominated forward silently imposes FX risk on both parties, and buyer-side exposure may deter participation more than price risk does. §4.2.
6. **Missed entirely: idle capital cost.** At Nigerian rates above 20%, a six-month lock on 30–50% of contract value is expensive and materially weakens the buyer proposition.
7. **Missed entirely: the commodity price oracle gap.** Reflector solves the currency half of "rate checker," not the commodity half. No on-chain source exists for Nigerian farm-gate prices. §4.4.
8. **Missed entirely: key management.** Seed phrases for low-literacy users, and lead death or incapacity over a multi-month cycle. §4.6.
9. **"Drop the marketplace" was presented as a free win.** It is not. It sacrifices the original founding thesis — farmers reaching better-paying buyers they could not otherwise access. Right for v1 sequencing, but a real cost, and worth re-examining at Phase 4.
10. **The buyer-first "supply assurance" reframe risks overselling.** Crop failure means supply cannot be guaranteed. The honest pitch is better odds, verified grade, and recourse — not assurance.

### Second audit round — what v0.3 itself got wrong

Findings from auditing v0.3 against the literature and the current market. These produced §13–§15.

1. **v0.3 had no business model.** Neither did v0.2. Two full PRD revisions with no revenue line, while claiming readiness for a funding programme that grades sustainability. §14.
2. **P3 was never considered.** Seasonal agriculture cannot generate the transaction frequency that blockchain deployments in this sector empirically require. This is a structural mismatch between the product and the technology, and no amount of contract design fixes it — only a different counterparty does. §13.
3. **The uniqueness claim was too broad.** I asserted that member-level transparency on Stellar was unfilled. Hiveonline has been running digital cooperatives on Stellar since well before this document, at ~18,400 users. The real uniqueness is a narrow combination, not a category. §15.1.
4. **Warehouse anchoring was justified for the wrong reason.** v0.3 chose it to offload field operations. Its more important function is supplying P2 — it is the only credible enforcement backstop reachable by a rural cooperative. Right decision, shallow rationale.
5. **The WRS literature partly contradicts the design.** Research on African warehouse receipt systems argues against blindly replicating commercial-warehouse models, recommending community warehouses and *less* emphasis on grading. v0.3 bets on commercial warehouses with professional grading as the centrepiece. AFEX's 45-warehouse operation is evidence the commercial model works in Nigeria specifically, but this tension is unresolved and needs field validation rather than an armchair verdict.
6. **Defection risk is two-sided and was treated as one-sided.** v0.3 devoted its enforcement design to side-selling. In the current falling market the live risk is the buyer walking, and deposit sizing should be calibrated to that instead. §15.2.
7. **Cooperatives were assumed to be a trust backbone.** The literature notes they are weak or absent in many communal areas. Routing everything through them — the foundational choice inherited from v0.2 — rests on an institution that may not be load-bearing.
8. **AFEX's current financial position is unverified.** Its last disclosed raise was a 2023 seed round, with British International Investment among backers. No adverse 2026 news surfaced, but making a single partner the architecture's keystone without confirming its health is exactly the dependency §7 warns about. *Partly resolved in round three — AFEX is healthy and expanding, which is good for partnership and bad for competitive risk.*

### Third audit round — external review

An external reviewer challenged four load-bearing facts in v0.4. Three were wrong, one was a mischaracterisation in my favour, and verifying them surfaced a fifth error I had made in the opposite direction. Facts were re-checked against primary sources rather than accepted on either side's authority.

1. **The ₦2bn capital requirement was wrong, and wrong in the direction that made the project look worse.** I conflated the binding January 2026 SEC circular with the August 2026 draft rules and applied the exchange-and-custodian tier to a non-custodial escrow platform. The reviewer was right to challenge it, though their tier figures came from the draft while the circular's differ. Corrected in §4.5 — the realistic exposure is roughly an order of magnitude lower, and the ₦30m registration fee and 25% fidelity bond had never been costed at all.
2. **The AFEX warehouse count was four years stale, and understated by more than the reviewer suggested.** "Roughly 45" is a 2020 figure; the 2024 position is 200+ warehouses and 500,000+ farmers across three countries, with *TIME*100 recognition and DFI-funded expansion into eight more. This does not change the strategic conclusion but it materially worsens the competitive risk, which §4.1 now says.
3. **The Hiveonline figure was also understated.** ~50,000 farmers and savings-group members across six countries, not 18,400 in two. Their SMS-receipt credit-record mechanism is closer to this document's allocation ledger than v0.4 admitted. §15.1.
4. **I over-corrected on Instawards.** v0.4 "corrected" my earlier advice by claiming Builder tier required a long social progression. Builder eligibility is technical — deployed contracts, a working MVP, or contributions to an SCF-funded project. The original advice was closer to right than the correction. An error introduced while fixing an error is worth naming as its own failure mode.
5. **The SCF tranche structure and Instawards mechanism verified clean** against the primary source. The Integration Track traction requirement is *contested* between the handbook and the launch blog; §11 now says so rather than asserting it.
6. **The reviewer's strongest point was not a fact at all.** The institutional-anchor pivot changes the project from market access to B2B infrastructure inside a relationship that already exists — and no prior version admitted it. This is now §15.3, along with two consequences the reviewer did not draw: the revenue model inverts in the project's favour, and the pivot moves toward BanQu's occupied ground rather than away from it.

> **A pattern across three audit rounds**
>
> Every round has ended at the same destination by a different route: larger, institutional, repeat counterparties. Round one reached it through unit economics, round two through the P3 precondition, round three through the identity of the customer. Three independent derivations of one conclusion is not redundancy — it is the strongest signal this document contains, and it should be acted on rather than re-litigated in a fourth round.
