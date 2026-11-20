import "dotenv/config";
import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { randomBytes } from "node:crypto";
import { pool } from "../src/db/pool.js";
import type { Commitment } from "../src/stellar/client.js";
import * as clientModule from "../src/stellar/client.js";
import * as commitmentsDb from "../src/db/commitments.js";
import { recordAllocationMembers, stageAllocationMembers, eraseAllocationMember } from "../src/db/allocationMembers.js";
import {
  recordNotificationEvents,
  deliverPendingMessages,
  getNotificationSummary,
  smsLocaleFromEnv,
  MAX_SMS_ATTEMPTS,
} from "../src/notifications.js";
import {
  SMS_TEMPLATES,
  SMS_EVENT_KEYS,
  SMS_LOCALES,
  TEMPLATE_SOURCE_FILES,
  renderSms,
} from "../src/sms/templates.js";
import {
  normalizeNigerianPhone,
  smsProviderFromEnv,
  TermiiSmsProvider,
  LogSmsProvider,
  type SmsProvider,
} from "../src/sms/provider.js";
import { ConfigurationError } from "../src/errors.js";

/**
 * Issue #7. Real local Postgres, no DB mocks, same as reputation.test.ts.
 * Contract IDs are random per test so runs never collide on
 * sms_events' UNIQUE constraint. The SMS gateway is always a capturing
 * fake or a stubbed fetch: nothing here sends a real message.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function randomContractId(): string {
  return `CFAKE${Keypair.random().publicKey()}`;
}

function commitment(status: string, overrides: Partial<Commitment> = {}): Commitment {
  const addr = Keypair.random().publicKey();
  return {
    buyer: addr,
    cooperative: addr,
    warehouse_operator: addr,
    token: addr,
    total_amount: 1_000_000_000n,
    advance1_bps: 1500,
    advance2_bps: 2000,
    claim_window_secs: 3600n,
    remainder_window_secs: 3600n,
    status,
    created_at: 0n,
    delivery_deadline: 0n,
    advance1_deadline: 0n,
    advance1_claimed: false,
    advance1_expired: false,
    advance2_deadline: 0n,
    advance2_claimed: false,
    advance2_expired: false,
    remainder_deadline: 0n,
    remainder_funded: false,
    contracted_quantity: 1_000,
    grade_price_bps: [10_000],
    delivered_quantity: 0,
    grade_index: 0,
    settlement_bps: 0,
    fx_resolved: false,
    fx_adjusted_total: 0n,
    fx_shortfall_amount: 0n,
    fx_shortfall_funded: false,
    fx_shortfall_deadline: 0n,
    dispute_pre_status: "Draft",
    dispute_deadline: 0n,
    ...overrides,
  } as Commitment;
}

async function seedMembers(contractId: string, phones: string[]): Promise<string[]> {
  const staged = stageAllocationMembers(phones.map((phoneNumber) => ({ phoneNumber, shareBps: 100 })));
  await recordAllocationMembers(contractId, staged);
  return staged.map((m) => m.memberHash);
}

class CapturingProvider implements SmsProvider {
  readonly name = "capture";
  sent: { to: string; text: string }[] = [];
  failWith: Error | null = null;
  async send(to: string, text: string) {
    if (this.failWith) throw this.failWith;
    this.sent.push({ to, text });
    return { messageId: `m${this.sent.length}` };
  }
}

async function messageStatuses(contractId: string): Promise<string[]> {
  const { rows } = await pool.query<{ status: string }>(
    `SELECT m.status FROM sms_messages m JOIN sms_events e ON e.id = m.event_id
     WHERE e.contract_id = $1 ORDER BY m.status`,
    [contractId],
  );
  return rows.map((r) => r.status);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SMS templates", () => {
  // Parses the reviewed copy straight out of the docs tables, so a
  // translator editing docs/ and a developer editing templates.ts can't
  // silently diverge.
  function docTemplates(file: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of readFileSync(join(repoRoot, file), "utf8").split("\n")) {
      const m = /^\|\s*`([a-z_]+)`\s*\|\s*(HarvestLock:[^|]+?)\s*\|/.exec(line);
      if (m) out[m[1]!] = m[2]!;
    }
    return out;
  }

  for (const locale of SMS_LOCALES) {
    it(`${locale} copy matches ${TEMPLATE_SOURCE_FILES[locale]} exactly`, () => {
      const docs = docTemplates(TEMPLATE_SOURCE_FILES[locale]);
      for (const key of SMS_EVENT_KEYS) {
        expect(SMS_TEMPLATES[locale][key], `${locale}/${key}`).toBe(docs[key]);
      }
    });
  }

  it("every rendered message stays inside the docs' 140-character budget", () => {
    for (const locale of SMS_LOCALES) {
      for (const key of SMS_EVENT_KEYS) {
        expect(renderSms(locale, key, { quantity: 1_200_000 }).length).toBeLessThanOrEqual(140);
      }
    }
  });

  it("formats {quantity} as a grouped integer, never a decimal", () => {
    expect(renderSms("en", "delivery_confirmed", { quantity: 1200.7 })).toBe(
      "HarvestLock: Delivery confirmed for 1,200 units. Settlement is being prepared.",
    );
  });

  it("rejects an unknown SMS_LOCALE at boot", () => {
    expect(smsLocaleFromEnv({ SMS_LOCALE: "yo" })).toBe("yo");
    expect(smsLocaleFromEnv({})).toBe("en");
    expect(() => smsLocaleFromEnv({ SMS_LOCALE: "fr" })).toThrow(ConfigurationError);
  });
});

describe("normalizeNigerianPhone", () => {
  it.each([
    ["08031234567", "2348031234567"],
    ["+2348031234567", "2348031234567"],
    ["234 803 123 4567", "2348031234567"],
    ["0703-123-4567", "2347031234567"],
    ["09011234567", "2349011234567"],
  ])("accepts %s", (raw, expected) => {
    expect(normalizeNigerianPhone(raw)).toBe(expected);
  });

  it.each(["", "12345", "+447700900123", "0803123456", "phone", "08631234567"])("rejects %s", (raw) => {
    expect(normalizeNigerianPhone(raw)).toBeNull();
  });
});

describe("recordNotificationEvents", () => {
  it("queues one message per allocated member for a fresh transition, exactly once", async () => {
    const contractId = randomContractId();
    await seedMembers(contractId, ["08030000001", "08030000002", "08030000003"]);

    expect(await recordNotificationEvents(contractId, "Locked", commitment("Advance1Released"), "en")).toBe(3);
    // Same status observed again (every GET does this): nothing new.
    expect(await recordNotificationEvents(contractId, "Advance1Released", commitment("Advance1Released"), "en")).toBe(0);

    const { rows } = await pool.query(
      `SELECT DISTINCT m.body, m.locale FROM sms_messages m JOIN sms_events e ON e.id = m.event_id WHERE e.contract_id = $1`,
      [contractId],
    );
    expect(rows).toEqual([{ body: SMS_TEMPLATES.en.advance_released, locale: "en" }]);
  });

  it("is exactly-once under concurrent observations of the same transition", async () => {
    const contractId = randomContractId();
    await seedMembers(contractId, ["08030000011", "08030000012"]);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => recordNotificationEvents(contractId, "Locked", commitment("Advance1Released"), "en")),
    );
    expect(results.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("treats the two advance tranches as separate events", async () => {
    const contractId = randomContractId();
    await seedMembers(contractId, ["08030000021"]);
    expect(await recordNotificationEvents(contractId, "Locked", commitment("Advance1Released"), "en")).toBe(1);
    expect(await recordNotificationEvents(contractId, "CheckpointPassed", commitment("Advance2Released"), "en")).toBe(1);
  });

  it("records but never texts a backfill (first ever observation is already past Draft)", async () => {
    const contractId = randomContractId();
    await seedMembers(contractId, ["08030000031"]);
    expect(await recordNotificationEvents(contractId, null, commitment("Settled"), "en")).toBe(0);
    const summary = await getNotificationSummary(contractId);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ event_key: "settlement_complete", suppressed: true });
  });

  it("numbers repeated disputes and pairs each with its resolution", async () => {
    const contractId = randomContractId();
    await seedMembers(contractId, ["08030000041"]);

    expect(await recordNotificationEvents(contractId, "Advance1Released", commitment("Disputed"), "en")).toBe(1);
    expect(await recordNotificationEvents(contractId, "Disputed", commitment("Disputed"), "en")).toBe(0);
    // Resolved back to the frozen status: dispute_resolved #1, and the
    // status's own advance_released (first time seen here) too.
    expect(await recordNotificationEvents(contractId, "Disputed", commitment("Advance1Released"), "en")).toBe(2);
    expect(await recordNotificationEvents(contractId, "Advance1Released", commitment("Disputed"), "en")).toBe(1);

    const events = (await getNotificationSummary(contractId)).map((e) => `${e.event_key}#${e.occurrence}`);
    expect(events.sort()).toEqual(["advance_released#1", "dispute_flagged#1", "dispute_flagged#2", "dispute_resolved#1"]);
  });

  it("doesn't announce the end of a dispute members were never told about", async () => {
    const contractId = randomContractId();
    await seedMembers(contractId, ["08030000051"]);
    expect(await recordNotificationEvents(contractId, null, commitment("Disputed"), "en")).toBe(0); // backfill
    expect(await recordNotificationEvents(contractId, "Disputed", commitment("Locked"), "en")).toBe(0);
    const resolved = (await getNotificationSummary(contractId)).find((e) => e.event_key === "dispute_resolved");
    expect(resolved?.suppressed).toBe(true);
  });

  it("records the event with no messages when there's no allocation", async () => {
    const contractId = randomContractId();
    expect(await recordNotificationEvents(contractId, "Locked", commitment("Advance1Released"), "en")).toBe(0);
    expect(await getNotificationSummary(contractId)).toHaveLength(1);
  });

  it("renders the delivered quantity and the configured locale", async () => {
    const contractId = randomContractId();
    await seedMembers(contractId, ["08030000061"]);
    await recordNotificationEvents(contractId, "ReadyForDelivery", commitment("Delivered", { delivered_quantity: 1200 }), "ha");
    const { rows } = await pool.query(
      `SELECT m.body FROM sms_messages m JOIN sms_events e ON e.id = m.event_id WHERE e.contract_id = $1`,
      [contractId],
    );
    expect(rows[0].body).toBe("HarvestLock: An tabbatar da isar da kaya guda 1,200. Ana shirya biyan ƙarshe.");
  });
});

describe("deliverPendingMessages", () => {
  it("sends each queued message once, to the normalized number", async () => {
    const contractId = randomContractId();
    await seedMembers(contractId, ["0803 000 0071", "+2348030000072"]);
    await recordNotificationEvents(contractId, "Locked", commitment("Advance1Released"), "en");

    const provider = new CapturingProvider();
    expect(await deliverPendingMessages(provider, { contractId })).toEqual({ sent: 2, retrying: 0, failed: 0, skipped: 0 });
    expect(provider.sent.map((s) => s.to).sort()).toEqual(["2348030000071", "2348030000072"]);
    expect(provider.sent[0]!.text).toBe(SMS_TEMPLATES.en.advance_released);

    // `sent` is terminal: a second run sends nothing.
    expect(await deliverPendingMessages(provider, { contractId })).toEqual({ sent: 0, retrying: 0, failed: 0, skipped: 0 });
    expect(provider.sent).toHaveLength(2);
  });

  it("skips a member erased after the message was queued (NDPA s.34), and unusable numbers", async () => {
    const contractId = randomContractId();
    const [erased] = await seedMembers(contractId, ["08030000081", "not a phone"]);
    await recordNotificationEvents(contractId, "Locked", commitment("Advance1Released"), "en");
    await eraseAllocationMember(erased!);

    const provider = new CapturingProvider();
    expect(await deliverPendingMessages(provider, { contractId })).toEqual({ sent: 0, retrying: 0, failed: 0, skipped: 2 });
    expect(provider.sent).toHaveLength(0);
    expect(await messageStatuses(contractId)).toEqual(["skipped", "skipped"]);
  });

  it("retries a gateway failure on later runs, then gives up at the attempt limit", async () => {
    const contractId = randomContractId();
    await seedMembers(contractId, ["08030000091"]);
    await recordNotificationEvents(contractId, "Locked", commitment("Advance1Released"), "en");

    const provider = new CapturingProvider();
    provider.failWith = new Error("gateway down");
    for (let attempt = 1; attempt < MAX_SMS_ATTEMPTS; attempt++) {
      expect(await deliverPendingMessages(provider, { contractId })).toMatchObject({ retrying: 1 });
    }
    expect(await deliverPendingMessages(provider, { contractId })).toMatchObject({ failed: 1 });
    expect(await messageStatuses(contractId)).toEqual(["failed"]);
    // Terminal: never picked up again.
    provider.failWith = null;
    expect(await deliverPendingMessages(provider, { contractId })).toMatchObject({ sent: 0 });
  });

  it("keeps phone numbers out of every SMS table, before and after delivery and erasure", async () => {
    // docs/identity-session-model.md asks for an erasure test that walks
    // every new table. The outbox is designed never to hold a number; this
    // proves it at each stage.
    const contractId = randomContractId();
    const [hash] = await seedMembers(contractId, ["08030000121"]);
    await recordNotificationEvents(contractId, "Locked", commitment("Advance1Released"), "en");
    const dump = async () =>
      (
        await pool.query(
          `SELECT row_to_json(e)::text || row_to_json(m)::text AS j
           FROM sms_events e JOIN sms_messages m ON m.event_id = e.id WHERE e.contract_id = $1`,
          [contractId],
        )
      ).rows.map((r) => r.j as string).join("");
    expect(await dump()).not.toMatch(/8030000121/);
    await deliverPendingMessages(new CapturingProvider(), { contractId });
    expect(await dump()).not.toMatch(/8030000121/);
    await eraseAllocationMember(hash!);
    expect(await dump()).not.toMatch(/8030000121/);
  });

  it("never lets two concurrent runs send the same message", async () => {
    const contractId = randomContractId();
    await seedMembers(contractId, ["08030000101", "08030000102", "08030000103"]);
    await recordNotificationEvents(contractId, "Locked", commitment("Advance1Released"), "en");
    const provider = new CapturingProvider();
    await Promise.all([1, 2, 3].map(() => deliverPendingMessages(provider, { contractId })));
    expect(provider.sent).toHaveLength(3);
  });
});

describe("SMS providers", () => {
  it("defaults to the log provider, which sends nothing and redacts the number", async () => {
    expect(smsProviderFromEnv({})).toBeInstanceOf(LogSmsProvider);
    const lines: string[] = [];
    await new LogSmsProvider((l) => lines.push(l)).send("2348031234567", "hi");
    expect(lines[0]).toContain("***4567");
    expect(lines[0]).not.toContain("2348031234567");
  });

  it("refuses SMS_PROVIDER=termii without credentials, and unknown providers", () => {
    expect(() => smsProviderFromEnv({ SMS_PROVIDER: "termii" })).toThrow(ConfigurationError);
    expect(() => smsProviderFromEnv({ SMS_PROVIDER: "carrier-pigeon" })).toThrow(ConfigurationError);
    expect(smsProviderFromEnv({ SMS_PROVIDER: "termii", TERMII_API_KEY: "k", TERMII_SENDER_ID: "HarvestLk" })).toBeInstanceOf(
      TermiiSmsProvider,
    );
  });

  it("calls Termii's send endpoint with the documented body", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message_id: "9122821270554876574" }), { status: 200 }));
    const provider = new TermiiSmsProvider({
      apiKey: "secret-key",
      senderId: "HarvestLk",
      channel: "dnd",
      baseUrl: "https://api.ng.termii.com/",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await provider.send("2348031234567", "hello")).toEqual({ messageId: "9122821270554876574" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.ng.termii.com/api/sms/send");
    expect(JSON.parse(init.body as string)).toEqual({
      api_key: "secret-key",
      to: "2348031234567",
      from: "HarvestLk",
      sms: "hello",
      type: "plain",
      channel: "dnd",
    });
  });

  it("surfaces a Termii rejection without leaking the API key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "Insufficient balance" }), { status: 400 }));
    const provider = new TermiiSmsProvider({
      apiKey: "secret-key",
      senderId: "HarvestLk",
      channel: "generic",
      baseUrl: "https://api.ng.termii.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const err = await provider.send("2348031234567", "hello").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("Insufficient balance");
    expect((err as Error).message).not.toContain("secret-key");
  });
});

// Last: buildServer's onClose ends the shared pool (see server.test.ts).
describe("HTTP wiring", () => {
  const provider = new CapturingProvider();
  let app: Awaited<ReturnType<typeof import("../src/server.js").buildServer>> | undefined;

  afterAll(async () => {
    await app?.close();
  });

  it("GET /commitments/:id records, sends, and reports member SMS without exposing recipients", async () => {
    const { buildServer } = await import("../src/server.js");
    app = await buildServer({ smsProvider: provider });
    // A real contract-ID shape (the route validates it); random so the
    // UNIQUE constraints never see a previous run.
    const validId = StrKey.encodeContract(randomBytes(32));
    await seedMembers(validId, ["08030000111", "08030000112"]);

    // The chain read and the cache write are both stubbed. The cache
    // stub stops this test from adding a row to the shared commitments
    // table, which server.test.ts's pagination tests count exactly. It
    // reports the commitment as previously cached at Locked, so this
    // read is a fresh Locked → Advance1Released transition, not a backfill.
    vi.spyOn(clientModule, "getCommitment").mockResolvedValue(commitment("Advance1Released"));
    vi.spyOn(commitmentsDb, "upsertCommitment").mockResolvedValue({
      row: {} as commitmentsDb.CommitmentRow,
      previousStatus: "Locked",
    });
    expect((await app.inject({ method: "GET", url: `/commitments/${validId}` })).statusCode).toBe(200);

    await vi.waitFor(() => expect(provider.sent).toHaveLength(2));

    await vi.waitFor(async () => {
      const res = await app!.inject({ method: "GET", url: `/commitments/${validId}/notifications` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events).toHaveLength(1);
      expect(body.events[0]).toMatchObject({
        event_key: "advance_released",
        occurrence: 1,
        suppressed: false,
        messages: { sent: 2, pending: 0, sending: 0, failed: 0, skipped: 0 },
      });
      expect(JSON.stringify(body)).not.toMatch(/0803|234803/);
    });
  });

  it("rejects a malformed contract ID on the notifications route", async () => {
    const res = await app!.inject({ method: "GET", url: "/commitments/not-a-contract/notifications" });
    expect(res.statusCode).toBe(400);
  });
});
