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

**Create-commitment flow** (`src/components/CreateCommitmentForm.tsx`,
added 2 Sept 2026): deploy → build `initialize` → Freighter signs →
submit → load, gated behind a connected wallet (the buyer field comes
from that address, not the form). Client-side validation mirrors the
API's own `claim_window_secs` bounds and the advance-bps-sum-to-100%
rule so a bad value fails fast rather than round-tripping to find out.
This is the "real create commitment UX flow" `TASKS.md` had flagged as
unexercised by any frontend. Unlike lock/settle/claim, there wasn't even
a partial real-browser check possible for this one in this session —
the form is unreachable without a connected wallet, and no real
Freighter extension exists in this environment. What the flow's chain
operations actually do (deploy, initialize) is separately proven at the
API layer in `api/test/stellar.test.ts` against real testnet.

**Two-phase funding fields + Roles & Responsibilities consent** (same
file, added 2 Sept 2026, later same day, alongside the contract-side
default/forfeiture work — see `HarvestLock-Contracts/HANDOFF.md`): the
form now also collects `remainderWindowSecs` (default 7 days) and
`deliveryWindowSecs` (default 120 days), each validated client-side
against the same bounds `server.ts` enforces, mirroring
`claimWindowSecs`'s existing pattern. A required checkbox — "I've read
Roles & Responsibilities, including that missing the remainder-payment
deadline means an immediate, permanent bar" — blocks submission until
checked; this is enforced client-side only (the API has no way to know
whether a UI actually showed a buyer this), on the theory that *some*
disclosure gate belongs in the one flow that creates a commitment at
all, not that this one checkbox is a complete compliance story. The link
target (`site/roles.html`) is opt-in via `VITE_SITE_URL` — unset by
default, since there's no deployed site domain yet (same pattern as
`site/`'s own `useLiveStatus` hook); when unset, the checkbox label
degrades to plain, non-linked text rather than guessing a URL.

**Cancel this commitment** (`src/components/CancelSection.tsx`, added
2 Sept 2026, later same day again): the staged multi-party
propose/sign/finalize UX for `cancel()` — see `api/HANDOFF.md`. Either
party (buyer or cooperative) can propose; if the *other* party is
connected, they see "approve cancellation," which signs their own
Soroban auth entry via Freighter's `signAuthEntry` (a new `wallet.ts`
export, distinct from `signTransactionXdr` — this signs one auth entry,
not a whole transaction). Once both sides have acted, the proposer sees
"finalize cancellation," which classically signs the ready XDR and
submits through the same `submitTx` every other write uses. Polls the
active proposal every 10s while waiting on the other party, stops once
it's this viewer's own turn to act. Rendered inside `CommitmentDetail`
for any cancellable status (`Draft` through `ReadyForDelivery`, matching
`lib.rs`'s reachable range) when the connected wallet is a party to the
commitment; hidden otherwise. 7 new component tests (mocked wallet +
fetch, same conventions as the rest of this app) cover all three roles
(proposer waiting, approver signing, proposer finalizing) plus a
rejected-signature error path. Same honesty note as every other write
action here: no real, installed Freighter extension exists in this
environment, so `signAuthEntry`'s actual on-extension behavior hasn't
been manually verified, only the component logic against a mocked one —
the API side of this flow *has* been verified live end to end (see
`api/HANDOFF.md`).

**Propose reassignment** (`src/components/ReassignBuyerSection.tsx`,
added 3 Sept 2026): the same staged propose/sign/finalize shape as
`CancelSection.tsx`, for `reassign_buyer()` — see `api/HANDOFF.md`. Two
real differences: only the commitment's *current* buyer may propose (the
API rejects anyone else with 403, per PRD §4.8 framing reassignment as
the outgoing buyer's own decision), so the propose step here is a form
collecting the new buyer's address rather than a bare button; and there
are two pending signers, not one — the cooperative and the incoming
buyer. The incoming buyer isn't a party to the commitment at all until
they view it with a pending proposal — they're identified purely by
appearing in the fetched proposal's `pending_entries`, which stops
naming them the moment they've signed (the API only lists still-unsigned
entries). `justApproved` is local, per-session component state that
keeps a signer in the "waiting" state after they act without needing the
server to remember who they were; this deliberately doesn't survive a
page reload — an acknowledged gap, not an oversight. Rendered inside
`CommitmentDetail` for any reassignable status (same range as `cancel`'s)
when the connected wallet is the current buyer or a pending signer;
hidden otherwise. 7 new component tests, same conventions as
`CancelSection.test.tsx`'s. Same Freighter-extension honesty note as
every write action here applies — see above.

**Deferred**: auth, ERP integration (see above) — neither exists yet,
don't assume it does.
