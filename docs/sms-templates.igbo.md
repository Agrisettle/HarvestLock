# SMS notification templates (Igbo)

> **Status:** Draft translation, pending review by a second fluent Igbo speaker.
> **Source:** [sms-templates.md](sms-templates.md) (English baseline).

This is the Igbo copy for the six farmer/cooperative notifications. Event keys
and placeholders match the English file so the notification service can switch
locale without changing message shape.

## Templates

| Event key | Igbo template | Chars |
| --- | --- | ---: |
| `advance_released` | HarvestLock: Ewepụtala ego nkwado gị. Kpọtụrụ otu gị ka i nweta ya. | 67 |
| `checkpoint_marked` | HarvestLock: Ekwenyere ebe nlele ụlọ nkwakọba. Ogbo ego ọzọ gị megheela. | 72 |
| `delivery_confirmed` | HarvestLock: Ekwenyere nnyefe ngwaahịa {quantity}. A na-akwado nkwụghachi. | 74 |
| `dispute_flagged` | HarvestLock: Ewelitela esemokwu. A kwụsịtụrụ omume niile ruo mgbe edozi ya. | 75 |
| `dispute_resolved` | HarvestLock: Edoziela esemokwu ahụ. Usoro nkịtị amalitela ọzọ. | 62 |
| `settlement_complete` | HarvestLock: Emechara nkwụghachi ụgwọ. Ezigara ego na otu gị. | 61 |

### Placeholders

- `{quantity}` — keep the same meaning as the English baseline: the delivered
  unit count. Substitute a short value such as `1,200`.

## Length and encoding

All six messages stay under the 140-character budget. Note that Igbo
diacritics (`ụ`, `ọ`, `ị`, `ṅ`, and tone marks) are outside the GSM-7
alphabet, so a message containing them is encoded as UCS-2 and splits at 70
characters per SMS segment. The longer templates above may therefore use two
segments.

If a single segment is mandatory for a campaign, either:

1. accept the two-segment cost, or
2. use an ASCII transliteration (for example `Eweputala ego nkwado gi`) and
   have that variant reviewed by the same fluent reviewer.

Do not silently strip diacritics: the plain-tone wording should stay the same
across both variants.

## Review checklist

- [ ] A fluent Igbo speaker confirms the tone is plain and respectful.
- [ ] `{quantity}` and the event keys match the English baseline exactly.
- [ ] No wallet addresses, transaction hashes, or private keys are included.
- [ ] Character counts and the UCS-2 segment note are re-checked after edits.
