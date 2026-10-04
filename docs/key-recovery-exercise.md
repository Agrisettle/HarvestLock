# Key recovery exercise — 2-of-3 social recovery, live on testnet

Closes `ROADMAP.md`'s Phase 1 (Testnet tranche) item: *"Key recovery
flow: exercise it once end to end — simulate a lost key, confirm the
two-of-three social recovery set can rotate it."*

## What this is, and what it deliberately isn't

PRD §4.6 describes the cooperative wallet's recovery model as **"Soroban
account abstraction with social recovery"** — a custom-account smart
contract implementing its own `__check_auth` logic, with a recovery set
of the co-signer, the warehouse operator, and one further officer, any
two of whom can rotate a lost key.

This exercise does **not** build that contract. It demonstrates the same
2-of-3 recovery *mechanism* — any two of three independent parties can
rotate a lost key, day-to-day single-signer use is unaffected before and
after, and the old key is genuinely revoked rather than merely
redundant — using **Stellar's native classic-account multisig**
(`set_options` signer weights and thresholds) instead of a Soroban smart
contract.

That is a real, meaningful difference, stated plainly rather than
glossed over:

| | Classic multisig (this exercise) | Soroban account abstraction (PRD §4.6) |
|---|---|---|
| New contract code / audit surface | None — a native Stellar account feature | A custom-account contract implementing `__check_auth` |
| Programmability (daily spending limits, time locks, richer policies) | Limited to weights/thresholds | Arbitrary, since recovery logic is a smart contract |
| Maturity | Long-standing, widely used, battle-tested | Newer primitive, less precedent to point to |
| Matches PRD §4.6 as written | No | Yes |

Classic multisig is offered here as a genuine, lower-risk alternative
worth a real product decision — not as a silent substitution for what
the PRD specifies. Whichever way that decision goes, this exercise
proves the *recovery logic itself* (the part that actually matters for
a cooperative that's lost a key) end to end, on real testnet, today.

## The script

[`api/scripts/key-recovery-exercise.ts`](../api/scripts/key-recovery-exercise.ts) — run with:

```bash
cd api && npx tsx scripts/key-recovery-exercise.ts
```

Every step is a real transaction against real testnet, no mocks, same
discipline as `api/test/stellar.test.ts`. It touches only fresh,
throwaway accounts generated at run time — nothing in this repo's own
contract, API, or database is involved.

## What it does

1. Generates five fresh keypairs: the cooperative lead (whose key gets
   "lost"), the three-member recovery set (co-signer, warehouse
   operator, officer), and the lead's replacement key.
2. Funds the lead's account via friendbot.
3. **Setup**: the lead, signing alone (thresholds are 0 on a fresh
   account, so this is the standard bootstrap), adds the three recovery
   signers at weight 1 each and raises the account's thresholds to
   low=1, med=1, **high=2** — so changing signers/thresholds again now
   needs weight 2, but routine operations (medium threshold) still need
   only weight 1.
4. **Day-to-day, unaffected**: the lead signs a routine operation
   (`manage_data`) alone — succeeds, proving the security change didn't
   disrupt normal single-signer use.
5. **Simulate the lost key**: the lead's keypair is never used again.
   The co-signer and warehouse operator — two of the three recovery-set
   members, deliberately *not* the officer, to prove "any two" rather
   than "these two specifically" — jointly sign a `set_options`
   transaction that adds the lead's new replacement key at weight 1 and
   sets the old key's weight to 0. Weight 1 + 1 = 2 meets the high
   threshold; neither the lead nor the officer signs this transaction at
   all.
6. **The new key works**: a routine operation signed by the new key
   alone succeeds.
7. **The old key is genuinely revoked**: the same kind of routine
   operation, signed by the *old* key alone, is submitted and must fail
   — proving real revocation, not just redundancy. It does, with
   `tx_bad_auth`.

## A real run's actual result (4 Oct 2026)

```
lead (to be rotated out):      GD3GUKY5FADOYISCWB25EY6V427K7I7H7V7RRZI6LAIKCCABEXCKMVOH
co-signer (recovery set):      GCMAWGH2EI6TFKA5XIKFY523FNGSW7CTT4BLLGAFDC5SAKOXXH5EYYNF
warehouse operator (recovery): GBLW7XDQ7UOK3KPFL6EVYYEJWSLA5RTID4TQ3KIPDU7IH2XHT2GMOVR6
officer (recovery set):        GCN237MXZGKJUKRDJWHPZ4UOJS6WPGYFUCKPHBWLTAISWGURR5IOG2EQ
new lead key (post-recovery):  GDLLS7LD62MHSYCPGQEIPMYUSC5I7BXEJFZ545PO7YHS6TFOMOUOT72E

Step 1 (setup, lead alone):                    tx 0cc9a2b2ca894772ae4c121e8d465b660612bf67e60e811ef6a0a1d6b83aac05 -> SUCCESS
  signers: GBLW7XDQ…(w1), GCMAWGH2…(w1), GCN237MX…(w1), GD3GUKY5…(w1)
  thresholds: low=1 med=1 high=2
Step 2 (routine op, lead alone):                tx 2fad13ae041a6cffc5d366578129b2aded67fac2dc36eb5c37616e0bc37f5d0e -> SUCCESS
Step 3 (recovery, co-signer + warehouse only):  tx 027477e0a1109caa75cc306fddb607673c96d7e2961d63b45606567d439b7299 -> SUCCESS
  signers: GBLW7XDQ…(w1), GCMAWGH2…(w1), GCN237MX…(w1), GDLLS7LD…(w1), GD3GUKY5…(w0)
Step 4 (routine op, new key alone):             tx 85e5001af0e99343dc7c9153383e44c5d2eacb6fbb9af7c2ca44ce7a5a06bb27 -> SUCCESS
Step 5 (old key, expected rejection):           tx_bad_auth -- rejected, as expected
```

Verifiable independently: query any of the transaction hashes above
against `https://horizon-testnet.stellar.org/transactions/<hash>`, or
the lead account directly at
`https://horizon-testnet.stellar.org/accounts/GD3GUKY5FADOYISCWB25EY6V427K7I7H7V7RRZI6LAIKCCABEXCKMVOH`
to see the final signer set and thresholds exactly as reported above.
These are real testnet accounts and transactions, not illustrative
placeholders — they'll remain queryable for as long as testnet retains
the history.

## Next decision, not made here

Whether HarvestLock ships cooperative-wallet recovery as this classic
multisig mechanism, as the Soroban account-abstraction contract PRD §4.6
originally specified, or defers the choice until a real pilot cooperative
surfaces an actual preference, is a product decision for a future
session — this exercise's job was only to prove the recovery *logic*
works, which it now does, on real testnet, either way.
