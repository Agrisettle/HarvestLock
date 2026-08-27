# HarvestLock PRD — pointer

The authoritative PRD is a living document, not this file. Treat it as source of
truth over anything summarized below, which will drift out of date.

**Live document:** https://claude.ai/code/artifact/c9a2f2a6-b9f2-4218-b4e8-60651ddfbb5d

As of this commit it is at **v0.7** and covers:

| § | Content |
|---|---|
| 0–3 | What changed from the original concept, executive summary, problem statement, goals/non-goals |
| 4 | Architecture — warehouse anchoring, NGN/stablecoin denomination, why Stellar specifically, custody and regulatory posture, key management, contract design, staged disbursement |
| 5–9 | Users, feature list, edge cases, assumptions under test, success metrics |
| 10 | Roadmap (phase-level; see `../ROADMAP.md` in this repo for the execution-level version) |
| 11–12 | Funding path (SCF), open questions |
| 13–15 | Institutional preconditions self-assessment, business model and unit economics, uniqueness and scalability verdict |
| 16 | Edge cases from the institutional-anchor pivot, plus two design-changing findings: NDPA-compliant identifier storage, and SIM-swap risk to the phone-as-identity model |
| 17 | Implementation stack and build order mapped to SCF funding tranches |
| A | Full audit trail — four rounds of self- and external review, including everything the document previously got wrong |

## Why the PRD isn't just markdown in this repo

It's under active iteration with an external reviewer in the loop, and publishing
it as a document keeps that review cycle fast. Once the architecture stabilizes
past Phase 1 (testnet), pull a frozen copy into this repo as `docs/PRD-v1.0.md`
so the contract implementation has a fixed spec to build against rather than a
moving target.
