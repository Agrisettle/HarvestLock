# Security Policy

HarvestLock is pre-pilot software: no real funds, no real cooperative or
buyer has used it yet (see the Status section in [`README.md`](./README.md)).
That doesn't lower the bar for how a vulnerability report gets handled —
if anything it's the best time to find and fix one, before there's
anything real at stake. Take security issues seriously and report them
privately, not through a public issue.

## Reporting a vulnerability

Email **samuelojetunde898@gmail.com** with:

- What the issue is and where it lives (which repo, file, endpoint, or
  contract function)
- Steps to reproduce, or a proof of concept if you have one
- What you think the impact is (funds at risk, auth bypass, data
  exposure, etc.) — your own assessment is useful even if it turns out
  to be wrong

There's no dedicated security inbox or bug-bounty program yet — this is
a two-person team pre-pilot, matching this project's general bias
against building process ahead of real usage (see `HANDOFF.md`). You'll
get a human reply, not an automated one, and a rough sense of timeline
once the report's been read.

**Please don't open a public GitHub issue for a suspected vulnerability**
until it's been triaged privately first — this applies across all three
repos under [Agrisettle](https://github.com/Agrisettle): this one,
[`HarvestLock-Contracts`](https://github.com/Agrisettle/HarvestLock-Contracts),
and any others added later.

## Scope

Everything in this repo and in `HarvestLock-Contracts` is in scope:
the Soroban escrow contract, the API (`api/`), both frontends
(`coop-pwa`, `buyer-app`), and the public site (`site/`). The contract
is where a real bug has the highest consequence — it moves real
tokens once this reaches mainnet — so contract-level findings
(authorization bypass, fund-locking, incorrect settlement math) are
the highest priority to report.

Out of scope: findings that require a compromised private key already
in an attacker's possession (this project assumes keys stay private —
see `docs/PRD.md` §4.6 on key management), and issues in third-party
dependencies that don't have a HarvestLock-specific exploit path (report
those upstream instead).

## Supported versions

There's no versioned release yet — `main` on every repo is the only
thing that exists, and is what gets fixed. Nothing here is tagged or
deployed to mainnet.
