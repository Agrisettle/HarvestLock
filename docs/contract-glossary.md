# Contract glossary — every `Status` and `Error`, in plain English

For a non-engineer reviewer: what each value coming out of the HarvestLock
escrow contract means, without needing to read Rust. Two enums are covered —
`Status` (the commitment's current state) and `Error` (why a rejected action
was rejected).

**Where these show up:** a commitment read through the API or either
dashboard has a `status` field whose value is one of the `Status` names
below, verbatim. A rejected write (a lifecycle call that isn't allowed right
now) comes back as an error mentioning `Error(Contract, #N)` — find `N` in
the error table to see what it means. The API also returns the code and this
glossary name as `contractError: { code, name }` (HTTP 409, or 404 for a
read of a missing/uninitialized contract), so a frontend can show the plain
English without parsing the diagnostic. Status changes are also emitted as
on-chain events; errors never change state.

**Checked against the code, not from memory:** the enums in
[`HarvestLock-Contracts`](https://github.com/Agrisettle/HarvestLock-Contracts)'s
`contracts/escrow/src/lib.rs` (main, checked 18 Oct 2026 —
`Status` at line 164, `Error` at line 192). When the contract adds a
variant it is **appended**, never renumbered (a CI guard enforces the
numerical discriminants), so the numbers below keep their meaning. The
testnet instance the API currently targets (`render.yaml`'s
`ESCROW_WASM_HASH`) is Deployment 10 (6 Sept 2026): codes 1–36 match it,
and 37–38 were added later (16 Oct 2026) so a caller of that older
instance will never see them. Recheck by diffing against `lib.rs`'s two
enums.

---

## `Status` — where a commitment currently is

| Status | In plain English | Final? |
|---|---|---|
| `Draft` | The deal is agreed and initialized, but no money has been escrowed yet — nothing is at stake until the buyer locks the deposit. | No |
| `Locked` | The buyer's advance deposit is held in escrow and the deal is live. | No |
| `Advance1Released` | The first advance tranche is open: the cooperative can claim it, or the buyer can reclaim it once its window lapses. | No |
| `CheckpointPassed` | The warehouse operator has recorded the agreed mid-delivery checkpoint. | No |
| `Advance2Released` | The second advance tranche is open for claiming or reclaiming. | No |
| `ReadyForDelivery` | The cooperative has signaled it's ready to deliver, which opens the buyer's window to pay in the remainder. | No |
| `Delivered` | The warehouse operator has confirmed delivery (with quantity and grade), so settlement can run. | No |
| `Settled` | The final payment has been made and the deal is complete. | Yes |
| `Cancelled` | Both parties agreed to unwind: whatever was escrowed went back to the buyer and the deal is closed. | Yes |
| `Defaulted` | The buyer missed a required payment deadline, so the cooperative keeps what was already escrowed. | Yes |
| `Forfeited` | The cooperative never delivered before its deadline, so the buyer's escrow came back to the buyer. | Yes |
| `Disputed` | A named party has frozen the commitment; nothing can change its status again until all three parties agree or the dispute timeout passes. | No — it resumes the status it was frozen from |

## `Error` — why an action was rejected

| # | Name | In plain English |
|---|---|---|
| 1 | `AlreadyInitialized` | This contract instance already holds a commitment — each instance is exactly one deal and can't be set up twice. |
| 2 | `NotInitialized` | Nothing has been set up on this contract instance yet (`initialize` hasn't run). |
| 3 | `InvalidState` | The action isn't allowed from the commitment's current status — the general "not now, not from here" rejection. |
| 4 | `InvalidBps` | The two advance shares add up to more than 100% of the total amount. |
| 5 | `ZeroAmount` | The total amount must be greater than zero. |
| 6 | `InvalidWindow` | One of the configured time windows is zero, but every window must be at least one second. |
| 7 | `NotYetOpened` | That advance tranche isn't open yet — the stage that opens it hasn't happened. |
| 8 | `AlreadyClaimed` | The cooperative already claimed that advance. |
| 9 | `AlreadyExpired` | That advance's window already lapsed without a claim, so it's resolved as an expiry. |
| 10 | `ClaimWindowPassed` | Too late for the cooperative to claim that advance. |
| 11 | `ClaimWindowNotPassed` | Not yet — the cooperative still has time to claim that advance, so the buyer can't take it back. |
| 12 | `TrancheUnresolved` | An advance is still open (neither claimed nor lapsed), so settlement or FX calculation can't run yet. |
| 13 | `RemainderAlreadyFunded` | The remainder payment was already paid in — it only happens once. |
| 14 | `RemainderWindowPassed` | Too late for the buyer to fund the remainder — the funding window has passed. |
| 15 | `RemainderWindowNotPassed` | Too early to declare the buyer in default — the remainder funding window hasn't passed yet. |
| 16 | `RemainderNotFunded` | Delivery can't be confirmed until the buyer has funded the remainder. |
| 17 | `DeliveryDeadlineNotPassed` | Too early to reclaim for non-delivery — the cooperative still has time to deliver. |
| 18 | `InvalidQuantity` | The contracted quantity must be greater than zero. |
| 19 | `InvalidGradeSchedule` | The grade-price schedule was empty or priced a grade at more than 100% of the unit price. |
| 20 | `InvalidGradeIndex` | The grade recorded at delivery doesn't exist in the pre-agreed grade schedule. |
| 21 | `AllocationAlreadySet` | The member allocation was already recorded and can't be changed afterwards. |
| 22 | `InvalidAllocation` | The allocation was empty or the members' shares added up to more than 100%. |
| 23 | `AllocationNotSet` | No member allocation has been recorded for this commitment yet. |
| 24 | `InvalidOracleConfig` | The oracle freshness limit was zero, which would reject every real price quote. |
| 25 | `OracleNotConfigured` | This commitment was created without an exchange-rate oracle, so no rate can be read for it. |
| 26 | `OraclePriceUnavailable` | The configured oracle doesn't quote this asset at all. |
| 27 | `OracleStale` | The oracle's newest quote is older than the agreed freshness limit, so it was refused instead of used. |
| 28 | `FxAlreadyResolved` | The exchange-rate shortfall was already calculated once and can't be recalculated (so neither side can pick a favourable moment). |
| 29 | `FxNotResolved` | The exchange-rate shortfall must be calculated before it can be funded, expired, or settled. |
| 30 | `FxShortfallUnfunded` | Settlement is blocked until the buyer pays the calculated exchange-rate shortfall. |
| 31 | `NoFxShortfall` | There's nothing to pay or expire — the escrow already covers the fresh-rate obligation. |
| 32 | `FxShortfallAlreadyFunded` | The exchange-rate top-up was already paid. |
| 33 | `FxShortfallWindowPassed` | Too late for the buyer to pay the exchange-rate top-up. |
| 34 | `FxShortfallWindowNotPassed` | Too early to declare the buyer in default on the exchange-rate top-up. |
| 35 | `NotAParty` | Only the commitment's buyer, cooperative, or warehouse operator can flag a dispute. |
| 36 | `DisputeWindowNotPassed` | The dispute freeze can't be ended by timeout yet. |
| 37 | `GradeScheduleTooLong` | The grade-price schedule had more than 16 entries. |
| 38 | `AllocationTooLarge` | The member allocation list had more than 200 entries. |

## Related, non-enum states worth knowing

- `oracle_config` missing (`null`) and a dispute's "pre-dispute status" are
  normal, valid states, not errors.
- The API's own 400/403/429 responses (malformed address, not allowed to
  propose, rate limit) are policy checks made *before* the contract is
  ever called — they don't have a contract error number.
