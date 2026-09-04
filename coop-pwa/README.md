# coop-pwa

HarvestLock's cooperative-facing dashboard. React + Vite + TypeScript.
Look up a commitment by contract ID, or pick one from the cached list, see
its status and advance-tranche claim windows straight from chain, and —
if a connected wallet matches the commitment's cooperative — claim an open
advance tranche, with the app shell installable and loadable offline and
a queue for claims that can't reach the network (see below). No auth yet
— deliberately deferred, see below.

Note what this app is *not*, even once it's further along: individual
farmers never get an app. They get SMS (and eventually USSD) only — PRD
§13 (P3) and §16.1 (shared handsets) both rule out an app for that user.
This dashboard is for cooperative staff, not farmers.

## Setup

```
npm install
cp .env.example .env   # only needed if the API isn't on localhost:3000
npm run dev
```

Needs `api/` running (`cd ../api && npm run dev`) and reachable at
`VITE_API_URL` (defaults to `http://localhost:3000`).

## What's real vs. deferred

**Real**: the whole read path. `GET /commitments` (cached list) and
`GET /commitments/:contractId` (live chain read) from the API, rendered
as a list + detail view. Verified in a real browser (Playwright, used
once for this check and removed afterward — not a project dependency)
against the live API and live testnet data on 1 Sept 2026: a real cached
commitment rendered in the list, clicking it loaded live on-chain data
(buyer/cooperative/warehouse addresses, tranche bps, claim deadlines,
claimed/expired state) with zero console errors.

**A real bug that check caught**: the API had no CORS headers, so the
browser silently blocked every cross-origin fetch — invisible to `curl`
(which doesn't enforce CORS), only visible from an actual browser. Fixed
by adding `@fastify/cors` to `api/src/server.ts` (`origin: true` —
appropriate for now since there's no auth to protect; revisit if that
changes). This is exactly why "start the dev server and check it in a
browser" matters more than typecheck/build passing.

**Automated tests** (`npm test`, vitest + Testing Library, added 1 Sept
2026): `StatusBadge`, `CommitmentDetail`'s formatting logic (bps-to-
percentage, the deadline-0 special case, claim state), and `App`'s
fetch-mocked list/detail/error flows. Fetch is mocked at the network
boundary here — a different kind of mock than `api/`'s "no mocks"
testnet suite; the real integration is what the browser check above
already verified, these check this app's own rendering logic. Two real
environment issues found and fixed while setting this up: the default
vitest forks pool hangs on this machine (`pool: "threads"` in
`vitest.config.ts` fixes it), and Testing Library's automatic DOM
cleanup between tests needs vitest's global test APIs, which this
project doesn't use — needs an explicit `afterEach(cleanup)` instead
(`src/test-setup.ts`), found via a genuinely confusing failure (a count
assertion off by exactly 2x) before it was added.

**Claim-advance write action** (`src/wallet.ts`, `src/App.tsx`, added 2 Sept
2026): the app's first write. Build → Freighter signs → submit → refresh,
same shape every write in this project follows, now running client-side.
Freighter is explicitly a testnet/MVP stand-in, not the real auth model —
PRD §4.6 rules out seed-phrase wallets for cooperative users. **What's
verified and what isn't**: the API calls (build/submit) and the component
logic (button gating, error handling, the full flow with fetch and wallet
both mocked) are tested — 13 tests. What's **not** independently verified
in this session: signing against a real, installed Freighter extension —
this sandboxed environment has no way to install and drive a real browser
extension with a real funded account. A genuinely real finding *did* come
from a real browser, though: with no Freighter extension present at all
(the exact case a first-time visitor hits), `requestAccess()` neither
resolves nor rejects, it hangs forever — fixed with a timeout wrapper
around every Freighter call, see `wallet.ts`. Manual QA with a real
Freighter install is still a real gap before calling this fully proven.

**Cancel this commitment** (`src/components/CancelSection.tsx`, added
2 Sept 2026, later same day): the staged multi-party propose/sign/finalize
UX for `cancel()` — see `api/HANDOFF.md`. Either party (buyer or
cooperative) can propose; if the *other* party is connected, they see
"approve cancellation," which signs their own Soroban auth entry via
Freighter's `signAuthEntry` (a new `wallet.ts` export, distinct from
`signTransactionXdr` — this signs one auth entry, not a whole
transaction). Once both sides have acted, the proposer sees "finalize
cancellation," which classically signs the ready XDR and submits through
the same `submitTx` every other write uses. Polls the active proposal
every 10s while waiting on the other party, stops once it's this
viewer's own turn to act. Rendered inside `CommitmentDetail` for any
cancellable status (`Draft` through `ReadyForDelivery`, matching
`lib.rs`'s reachable range) when the connected wallet is a party to the
commitment; hidden otherwise. Identical to `buyer-app`'s copy of this
component — same small-duplication call as `wallet.ts`/`api.ts` across
the two apps already made, not a shared package. 7 new component tests
cover all three roles (proposer waiting, approver signing, proposer
finalizing) plus a rejected-signature error path. Same honesty note as
the claim-advance action above: no real, installed Freighter extension
exists in this environment, so `signAuthEntry`'s actual on-extension
behavior hasn't been manually verified — the API side of this flow *has*
been verified live end to end (see `api/HANDOFF.md`).

**Propose reassignment** (`src/components/ReassignBuyerSection.tsx`,
added 3 Sept 2026): the same staged propose/sign/finalize shape as
`CancelSection.tsx`, for `reassign_buyer()` — see `api/HANDOFF.md`. Two
real differences: only the commitment's *current* buyer may propose (the
API rejects anyone else with 403, per PRD §4.8), so this app — where the
cooperative is the connected party, never the buyer — only ever sees the
*approve* side of the flow, never the propose form; and there are two
pending signers, not one (cooperative and incoming buyer). `justApproved`
is local, per-session component state that keeps a signer in the
"waiting" state after they approve, since the API's `pending_entries`
stops naming a signer once they've signed — deliberately doesn't survive
a page reload, an acknowledged gap. Identical to `buyer-app`'s copy of
this component — same small-duplication call as `CancelSection.tsx`'s.
7 new component tests, same conventions as `CancelSection.test.tsx`'s.
Same Freighter-extension honesty note as the action above applies.

**Offline-tolerant queue** (`src/offlineQueue.ts`, `src/components/OfflineQueueBanner.tsx`,
added 4 Sept 2026): PRD §7/§16.3's "connectivity loss at depot" edge case.
The app shell itself is now installable and precached (`vite-plugin-pwa`,
`vite.config.ts`) — the dashboard opens with no network at all, though a
freshly-viewed commitment's live data obviously still needs one; nothing
here fakes stale data as current. If a claim's *build* request can't
even reach the network (`isOfflineError` — a `fetch` `TypeError`, not a
rejection the server actually sent back), the *intent* (contract +
tranche) is queued in IndexedDB and surfaced in a banner, instead of just
failing. Deliberately **not** a pre-signed transaction queued for later,
and deliberately **not** auto-retried on a `window.addEventListener("online")`
listener — see `offlineQueue.ts`'s doc comment for why: the API's
`buildInvokeTransaction` sets a 60-second transaction timeout, nowhere
near enough to survive a real depot connectivity gap, and a queued
signature would also go stale the moment any *other* transaction moved
the source account's sequence number in the meantime. Retrying always
rebuilds fresh (a current sequence number, a fresh window) and still
needs the cooperative's own wallet to sign via Freighter — which needs
the user present regardless — so a visible "Retry" button they tap when
they believe they're reconnected is both simpler and more honest than
trying to auto-detect it. A genuine rejection on retry (not just "still
offline") removes the item from the queue and surfaces the real error,
rather than retrying forever. 5 new tests against a real (in-memory)
IndexedDB via `fake-indexeddb`, plus 2 new `App.test.tsx` scenarios
(queues on a network failure, then a successful retry clears it) —
same fetch-mocking conventions as every other write action here.

**Deferred, per `TASKS.md`**:
- Phone-based auth (PRD §4.6) — needs the API's identity/session model decided first. Freighter is a stand-in, not this.
- Allocation-ledger / per-member display — the API side is done (`api/HANDOFF.md`), nothing built for this frontend yet.

## A real testnet flakiness observed, not a bug — now handled

During testing, one `GET /commitments/:contractId` call failed with a
500 (`Account not found: G...` from the Stellar RPC) on an account that
had just transacted successfully seconds earlier — a transient Soroban
RPC inconsistency, not a code defect; a retry of the same request
succeeded normally. `api/`'s `simulateRead` now retries transient
failures automatically (`src/stellar/retry.ts`, added after a second,
different occurrence made this stop being speculative) — see
`api/HANDOFF.md`.
