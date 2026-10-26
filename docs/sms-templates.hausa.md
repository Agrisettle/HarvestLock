# SMS notification templates (Hausa)

> **Status:** Draft translation, pending review by a fluent Hausa speaker
> and then a second fluent reviewer.
> **Source:** [sms-templates.md](sms-templates.md) (English baseline).

This is the Hausa copy of the six farmer/cooperative notifications. The event
keys and the `{quantity}` placeholder match the English baseline exactly, so
the notification service can switch locale without changing message shape.
ROADMAP.md's mainnet/UX tranche names Hausa explicitly; this file is the
starting point for testing with a Hausa-speaking cooperative.

## Templates

| Event key | Hausa template | Chars | SMS segments |
| --- | --- | ---: | ---: |
| `advance_released` | HarvestLock: An saki kuɗin gabanku. Ku tuntuɓi ƙungiyarku ta haɗin gwiwa don karɓa. | 83 | 2 |
| `checkpoint_marked` | HarvestLock: An tabbatar da binciken rumbun ajiya. Mataki na gaba na kuɗin gabanku ya buɗe. | 91 | 2 |
| `delivery_confirmed` | HarvestLock: An tabbatar da isar da kaya guda {quantity}. Ana shirya biyan ƙarshe. | 82 | 2 |
| `dispute_flagged` | HarvestLock: An tayar da takaddama. An dakatar da ayyuka har sai an warware ta. | 79 | 1 |
| `dispute_resolved` | HarvestLock: An warware takaddamar. Ayyuka sun ci gaba kamar yadda aka saba. | 76 | 1 |
| `settlement_complete` | HarvestLock: An kammala biyan ƙarshe. An tura kuɗin zuwa ƙungiyarku ta haɗin gwiwa. | 83 | 2 |

**Chars** is the length in Unicode characters after NFC normalisation (the
form a gateway receives). Counts for `delivery_confirmed` include the literal
`{quantity}` placeholder, as in the English baseline. **SMS segments** is the
segment count for the encoding the message needs:

- Messages with any of Hausa's hooked letters (`ɓ`, `ɗ`, `ƙ`) are outside the
  GSM-7 alphabet, so they are sent as UCS-2: up to 70 characters in one
  segment, 67 per segment after that.
- `dispute_flagged` and `dispute_resolved` use only GSM-7 letters, so they fit
  in one 160-character segment.

### Placeholders

- `{quantity}` — the same meaning as the English baseline: the delivered unit
  count attested by the warehouse operator. Substitute a short value such as
  `1,200`, never a decimal.

### Word choices

Plain, everyday wording was preferred over technical terms, so a farmer can
read the message without help. The reviewer should check these choices in
particular:

| English | Hausa used | Note |
| --- | --- | --- |
| advance (payment) | kuɗin gaba | "Money ahead", paid before delivery. Avoids *bashi*/*rance* (a loan), which would wrongly suggest it must be repaid. |
| cooperative | ƙungiyar haɗin gwiwa | "Association of joint effort", the usual term for a cooperative society. |
| your (cooperative, advance) | -ku (*ƙungiyarku*, *gabanku*) | Plural "your", used as the respectful form. It also avoids choosing between the masculine *-ka* and feminine *-ki* forms. |
| warehouse | rumbun ajiya | A storage barn or store. |
| confirmed | an tabbatar da | "It has been confirmed". |
| settlement | biyan ƙarshe | "Final payment", which is what settlement means to a farmer. |
| dispute | takaddama | A disagreement or argument. Feminine, hence *warware ta* ("resolve it"). |
| units | kaya guda | "Goods, pieces", used with the `{quantity}` number. |
| actions are paused | an dakatar da ayyuka | "Activities have been halted". |

## Length and encoding

All six messages stay under the 140-character budget. Four of them use at
least one hooked letter (`ɓ`, `ɗ`, `ƙ`), which forces UCS-2 and two
segments.

If a single segment is mandatory for a campaign, either:

1. accept the two-segment cost, or
2. use an ASCII variant that writes the hooked letters as plain `b`, `d`, `k`
   (for example `kudin gabanku`), and have that variant reviewed by the same
   fluent reviewer. Some words change meaning without the hooks, so this
   needs a careful read, not a mechanical replacement.

Do not silently strip the hooked letters: the wording should stay the same
across both variants.

## Review checklist

- [ ] A fluent Hausa speaker confirms the tone is plain and respectful.
- [ ] A second fluent Hausa speaker reviews the same text.
- [ ] The word choices table above is confirmed or corrected.
- [ ] `{quantity}` and the event keys match the English baseline exactly.
- [ ] No wallet addresses, transaction hashes, or private keys are included.
- [ ] Character and segment counts are re-checked after edits.
