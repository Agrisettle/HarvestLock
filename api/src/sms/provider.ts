import { randomUUID } from "node:crypto";
import { ConfigurationError } from "../errors.js";

/**
 * The one thing the notification pipeline needs from an SMS gateway.
 * Kept this narrow on purpose: issue #7 flags provider choice (real
 * MTN/Airtel/Glo/9mobile delivery) as something to verify, not assume, so
 * swapping gateways must stay a one-file change.
 */
export interface SmsProvider {
  readonly name: string;
  /** `to` is digits-only international format, e.g. 2348012345678. Throws on rejection. */
  send(to: string, text: string): Promise<{ messageId: string | null }>;
}

/**
 * The default. Sends nothing and writes a log line with the number
 * redacted to its last four digits. This keeps local development, CI and
 * any deployment without a gateway key from texting real farmers --
 * enabling real delivery is an explicit SMS_PROVIDER=termii decision.
 */
export class LogSmsProvider implements SmsProvider {
  readonly name = "log";
  constructor(private readonly log: (msg: string) => void = (msg) => console.log(msg)) {}
  async send(to: string, text: string): Promise<{ messageId: string | null }> {
    this.log(`[sms:log] to=***${to.slice(-4)} chars=${text.length} text=${JSON.stringify(text)}`);
    return { messageId: `log-${randomUUID()}` };
  }
}

/**
 * Termii (https://developers.termii.com) -- the gateway PRD §17 names
 * (chosen there for its handling of Nigeria's DND registry) and the one
 * docs/sms-templates.md was written against. `POST
 * {base}/api/sms/send` with the API key in the JSON body is Termii's
 * documented "Send message" call.
 *
 * Not yet verified against a live Termii key from this repo. Before
 * first real use, check delivery to each of the four Nigerian networks,
 * whether the "dnd" channel (required to reach DND-registered numbers
 * with transactional traffic) is approved for the sender ID, and how the
 * accented Yoruba/Hausa/Igbo copy is billed (it is not GSM-7, so it goes
 * out as UCS-2 at a shorter per-segment length).
 */
export class TermiiSmsProvider implements SmsProvider {
  readonly name = "termii";
  constructor(
    private readonly opts: {
      apiKey: string;
      senderId: string;
      channel: string;
      baseUrl: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async send(to: string, text: string): Promise<{ messageId: string | null }> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(`${this.opts.baseUrl.replace(/\/+$/, "")}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.opts.apiKey,
        to,
        from: this.opts.senderId,
        sms: text,
        type: "plain",
        channel: this.opts.channel,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Non-JSON error page; status code below is still decisive.
    }
    if (!res.ok) {
      // Never echo the request (it carries the API key); only the
      // gateway's own status and message.
      const message = typeof (body as { message?: unknown })?.message === "string" ? (body as { message: string }).message : "";
      throw new Error(`termii rejected the message: HTTP ${res.status}${message ? ` -- ${message}` : ""}`);
    }
    const messageId = (body as { message_id?: unknown })?.message_id;
    return { messageId: typeof messageId === "string" || typeof messageId === "number" ? String(messageId) : null };
  }
}

/**
 * Picks the provider from deployment env. A misconfigured real provider
 * fails loudly (ConfigurationError) instead of silently falling back to
 * the log provider, which would let a deployment believe it is texting
 * farmers when it is not.
 */
export function smsProviderFromEnv(env: NodeJS.ProcessEnv = process.env): SmsProvider {
  const name = (env.SMS_PROVIDER ?? "log").trim().toLowerCase();
  if (name === "" || name === "log") return new LogSmsProvider();
  if (name === "termii") {
    const apiKey = env.TERMII_API_KEY?.trim();
    const senderId = env.TERMII_SENDER_ID?.trim();
    if (!apiKey || !senderId) {
      throw new ConfigurationError("SMS_PROVIDER=termii needs TERMII_API_KEY and TERMII_SENDER_ID");
    }
    return new TermiiSmsProvider({
      apiKey,
      senderId,
      // "dnd" by default: PRD §17 picked Termii *because* Nigeria's DND
      // registry silently eats transactional SMS on ordinary routes, and
      // the dnd channel is Termii's route around that. It needs the sender
      // ID approved for dnd; until it is, sends fail loudly (and retry),
      // which is better than silently never reaching DND numbers.
      channel: env.TERMII_CHANNEL?.trim() || "dnd",
      baseUrl: env.TERMII_BASE_URL?.trim() || "https://api.ng.termii.com",
    });
  }
  throw new ConfigurationError(`unknown SMS_PROVIDER "${name}" (expected "log" or "termii")`);
}

/**
 * Normalizes the free-text phone numbers the allocation form collects
 * into the digits-only international form gateways expect. Nigeria-only
 * on purpose (the pilot's geography): 0XXXXXXXXXX (11 digits) and
 * 234XXXXXXXXXX / +234... are accepted; anything else returns null and
 * the message is skipped with a recorded reason, never guessed at.
 */
export function normalizeNigerianPhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) return null;
  if (/^0[789][01]\d{8}$/.test(digits)) return `234${digits.slice(1)}`;
  if (/^234[789][01]\d{8}$/.test(digits)) return digits;
  return null;
}
