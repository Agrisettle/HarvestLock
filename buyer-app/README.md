# buyer-app

HarvestLock's buyer/off-taker dashboard. React + Vite + TypeScript,
desktop-first — this user is at a desk on good connectivity, unlike the
cooperative side. Same data as `coop-pwa`, framed around what a buyer
actually wants to know: what's locked, what's still pending, and whether
a commitment is ready to settle — plus, now, the ability to actually lock
a Draft commitment or settle a Delivered one, when a connected wallet is
entitled to.

Eventually needs ERP integration (SAP/Oracle procurement and payables
reconciliation, PRD §16.2) once there's an institutional off-taker in the
pilot; don't build that speculatively before one exists.

## Setup

```
npm install
cp .env.example .env   # only needed if the API isn't on localhost:3000
npm run dev
```

Needs `api/` running (`cd ../api && npm run dev`) and reachable at
`VITE_API_URL` (defaults to `http://localhost:3000`).

## What's real vs. deferred

Same shape as `coop-pwa` (see `../coop-pwa/README.md` for the fuller
writeup of what a real-browser check catches that `curl`/build checks
don't) — the two apps intentionally duplicate this small amount of read-
only UI code rather than sharing a package, since there's no monorepo
tooling set up yet and two ~150-line apps don't justify one. Revisit that
call if a third frontend shows up needing the same thing.

**Real**: read-only lookup + list against the API, buyer-framed —
`CommitmentDetail` leads with a plain-language "what's pending" summary
(`src/components/CommitmentDetail.tsx`'s `pendingSummary()`) instead of
just the raw tranche table `coop-pwa` shows first. Verified in a real
browser against the live API and live testnet data on 1 Sept 2026.
Automated tests (`npm test`) cover `pendingSummary`'s branches and
`App`'s fetch-mocked flows, same setup as `coop-pwa` — see that app's
README for the two real environment issues found getting it working
(forks-pool hang, Testing Library cleanup needing an explicit hook).

**Lock and settle write actions** (`src/wallet.ts`, `src/App.tsx`, added 2
Sept 2026): same build → Freighter signs → submit → refresh shape as
coop-pwa's claim-advance, via `primaryAction()` in `CommitmentDetail.tsx`
picking the applicable action from contract state rather than guessing
per screen. Worth knowing: `settle` has **no** `require_auth()` at all in
the contract — genuinely permissionless — so it's offered to any
connected wallet once a commitment is `Delivered`, not just the buyer;
tested explicitly with a third-party wallet address to prove that, not
just asserted. Same honesty note as coop-pwa: the API/component logic is
tested (17 tests), but no real, installed Freighter extension exists in
this environment, so actual wallet signing hasn't been manually verified
— what *was* found and fixed in a real browser is the "extension not
installed" hang (see `wallet.ts`), re-checked in this app specifically
rather than assumed to carry over from coop-pwa's identical fix.

**Deferred**: auth, ERP integration (see above) — neither exists yet,
don't assume it does.
