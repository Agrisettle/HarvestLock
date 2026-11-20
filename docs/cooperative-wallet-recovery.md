# Cooperative wallet recovery — design decision (issue #3)

**Status: proposal, not implemented.** This is the design-first deliverable
issue #3 asks for. It does not add code, change the escrow contract, or claim
that anything below has been built. It decides (or, where noted, asks the
pilot partner to decide) the mechanism before implementation starts.

Companion documents: [`key-recovery-exercise.md`](./key-recovery-exercise.md)
(what was actually exercised on testnet), [`identity-session-model.md`](./identity-session-model.md)
(issue #5 — the other half of "no seed phrases"), and PRD §4.6 / §16.1.

---

## 1. The decision being requested

Adopt a **Soroban custom-account smart wallet** (`C...` address) as the
cooperative's on-chain identity, with a 2-of-3 recovery set of the co-signer,
the warehouse operator and one further officer. Any two can rotate a lost
lead key; day-to-day operations remain single-signature. Keep the already
exercised **classic Stellar multisig** flow as a documented fallback and a
comparison point — not as a silent substitute for the PRD's requirement.

Do not write product code for either mechanism until the spike in §5 has
answered the two questions that can invalidate this choice: whether a
browser/wallet can sign a custom account's auth entries in practice, and
whether the escrow contract accepts a `C...` cooperative address unchanged.

## 2. What exists today

- [`docs/key-recovery-exercise.md`](./key-recovery-exercise.md) records a real
  4 Oct 2026 testnet run: five throwaway keypairs, signer weights 1/1/1 and a
  high threshold of 2 on a classic `G...` account, a routine `manage_data` op
  signed by the lead alone, a rotation signed by co-signer + warehouse
  operator only, a successful op with the new key, and a `tx_bad_auth`
  rejection of the old key. That proves the *recovery logic* end to end.
- `api/scripts/key-recovery-exercise.ts` is a standalone script; the exercise
  explicitly touches none of this repo's contract, API, database or frontends
  (`docs/key-recovery-exercise.md:47-50`). There is no recovery-set schema,
  no rotate-key route, no UI, and no `__check_auth` contract anywhere in this
  workspace.
- The escrow trusts whatever `cooperative: Address` was fixed at
  `initialize` and calls `require_auth()` on it for cooperative-gated
  methods. It has no notion of an entity, a recovery set, or a key rotation
  (`api/HANDOFF.md:40`; `api/src/server.ts:190-194`).
- Reputation is keyed by **address**, not entity (`api/src/reputation.ts`,
  `api/src/server.ts`). A rotated cooperative key would therefore lose (or
  evade) its strike/bar history unless issue #5's entity identity is in
  place first.

The exercise's own conclusion is that the product choice is still open
(`docs/key-recovery-exercise.md:110-117`). This document is that choice,
proposed.

## 3. Options, honestly compared

| | Classic multisig (exercised) | Soroban smart wallet (proposed) | Defer until pilot |
|---|---|---|---|
| PRD §4.6 as written | No — native multisig, not account abstraction | Yes | No — leaves a must-have unshipped |
| No seed phrases for cooperative users | Only if each recovery signer is itself a no-seed-phrase wallet; a classic `G...` signer is a key somebody must hold | Passkeys/WebAuthn held on officers' devices; no phrase is ever surfaced | n/a |
| "Any two of three" | Yes, via `set_options` high threshold 2 | Yes, in `__check_auth` / a rotation entry point | n/a |
| Day-to-day single-signature use | Yes, low/medium threshold 1 | Yes, lead key accepted for ordinary calls | n/a |
| Programmable policy (limits, time locks, succession rules) | No — weights and thresholds only | Yes — arbitrary policy in contract code | n/a |
| New contract + audit surface | None; native Stellar feature, battle-tested | New contract, must be audited before mainnet | none now, all later |
| Client support | Universal | **Not yet universal** — Stellar's own docs warn that full client support for contract accounts, including transaction simulation, is still under development | n/a |
| Escrow changes needed | None | None expected, but must be verified with a live test | none |
| Fits SDP's embedded-wallet model | No | Same address family as SDP's embedded smart wallets | n/a |

The deciding constraint is not cleverness: it is PRD §4.6's combination of
"no seed phrases" **and** "recovery set of cooperative officers plus the
warehouse operator". A classic `G...` recovery signer is key material that a
low-literacy cooperative officer would have to protect — exactly what the
PRD rules out. Soroban account abstraction is the only option here that can
satisfy both requirements without the API custodian holding keys.

## 4. Proposed design

### 4.1 Where the code lives

A new crate in **`HarvestLock-Contracts`**, not in `api/`. That repo already
has the separate audit trail and release cadence (see the root `README.md`
"Repositories" section), and a custom account is high-stakes contract code —
the same reason the escrow lives there. Nothing in this repo changes the
escrow contract.

Use a constructor (`__constructor`) to set the lead key and recovery set
atomically. Stellar's own complex-account example calls this out explicitly:
without a constructor there is a frontrunning window in which somebody else
can initialise the account and install their own keys.

### 4.2 Signers and policy

- **Lead key**: a WebAuthn/P-256 passkey registered on the lead's device.
  Accepted alone for ordinary calls (`claim_advance_*`, `set_allocation`,
  staged-proposal signing, and any future cooperative write). No seed phrase
  is displayed, exported or stored by HarvestLock.
- **Recovery set**: co-signer, warehouse operator, one further officer. Any
  two of the three may call `rotate_lead(new_key)`; the current key is revoked
  in the same atomic state change, and the old key can never sign again.
- **`__check_auth`** verifies the signature(s) against the stored key(s) and
  inspects the authorization context: an ordinary invocation needs the lead;
  an invocation of the wallet's own rotation/admin entry points needs two
  recovery signers. It can safely mutate its own state because the Soroban
  host only invokes it through `require_auth` verification; the docs'
  complex-account example demonstrates the pattern (including using
  `env.current_contract_address().require_auth()` for self-administration).
- **Replay**: rely on Soroban's signed auth payload plus signature-expiration
  ledgers, and bind the rotation signature to the exact `rotate_lead` call
  and arguments. Do not invent a second, independent nonce scheme unless the
  spike finds a real gap.
- **Institutional signer**: the warehouse operator's key may be held as an
  organisational secret rather than a personal passkey; that is their
  choice to make during onboarding, not HarvestLock's to decide for them.

Do not add spending limits, time locks or a fourth recovery member in v1.
Those are real features, not free ones: each adds policy surface to audit.
The classic-account comparison table is the reason to add them later if a
pilot actually asks.

### 4.3 Transparency to the escrow — assumption to verify, not assert

The escrow stores a single `Address` for `cooperative`. A Soroban
`require_auth()` on a `C...` address routes to that contract's `__check_auth`;
the calling contract does not need to know anything about the signing policy.
So the expected outcome is **no escrow change**, and PRD §4.6's "contract terms
bind the cooperative entity, not the lead's personal key" becomes true at the
address level: the `C...` address survives officer turnover.

That is a reasoned expectation, not a verified result. The spike must prove
it with a live escrow instance initialised with the smart wallet's address,
then a cooperative-gated call (e.g. `claim_advance_1`) authorised through
`__check_auth`. If it fails, the fallback is not "patch the escrow anyway" —
it is to reopen this decision.

### 4.4 The identity half

This cannot ship alone:

- The phone number is bound to the **entity and its `C...` address** by issue
  #5's identity table, not to the lead's person. The contract wallet is the
  on-chain anchor; the phone is a verification/contact factor, never the
  root of authority and never stored on chain.
- Reputation/standing must key the same entity id so a rotation carries a
  cooperative's strikes and bars with it (today it keys the address; see §2).
- Onboarding must exercise one real rotation, as PRD §4.6 requires — not
  merely document that a rotation is possible. Use a throwaway key for the
  exercise, then rotate back to the real lead key.
- Key-rotation events must be logged for the Phase 2 pilot review
  (`ROADMAP.md`, Phase 2: "log every key-recovery event regardless of
  outcome").

### 4.5 Relationship to SDP embedded wallets

SDP's embedded-wallet flow also provisions Soroban smart-wallet contracts for
phone-number recipients (`docs/sdp-spike.md:96-143`). That is evidence the
address family is real and usable on testnet, but SDP's wallet contract is a
fixed, upstream artifact with its own passkey registration flow; HarvestLock
must not assume it supports a custom 2-of-3 recovery policy or fork it
(PRD §17.1). Reuse it only if its published interface actually supports the
policy; otherwise the cooperative wallet is a separate contract from the
farmer payout wallet.

## 5. Spike required before implementation

1. Write the custom-account contract in `HarvestLock-Contracts`, including
   `__check_auth` and `rotate_lead`, with unit tests for: lead alone succeeds;
   one recovery signer fails; two recovery signers succeed; old key fails
   after rotation; signature for a different function/args fails.
2. Deploy it on testnet and use its `C...` address as `cooperative` on a
   freshly deployed escrow instance; complete a cooperative-gated call live.
3. Prove a browser/wallet can sign the custom account's auth entries. Stellar
   explicitly warns that client support for contract accounts is still under
   development; if Freighter cannot do it, identify the wallet SDK path
   before promising a no-seed-phrase UX. Do not solve this by having the API
   hold the key.
4. Record the outcome in this document. Only then open implementation PRs.

If step 3 or 4 fails, the decision becomes **classic multisig with a
documented, temporary caveat**, and the PRD deviation is escalated rather
than hidden — the same standard applied to the existing recovery exercise.

## 6. Definition of done for issue #3 (once implemented)

- [ ] Soroban smart wallet with 2-of-3 rotation deployed and exercised on
      testnet; old key genuinely revoked; ordinary single-signature use
      unaffected.
- [ ] An escrow commitment whose `cooperative` is the smart wallet completes
      a cooperative-gated write without escrow changes.
- [ ] One rotation exercised during a real onboarding run (not a throwaway
      script), with the event logged.
- [ ] API reputation/identity keyed to the cooperative entity, so rotation
      preserves standing.
- [ ] `coop-pwa` exposes the lead/passkey flow and the recovery initiation
      flow, with no seed phrase anywhere in the UI.
- [ ] Contract audited before mainnet (the existing audit task in
      `ROADMAP.md` must include this contract).

## 7. Open questions for the first counterparty conversation

- Who exactly is "one further officer", and what happens when that person
  leaves or the warehouse operator changes?
- Are the recovery signers' passkeys on personal devices, and what is the
  fallback when a device is lost along with the key?
- Does the cooperative's counsel accept a `C...` address as "contract terms
  bind the cooperative entity" (PRD §4.6) for the pilot's paperwork?
- Should a rotation have a cooling-off window for the counterparty's benefit,
  or is atomic rotation the better fit for a mid-season emergency?

## Sources checked

- PRD §4.6 and §16.1 in [`PRD.md`](./PRD.md).
- [`key-recovery-exercise.md`](./key-recovery-exercise.md) and
  `api/scripts/key-recovery-exercise.ts` for what was actually built.
- Stellar's [Simple Account](https://developers.stellar.org/docs/build/smart-contracts/example-contracts/simple-account)
  and [Complex Account](https://developers.stellar.org/docs/build/smart-contracts/example-contracts/complex-account)
  examples for `__check_auth`, constructors and the client-support caveat.
- [SEP-45](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md)
  (currently **Draft**) for contract-account web authentication — relevant to
  issue #5 rather than this one, but it defines how a `C...` account proves
  control to a web service without a seed phrase.
