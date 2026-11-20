/**
 * SMS copy, one table per locale. These strings are the reviewed copy
 * from docs/sms-templates.md (English baseline) and its Yoruba, Hausa and
 * Igbo translations -- copied verbatim, not paraphrased.
 * test/notifications.test.ts parses those markdown tables and fails if
 * this file and the docs ever drift apart, so the docs stay the place
 * translators and maintainers edit.
 */

export const SMS_EVENT_KEYS = [
  "advance_released",
  "checkpoint_marked",
  "delivery_confirmed",
  "dispute_flagged",
  "dispute_resolved",
  "settlement_complete",
] as const;

export type SmsEventKey = (typeof SMS_EVENT_KEYS)[number];

export const SMS_LOCALES = ["en", "yo", "ha", "ig"] as const;
export type SmsLocale = (typeof SMS_LOCALES)[number];

/** Which docs file each locale's copy comes from -- used by the drift test. */
export const TEMPLATE_SOURCE_FILES: Record<SmsLocale, string> = {
  en: "docs/sms-templates.md",
  yo: "docs/sms-templates.yoruba.md",
  ha: "docs/sms-templates.hausa.md",
  ig: "docs/sms-templates.igbo.md",
};

export const SMS_TEMPLATES: Record<SmsLocale, Record<SmsEventKey, string>> = {
  en: {
    advance_released: "HarvestLock: Your advance has been released. Contact your cooperative to collect it.",
    checkpoint_marked: "HarvestLock: Warehouse checkpoint confirmed. Your next advance stage is now open.",
    delivery_confirmed: "HarvestLock: Delivery confirmed for {quantity} units. Settlement is being prepared.",
    dispute_flagged: "HarvestLock: A dispute has been flagged. Actions are paused until it is resolved.",
    dispute_resolved: "HarvestLock: The dispute has been resolved. Normal processing has resumed.",
    settlement_complete: "HarvestLock: Settlement is complete. Funds have been sent to your cooperative.",
  },
  yo: {
    advance_released: "HarvestLock: A ti san owó ìṣáájú rẹ. Kàn sí ẹgbẹ́ alájọṣepọ̀ rẹ láti gbà á.",
    checkpoint_marked: "HarvestLock: A ti fọwọ́ sí àyẹ̀wò ilé ìpamọ́ ọjà. Ìpele owó ìṣáájú rẹ tó kàn ti ṣí.",
    delivery_confirmed: "HarvestLock: A ti fọwọ́ sí ìfijíṣẹ́ ẹyọ {quantity}. A ń ṣètò ìsanwó ìkẹyìn.",
    dispute_flagged: "HarvestLock: A ti gbé àríyànjiyàn dìde. Gbogbo ìgbésẹ̀ dúró títí a ó fi yanjú rẹ̀.",
    dispute_resolved: "HarvestLock: A ti yanjú àríyànjiyàn náà. Iṣẹ́ ti padà bọ̀ sípò.",
    settlement_complete: "HarvestLock: Ìsanwó ìkẹyìn ti parí. A ti fi owó ránṣẹ́ sí ẹgbẹ́ alájọṣepọ̀ rẹ.",
  },
  ha: {
    advance_released: "HarvestLock: An saki kuɗin gabanku. Ku tuntuɓi ƙungiyarku ta haɗin gwiwa don karɓa.",
    checkpoint_marked: "HarvestLock: An tabbatar da binciken rumbun ajiya. Mataki na gaba na kuɗin gabanku ya buɗe.",
    delivery_confirmed: "HarvestLock: An tabbatar da isar da kaya guda {quantity}. Ana shirya biyan ƙarshe.",
    dispute_flagged: "HarvestLock: An tayar da takaddama. An dakatar da ayyuka har sai an warware ta.",
    dispute_resolved: "HarvestLock: An warware takaddamar. Ayyuka sun ci gaba kamar yadda aka saba.",
    settlement_complete: "HarvestLock: An kammala biyan ƙarshe. An tura kuɗin zuwa ƙungiyarku ta haɗin gwiwa.",
  },
  ig: {
    advance_released: "HarvestLock: Ewepụtala ego nkwado gị. Kpọtụrụ otu gị ka i nweta ya.",
    checkpoint_marked: "HarvestLock: Ekwenyere ebe nlele ụlọ nkwakọba. Ogbo ego ọzọ gị megheela.",
    delivery_confirmed: "HarvestLock: Ekwenyere nnyefe ngwaahịa {quantity}. A na-akwado nkwụghachi.",
    dispute_flagged: "HarvestLock: Ewelitela esemokwu. A kwụsịtụrụ omume niile ruo mgbe edozi ya.",
    dispute_resolved: "HarvestLock: Edoziela esemokwu ahụ. Usoro nkịtị amalitela ọzọ.",
    settlement_complete: "HarvestLock: Emechara nkwụghachi ụgwọ. Ezigara ego na otu gị.",
  },
};

export function isSmsLocale(value: unknown): value is SmsLocale {
  return typeof value === "string" && (SMS_LOCALES as readonly string[]).includes(value);
}

/**
 * Renders one message. `{quantity}` is the only placeholder the reviewed
 * copy uses; docs/sms-templates.md asks for a short, grouped integer
 * ("1,200"), never a decimal.
 */
export function renderSms(locale: SmsLocale, eventKey: SmsEventKey, vars: { quantity?: number } = {}): string {
  const template = SMS_TEMPLATES[locale][eventKey];
  const quantity = Number.isFinite(vars.quantity) ? Math.trunc(vars.quantity as number).toLocaleString("en-US") : "";
  return template.replace("{quantity}", quantity);
}
