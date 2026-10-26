# SMS notification templates (English baseline)

> **Status:** Draft for translation and maintainer review.
> **Applies to:** farmer/cooperative notifications sent by the Termii SMS gateway.

HarvestLock is SMS-first for farmers: PRD §6/§13 require a message without an
app install, and the mainnet/UX tranche adds Yoruba, Hausa, and Igbo copies.
This file is the English baseline. Every message is under 140 characters, uses
plain language, and names the actor the farmer can contact (their cooperative)
instead of a crypto or dashboard concept.

## Event coverage

The contract emits one `StatusChanged` event per real transition
(`HarvestLock-Contracts/contracts/escrow/src/lib.rs`). The messages below map
to the transitions that matter to a farmer or cooperative member.

| Event key | Trigger | Status transition |
| --- | --- | --- |
| `advance_released` | `release_advance_1` / `release_advance_2` | `Locked → Advance1Released`, `CheckpointPassed → Advance2Released` |
| `checkpoint_marked` | `mark_checkpoint` | `Advance1Released → CheckpointPassed` |
| `delivery_confirmed` | `confirm_delivery` | `ReadyForDelivery → Delivered` |
| `dispute_flagged` | `flag_dispute` | any disputable status → `Disputed` |
| `dispute_resolved` | `resolve_dispute` (or dispute-window expiry) | `Disputed` → the stored pre-dispute status |
| `settlement_complete` | `settle` | `Delivered → Settled` |

There is no `Resolved` status: a resolved dispute returns to its previous
status, so an SMS consumer must key off the event/action, not the status name.

## Templates

| Event key | English template | Chars |
| --- | --- | ---: |
| `advance_released` | HarvestLock: Your advance has been released. Contact your cooperative to collect it. | 84 |
| `checkpoint_marked` | HarvestLock: Warehouse checkpoint confirmed. Your next advance stage is now open. | 81 |
| `delivery_confirmed` | HarvestLock: Delivery confirmed for {quantity} units. Settlement is being prepared. | 83 |
| `dispute_flagged` | HarvestLock: A dispute has been flagged. Actions are paused until it is resolved. | 81 |
| `dispute_resolved` | HarvestLock: The dispute has been resolved. Normal processing has resumed. | 74 |
| `settlement_complete` | HarvestLock: Settlement is complete. Funds have been sent to your cooperative. | 78 |

### Placeholders

- `{quantity}` — the delivered unit count attested by the warehouse operator.
  Keep the substituted value short (for example `1,200`). Do not put a decimal
  quantity in an SMS.

### Delivery rules

- Send one message per transition; do not re-send on retries after the gateway
  accepts the message.
- Keep the `HarvestLock:` prefix so the sender is recognisable without a
  contact card.
- Do not include wallet addresses, transaction hashes, or private keys.
- Respect the 140-character budget above when editing. A longer message should
  be split into two deliberately worded messages, not truncated.

## Translation notes

The Igbo draft lives in [sms-templates.igbo.md](sms-templates.igbo.md), the
Yoruba draft in [sms-templates.yoruba.md](sms-templates.yoruba.md), and the
Hausa draft in [sms-templates.hausa.md](sms-templates.hausa.md). All three
follow the same event keys and placeholder names so the notification service
can select a locale without branching on message shape.
