# HarvestLock — Execution Roadmap

This is the operational companion to PRD §10 (phase-level roadmap) and §17
(implementation stack and build order). Where those sections say *what* and
*why*, this document says *when* and *in what order*, at a granularity you
can actually work from week to week.

**How to use this**: work top to bottom, but Phase 0's tracks run in parallel,
not sequentially — that's the point of them. Check off items as you go. When
a task references a PRD section, that's where the reasoning lives; don't
re-litigate it here.

**One rule that overrides everything else below**: if the A1 buyer
conversations (Track A) come back negative — three buyers decline forward
commitment — stop and re-read PRD §15.3 and the Appendix A audit trail before
continuing any other track. Everything downstream of Phase 0 assumes A1 holds.

---

## Week 0 — This week

Setup, not building. Target: end of this week, everything below is done and
Phase 0 Week 1 can start clean.

- [ ] **Create the GitHub organization.** GitHub's API has no endpoint for
      this — it has to go through the web signup flow (plan selection).
      Go to `github.com/organizations/new`, choose the **Free** plan, name it
      `agrisettle` (confirmed available as of this writing). The product
      itself stays named HarvestLock — the org is the broader umbrella
      (PRD Phase 3/4 already plans lending and insurance work beyond this
      one product). Takes about 2 minutes.
- [ ] Once the org exists, create the repo under it and push this scaffold —
      see the exact command at the bottom of this file.
- [ ] **Submit the SEC comment.** PRD §4.5 — the comment window on Nigeria's
      draft digital-asset rules closes **3 September 2026**. This is the
      single most time-sensitive item in the entire roadmap and costs under
      an hour. Ask specifically how a non-custodial escrow platform that
      never holds keys or fiat should be categorised. Send to the Rules
      Committee per the contact in the draft notice. Do this before anything
      else on this list except the org/repo.
- [ ] Open a Stellar Ambassador chapter conversation (Lagos/Nigeria chapter).
      This has lead time — PRD §11/§17 — so starting the relationship now
      matters more than any single deliverable this week.
- [ ] Draft the co-founder search. PRD Open Question 09 is blocking for both
      SCF Kickstart eligibility and for the actual workload. Write down what
      you're looking for (Rust/Soroban leaning, or full-stack with appetite
      to learn Soroban) before you start conversations, so you're not
      improvising the pitch each time.

---

## Phase 0 — Validation (target: ~10 weeks)

Two tracks run at the same time. Track A can kill the project; Track B cannot
be wasted even if Track A kills it (PRD §17.3).

### Track A — Is there a real buyer? (weeks 1–8)

This is Assumption A1 (PRD §8), and it is ranked first because it's both the
most likely to be false and the most fatal if it is.

- [ ] **Week 1–2**: Identify 5–8 candidate institutional off-takers per PRD
      §13's finding — a brewery, flour mill, feed producer, or exporter with
      an *existing outgrower programme*. Existing programme is not optional:
      it's what supplies P2 (enforcement backstop) and P4 (pre-existing
      trust) for free. Cold-searching for a buyer with no outgrower history
      defeats the point of the pivot.
- [ ] **Week 2–4**: Get in front of 3+ of them. The conversation is not a
      pitch — it's a test. Ask directly: would you lock in price and pay a
      deposit months before delivery, against your current spot-buying
      status quo? Record declines **verbatim with reasons** (PRD §9) — a
      decline is data, not a failure.
      - Listen specifically for whether the real interest is *price*
        (weak signal — see PRD §15.2, buyers currently have every reason to
        wait in a falling market) or *supply assurance / grade certainty*
        (strong signal, and the more defensible pitch per PRD §15.1).
      - Ask about their outgrower programme's current pain points directly —
        side-selling, grade disputes, payment reconciliation. This tells you
        whether the product's actual value (transparency, programmable
        settlement — PRD §15.3) lands, independent of the forward-pricing
        pitch.
      - Ask whether farmer-level payment transparency is something they
        want or something they'd resist (PRD §16.2 — this can go either
        way and you need to know before designing anything further).
      - Ask about their group treasury's stance on stablecoin settlement.
        A "yes" from procurement is not a "yes" from treasury (PRD §16.2).
- [ ] **Week 6–8**: Decision gate. Do you have at least one off-taker
      willing to pilot? If yes, continue to Track A's back half below. If
      no after 5+ real conversations, stop and reassess against PRD §15.3
      and Appendix A before spending more time on Track B.
- [ ] **Week 8+ (if a buyer is willing)**: Identify the warehouse operator
      for their region/crop. PRD Open Question 01 is blocking — the
      architecture has no fallback if no operator will partner. Approach
      with the pre-planting/transparency/cross-border/programmability wedge
      from PRD §4.1, not with "we want to build what you already do."
      Listen for whether they intend to build the forward-commitment layer
      themselves — that's a redirect signal, not a rejection to push past.
- [ ] Get a written (even informal, email-level) indication of interest from
      one off-taker and one warehouse operator before Phase 1 starts. This
      is the pre-existing counterparty requirement the whole architecture
      depends on (PRD §3, §13 P4) — don't start building the pilot-facing
      parts of the product without it.

### Track B — Build the contract (weeks 1–10, in parallel)

This does not wait on Track A's outcome (PRD §17.3) — it's needed whichever
counterparty type you land on, and a deployed testnet contract is what
reaches **Builder tier** for Instawards eligibility.

**Live status lives in [`HarvestLock-Contracts/HANDOFF.md`](https://github.com/Agrisettle/HarvestLock-Contracts/blob/main/HANDOFF.md)
— check that file for the current as-built state, not just these
checkboxes.** They'll drift; HANDOFF.md is maintained to stay accurate.

- [x] **Week 1**: Toolchain. Rust already present; `stellar-cli` install via
      `cargo install` **failed on this machine** (needs `dlltool.exe` /
      MinGW binutils, not installed, and not worth chasing) — worked around
      by grabbing the prebuilt `x86_64-pc-windows-msvc` binary from the
      GitHub release instead. `stellar contract build` producing real WASM
      confirmed working. Testnet identities generated and funded.
- [x] **Week 1–2, and further**: Contract skeleton went beyond the minimum
      here — the **full happy-path state machine is implemented** (`Draft`
      through `Settled`, all 7 states), not just `Draft → Locked →
      Advance1Released`. 9 tests passing. **But** the advance tranches are
      plain immediate transfers once the state-guard permits them, **not**
      the claimable-balance-with-expiry mechanic this bullet originally
      called for — that's real remaining work, tracked in HANDOFF.md's
      "next steps," not done. Don't mark the claimable-balance piece
      complete just because this checkbox is checked.
- [x] **Week 3–4**: Claimable-balance-with-expiry for the advance tranches.
      **Done.** `claim_advance_1/2` (cooperative-gated) pay within the
      window; `reclaim_advance_1/2` (buyer-gated) return funds once it
      lapses; `settle` refuses to run until both tranches are resolved
      one way or the other. This last part exists because self-audit
      caught a real fairness bug in the first draft — see HANDOFF.md's
      design-decisions section, it's worth reading even if you're not
      touching this contract, as an example of the kind of thing to
      watch for elsewhere. 30/30 tests passing (as of 1 Sept 2026 — 24
      at claimable-balance, 6 more since for mutual cancellation, below),
      verified live on testnet including the negative case (an on-chain
      rejection, not just a local one).
- [x] **Week 4–5**: Allocation ledger. **Done**, built 4 Sept 2026 — went
      further than this bullet's own ask: **per-member** salted hashes
      (`HMAC-SHA256(salt, phone_number)`, a fresh random salt per member),
      not just per-contract. `set_allocation`/`get_allocation`,
      cooperative-gated, one-time, record-only per PRD §4.9's own stated
      v1 default. The off-chain salt+phone-number map lives in the API's
      Postgres (`allocation_members` table) with a real NDPA s.34 erasure
      endpoint — deleting that row makes the on-chain hash permanently
      unlinkable, which is what the "different contracts, different
      hashes" test this bullet asked for actually verifies. 9 new contract
      tests, live-verified on testnet (Deployment 7).
- [x] **Week 5–6**: Settlement logic. **Mostly done, one piece deliberately
      still open.** Warehouse receipt attestation + the shortfall/grade
      adjustment schedule: **done**, 3 Sept 2026 — `confirm_delivery` takes
      delivered quantity and grade, `settle` pays out against the computed
      `settlement_bps`. The oracle staleness bound (PRD §16.3): **done**,
      5 Sept 2026 — `oracle_rate()` reads a live Reflector quote and
      refuses a stale or missing one, live-verified against Reflector's
      real testnet oracle. **Still open**: converting the NGN obligation to
      stablecoin *in `settle`'s actual payout math*, and a hold state that
      blocks settlement on a stale quote specifically — not an oversight,
      PRD §4.2 names three different options for who bears the FX risk
      between lock-in and settlement and says explicitly to decide that
      with pilot partners, not assume it; wiring one in unilaterally would
      be answering on their behalf. Also genuinely blocking, found rather
      than assumed: Reflector's real testnet oracle doesn't quote NGN at
      all yet. See `HarvestLock-Contracts/HANDOFF.md`'s Deployment 8.
- [x] **Week 6–7**: Assignability. **Done**, built 2 Sept 2026 as
      `reassign_buyer()` — buyer position transfer, recorded on chain
      (PRD §4.8). Went one signer further than "with cooperative consent"
      alone requires: outgoing buyer, cooperative, *and* incoming buyer all
      co-sign, so a position (and its obligations) can't be handed to a
      third party who never agreed to take it on. Deliberately not a
      market — no order book, no listing, just a novation. 34/34 tests,
      live-verified on testnet with three genuinely different signers.
- [x] **Week 7–8**: Regression tests for the edge cases. **Done** — partial
      delivery and over-delivery via `confirm_delivery`'s `settlement_bps`
      math (3 Sept 2026, live-verified); buyer default and side-selling
      (seller non-delivery) forfeiture via two-phase funding plus
      `expire_remainder_window()`/`reclaim_on_nondelivery()` (2 Sept 2026,
      58/58 tests, three-scenario live testnet verification). Mutual
      cancellation unwind is **also done** — `cancel()`, buyer+cooperative
      co-signed, shipped and testnet-verified 1 Sept 2026 (ahead of this
      week's original slot, once it was genuinely ready) — this bullet
      used to include it, it no longer does.
- [ ] **Week 8–10**: Get this reviewed by someone who isn't you before
      calling it done, even informally. This is the highest-stakes code in
      the whole system.

### Track C — Regulatory (parallel, lower weekly effort)

- [ ] Engage Nigerian counsel on: (a) which capital tier a non-custodial
      escrow platform actually falls under once the SEC's rules are
      finalized, not the draft (PRD Open Question 04); (b) whether the
      non-recoverable advance mechanism reads as unlicensed lending; (c)
      whether the salted-hash allocation design actually satisfies NDPA
      s.34 and GAID 2025 (PRD Open Question 11 — added after the §16.1
      finding, don't skip this one, it's a design-validating question, not
      a formality).
- [ ] Track CBN Regulatory Sandbox Cohort 3 timing (Cohort 2 closed
      31 August 2026 — too soon to have applied credibly). Read Cohort 2's
      published eligibility criteria now as a specification for what
      Cohort 3 will likely require.
- [ ] Determine whether TIRM (the CBN–NCC telecom identity risk portal) is
      directly accessible or only through a licensed bank/wallet partner
      (PRD Open Question 12). This gates whether SIM-swap screening — a
      hard requirement per PRD §16.1 — is buildable in-house or has to be
      contracted.
- [ ] Resolve the hosting-region question with the same counsel handling
      NDPA compliance, before committing infrastructure to a region (PRD
      §17, closing note).

### Phase 0 exit criteria

Move to Phase 1 only when **all** of these are true:

- [ ] At least one off-taker has given a written (even informal) indication
      of willingness to pilot.
- [ ] At least one warehouse operator in that off-taker's region/crop has
      indicated willingness to attest deliveries.
- [x] The Track B contract handles the full state machine on testnet with
      passing tests for the core edge cases. **Met** — see Track B above:
      86/86 tests, eight live testnet deployments covering the happy path,
      mutual cancellation, assignability, buyer-default and
      seller-non-delivery forfeiture, shortfall/grade adjustment, the
      allocation ledger, and the oracle staleness bound. This is one
      criterion of several on this list — the others (off-taker,
      warehouse operator, co-founder, counsel) are separate,
      still-open, non-technical milestones this file can't mark done on
      its own.
- [ ] A co-founder is either onboard or in late-stage conversation.
- [ ] Counsel has given at least a preliminary read on the lending-
      characterization and NDPA questions — a full opinion isn't required
      to proceed, but an unaddressed red flag is a stop condition.

If Track A fails and no off-taker will commit after a genuine search, do not
proceed to Phase 1 on the strength of Track B alone — re-read PRD §15.3.
A working contract with no counterparty is not a pilot.

---

## Phase 1 — Testnet build

This maps directly onto PRD §17.3's SCF tranches. Each tranche is a real
funding gate, not just an internal milestone — target them explicitly.

### MVP tranche (SCF: 20%)

- [x] Track B's escrow contract, deployed and exercised on testnet. **Done**
      — happy path only (no claimable-balance expiry, no allocation ledger,
      no real attestation-driven settlement yet; see
      [`HarvestLock-Contracts/HANDOFF.md`](https://github.com/Agrisettle/HarvestLock-Contracts/blob/main/HANDOFF.md)
      for exactly what that means). Contract address in that file's
      "Verified on testnet" section — treat it as a validation artifact,
      redeploy fresh rather than building on top of that specific instance.
- [x] Minimal TypeScript API: create a contract instance, lock it in,
      trigger the two advance tranches, trigger settlement. No auth, no UI
      polish, no multi-tenant anything — one hardcoded counterparty pair,
      one flow, end to end. **Done, 1 Sept 2026** — went further than this
      bullet's original scope, too: every lifecycle method including
      mutual cancellation (two-party auth), not just the two named here.
      Testnet-verified at both the SDK and HTTP layers. See `api/HANDOFF.md`.
- [ ] This is the point at which you have a "deployed contract or working
      MVP" — **this condition is now clearly met** (contract and API both
      real and testnet-verified, not just the contract as when this was
      last written); the remaining action is checking Builder tier /
      Instawards eligibility (PRD §11) and applying if so — that's a human
      step this file can't mark done on its own.

### Testnet tranche (SCF: 30%)

- [x] Full allocation ledger with the salted-hash design live, not stubbed.
      **Done**, 4 Sept 2026 — live on testnet (Deployment 7), not a stub.
- [x] Off-chain identity map in Postgres with a **working, tested erasure
      path** — actually delete a record and confirm the on-chain hash
      becomes unresolvable. **Done**, 4 Sept 2026 — `allocation_members`
      table, `DELETE /allocation-members/:memberHash`, verified end to end
      through the real HTTP layer: build → sign → submit → on-chain read →
      off-chain Postgres read → erase → on-chain read confirmed
      unaffected (the hash persists on chain, exactly as intended — it's
      the off-chain salt+phone-number mapping that's gone, which is what
      actually makes it unresolvable to a real person).
- [ ] Warehouse receipt attestation intake — even a simple authenticated
      webhook or form the operator's staff can use, doesn't need to be
      polished. **Still open**: `confirm_delivery` itself is built and
      live-verified, but nothing in `coop-pwa`/`buyer-app` gives the
      warehouse operator a form to call it from — it's reachable only via
      a direct API call today.
- [ ] SDP integration: deploy (do not fork, PRD §17.1) SDP, get one real
      phone-number-provisioned wallet, execute one split payout to it.
- [x] Reflector integration with the staleness bound built in Track B, now
      wired to live testnet data. **Done**, 5 Sept 2026 — `oracle_rate()`
      made a genuine cross-contract call to Reflector's real testnet fiat
      oracle and got back a live rate, not a fixture (see Track B above
      for the full writeup, including the real "Reflector doesn't quote
      NGN yet" finding). **The "hold state" half of this bullet's original
      ask is still open** — there's no state-machine gating that blocks
      settlement on a stale quote, since `settle` doesn't consume
      `oracle_rate` at all yet (a deliberate pilot-partner decision, not a
      gap in this pass — see Track B).
- [ ] Key recovery flow: exercise it once end to end — simulate a lost key,
      confirm the two-of-three social recovery set can rotate it.

### Mainnet + UX tranche (SCF: 40%)

This is explicitly gated on UX readiness, not just deployment (PRD §11,
§17.3) — budget real time for the items in this tranche, they are not
afterthoughts.

- [ ] Contract audit. Use the SCF Audit Bank subsidy if eligible (PRD §1
      background, §17). Do not skip this to save time — it's the highest-
      leverage risk reduction available and partially subsidized.
- [ ] Cooperative PWA with the offline queue actually tested against a bad
      connection, not just simulated in dev tools.
- [ ] SMS notifications in Yoruba, Hausa, and Igbo, not just English — this
      was a "should have" in PRD §6 but becomes load-bearing once you're
      testing with a real non-crypto-native cooperative.
- [ ] TIRM screening (or its contracted equivalent, per Track C's finding)
      wired in before any disbursement — hard requirement, PRD §16.1.
- [ ] Onboarding flow tested with an actual non-crypto-native cooperative
      lead, unaided, watching where they get stuck. This is what the
      funding tranche is actually gated on.

---

## Phase 2 — Mainnet pilot

One crop, one region, one warehouse partner, closed cohort (PRD §10).
Transparency ladder starts at **Rung 1** (PRD §4.9) — payment settles to the
cooperative wallet, allocation is on-chain and readable, nothing about the
cooperative's operations changes. Moving to Rung 2 is a finding to observe,
not a target to hit on a schedule.

- [ ] Run the pilot against the PRD §9 success metrics, not against
      transaction volume or cooperative count (explicitly excluded there).
- [ ] Log every side-sell, shortfall, dispute, and key-recovery event
      regardless of outcome — these matter more for Phase 3 design than the
      clean successes do.
- [ ] Specifically watch for the two-sided defection risk from PRD §15.2:
      in the current falling maize market, buyer walk-away is the live risk,
      not farmer side-selling. Size deposits accordingly, and confirm or
      revise that assumption against what actually happens.
- [ ] Test whether the cooperative resists Rung 1 transparency (PRD §4.9) —
      if they do, that's a significant finding about where value is
      actually captured, worth more than a clean pilot.

---

## Phase 3 — Prove the loop

Second cooperative and operator. Move to Rung 3 of the transparency ladder
if Phase 2 supports it. Use assignability in a real transaction, not just in
tests. Multi-crop.

- [ ] Don't start this until Phase 2's metrics are in and reviewed — this
      phase exists to prove the pattern generalizes, which requires having
      actually observed the pattern once.

---

## Phase 4 — Build on proven trust

Tokenized receipts as tradable RWA, Blend-collateralized lending against
contracts (kept explicitly distinct from the non-recoverable advance
mechanism — PRD §10), parametric insurance, and only now reconsider the
marketplace that was cut from v1 (PRD §0, item 3) — if discovery is still
the unmet need by this point rather than trust and settlement.

---

## Ongoing, not phase-bound

- [ ] Stellar Ambassador progression (Explorer → Contributor → Builder).
      Started in Week 0; keep it moving in parallel with everything else —
      it's a relationship, not a task with a deadline.
- [ ] Re-verify every hard fact in the PRD against current sources roughly
      every quarter, especially anything regulatory. Three of the four
      audit rounds in PRD Appendix A found a stale or wrong fact — the
      Nigerian regulatory environment specifically is moving fast enough
      that a six-month-old citation is a liability, not a convenience.
- [ ] Revisit the assumptions table (PRD §8) after every phase, not just
      once. A1 through A8 are explicitly things to keep testing, not a
      checklist you clear once and move past.

---

## Once the org exists

```bash
cd /path/to/HarvestLock
git init
git add -A
git commit -m "chore: scaffold repo, seed roadmap and PRD pointer"
gh repo create Agrisettle/HarvestLock --public --source=. --remote=origin --push
```

Replace `--public` with `--private` if you'd rather the repo not be visible
before there's a pilot to show. Either is fine — a public org with a private
first repo is normal, and you can flip it later.
