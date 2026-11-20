# SMS notification templates (Yoruba)

> **Status:** Draft translation, pending review by a second fluent Yoruba speaker.
> **Source:** [sms-templates.md](sms-templates.md) (English baseline).

This is the Yoruba copy of the six farmer/cooperative notifications. The event
keys and the `{quantity}` placeholder match the English baseline exactly, so
the notification service can switch locale without changing message shape.
ROADMAP.md's mainnet/UX tranche names Yoruba explicitly; this file is the
starting point for testing with a Yoruba-speaking cooperative.

## Templates

| Event key | Yoruba template | Chars | SMS segments |
| --- | --- | ---: | ---: |
| `advance_released` | HarvestLock: A ti san owó ìṣáájú rẹ. Kàn sí ẹgbẹ́ alájọṣepọ̀ rẹ láti gbà á. | 75 | 2 |
| `checkpoint_marked` | HarvestLock: A ti fọwọ́ sí àyẹ̀wò ilé ìpamọ́ ọjà. Ìpele owó ìṣáájú rẹ tó kàn ti ṣí. | 83 | 2 |
| `delivery_confirmed` | HarvestLock: A ti fọwọ́ sí ìfijíṣẹ́ ẹyọ {quantity}. A ń ṣètò ìsanwó ìkẹyìn. | 75 | 2 |
| `dispute_flagged` | HarvestLock: A ti gbé àríyànjiyàn dìde. Gbogbo ìgbésẹ̀ dúró títí a ó fi yanjú rẹ̀. | 82 | 2 |
| `dispute_resolved` | HarvestLock: A ti yanjú àríyànjiyàn náà. Iṣẹ́ ti padà bọ̀ sípò. | 63 | 1 |
| `settlement_complete` | HarvestLock: Ìsanwó ìkẹyìn ti parí. A ti fi owó ránṣẹ́ sí ẹgbẹ́ alájọṣepọ̀ rẹ. | 78 | 2 |

**Chars** is the length in Unicode characters after NFC normalisation (the
form a gateway receives). Some tone-marked letters, such as `ẹ́` and `ọ̀`,
have no single precomposed character, so they count as two. **SMS segments**
is the UCS-2 segment count: up to 70 characters fit in one segment, and longer
messages split into 67-character segments.

### Placeholders

- `{quantity}` — the same meaning as the English baseline: the delivered unit
  count attested by the warehouse operator. Substitute a short value such as
  `1,200`, never a decimal.

### Word choices

Plain, everyday wording was preferred over technical terms, so a farmer can
read the message without help. The reviewer should check these choices in
particular:

| English | Yoruba used | Note |
| --- | --- | --- |
| advance (payment) | owó ìṣáájú | Money paid ahead of delivery. |
| cooperative | ẹgbẹ́ alájọṣepọ̀ | The common name for a cooperative society. |
| warehouse | ilé ìpamọ́ ọjà | Literally "house where goods are kept". |
| confirmed | a ti fọwọ́ sí | "Has been signed off / approved". |
| settlement | ìsanwó ìkẹyìn | "Final payment", which is what settlement means to a farmer. |
| dispute | àríyànjiyàn | A disagreement or argument. |
| units | ẹyọ | Counted items, used with the `{quantity}` number. |

## Length and encoding

All six messages stay under the 140-character budget. Yoruba tone marks and
under-dots (`ẹ`, `ọ`, `ṣ`, and the accents) are outside the GSM-7 alphabet, so
every message here is sent as UCS-2, and most of them take two segments.

If a single segment is mandatory for a campaign, either:

1. accept the two-segment cost, or
2. use an ASCII variant without tone marks (for example
   `A ti san owo isaaju re`) and have that variant reviewed by the same fluent
   reviewer. Yoruba without tone marks is much more ambiguous than English, so
   this needs a careful read, not a mechanical strip.

Do not silently strip diacritics: the wording should stay the same across both
variants.

## Review checklist

- [ ] A fluent Yoruba speaker confirms the tone is plain and respectful.
- [ ] The word choices table above is confirmed or corrected.
- [ ] `{quantity}` and the event keys match the English baseline exactly.
- [ ] No wallet addresses, transaction hashes, or private keys are included.
- [ ] Character and segment counts are re-checked after edits.
