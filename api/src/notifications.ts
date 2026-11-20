import type { PoolClient } from "pg";
import { pool } from "./db/pool.js";
import type { Commitment } from "./stellar/client.js";
import { ConfigurationError } from "./errors.js";
import { renderSms, isSmsLocale, type SmsEventKey, type SmsLocale } from "./sms/templates.js";
import { normalizeNigerianPhone, type SmsProvider } from "./sms/provider.js";

/**
 * SMS notifications to allocated member farmers (issue #7, PRD §6/§13:
 * farmers are SMS-only, no app).
 *
 * Shape, deliberately the same as src/reputation.ts:
 *  - Observation-triggered. It runs wherever the API already refreshes
 *    its commitments cache from a live chain read (GET
 *    /commitments/:id, and /transactions/submit's refreshContractId).
 *    There is no chain indexer or background poller, so it has the same
 *    accepted staleness caveat as the cache: a transition nobody reads
 *    is not noticed until someone does.
 *  - Exactly-once comes from a UNIQUE constraint (sms_events), never
 *    from comparing against the previously cached status.
 *
 * Who receives what (v1): every allocated member of the commitment with a
 * phone number still on file, for the six events docs/sms-templates.md
 * defines. Commitments without an allocation have nobody to text and
 * record the event only. Texting the cooperative lead is deliberately
 * out of scope here: the API has no cooperative-to-phone binding until
 * the identity/session model (#5) exists, and the lead already has
 * coop-pwa.
 */

/** Status → the farmer-relevant event it represents. Dispute events are handled separately. */
const STATUS_EVENTS: Record<string, { eventKey: SmsEventKey; occurrence: number }> = {
  Advance1Released: { eventKey: "advance_released", occurrence: 1 },
  CheckpointPassed: { eventKey: "checkpoint_marked", occurrence: 1 },
  Advance2Released: { eventKey: "advance_released", occurrence: 2 },
  Delivered: { eventKey: "delivery_confirmed", occurrence: 1 },
  Settled: { eventKey: "settlement_complete", occurrence: 1 },
};

export const MAX_SMS_ATTEMPTS = 5;
/** A message stuck in `sending` this long (a crashed delivery run) may be claimed again. */
const STALE_CLAIM_INTERVAL = "5 minutes";

export interface NotificationConfig {
  provider: SmsProvider;
  locale: SmsLocale;
}

export function smsLocaleFromEnv(env: NodeJS.ProcessEnv = process.env): SmsLocale {
  const locale = (env.SMS_LOCALE ?? "en").trim().toLowerCase();
  if (!isSmsLocale(locale)) {
    throw new ConfigurationError(`SMS_LOCALE must be one of en, yo, ha, ig; got "${locale}"`);
  }
  return locale;
}

interface CandidateEvent {
  eventKey: SmsEventKey;
  occurrence: number;
  suppressed: boolean;
}

/**
 * Works out which events the observed state implies and records any that
 * are new, queuing one message per allocated member for each. Safe to call
 * any number of times for the same observation, concurrently included:
 * a per-contract advisory lock serializes the dispute-numbering read and
 * the UNIQUE constraint makes every insert idempotent.
 *
 * `previousStatus` is used for one thing only: if the cache had never
 * seen this contract (null) and it is already past Draft, everything it
 * implies is a backfill, not a fresh transition. That covers commitments
 * that predate this feature, or that were driven entirely outside this
 * API. Those events are recorded as suppressed rather than texted. A
 * farmer who gets "settlement is complete" for a deal that closed months
 * ago is worse off than one who gets nothing.
 *
 * Returns the number of messages newly queued.
 */
export async function recordNotificationEvents(
  contractId: string,
  previousStatus: string | null,
  commitment: Commitment,
  locale: SmsLocale,
): Promise<number> {
  const backfill = previousStatus === null && commitment.status !== "Draft";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [contractId]);

    const candidates = await candidateEvents(client, contractId, commitment.status, backfill);
    let queued = 0;
    for (const c of candidates) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO sms_events (contract_id, event_key, occurrence, suppressed)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (contract_id, event_key, occurrence) DO NOTHING
         RETURNING id`,
        [contractId, c.eventKey, c.occurrence, c.suppressed],
      );
      const eventRow = inserted.rows[0];
      if (!eventRow || c.suppressed) continue;
      const body = renderSms(locale, c.eventKey, { quantity: commitment.delivered_quantity });
      const messages = await client.query(
        `INSERT INTO sms_messages (event_id, allocation_member_id, locale, body)
         SELECT $1, am.id, $2, $3
         FROM allocation_members am
         WHERE am.contract_id = $4 AND am.phone_number IS NOT NULL
         ON CONFLICT (event_id, allocation_member_id) DO NOTHING`,
        [eventRow.id, locale, body, contractId],
      );
      queued += messages.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return queued;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Disputes can happen more than once per commitment, and `Disputed` has
 * no "resolved" status of its own (a resolved dispute returns to the
 * status it froze, see docs/sms-templates.md). So each dispute gets a
 * running number. A new dispute_flagged is recorded when the contract is
 * Disputed and no dispute is open. The open one's dispute_resolved is
 * recorded the first time the contract is seen out of Disputed again.
 */
async function candidateEvents(
  client: PoolClient,
  contractId: string,
  status: string,
  backfill: boolean,
): Promise<CandidateEvent[]> {
  const { rows } = await client.query<{ event_key: SmsEventKey; occurrence: number; suppressed: boolean }>(
    `SELECT event_key, occurrence, suppressed FROM sms_events
     WHERE contract_id = $1 AND event_key IN ('dispute_flagged', 'dispute_resolved')`,
    [contractId],
  );
  const flagged = rows.filter((r) => r.event_key === "dispute_flagged");
  const resolved = new Set(rows.filter((r) => r.event_key === "dispute_resolved").map((r) => r.occurrence));
  const lastFlagged = flagged.reduce<{ occurrence: number; suppressed: boolean } | null>(
    (max, r) => (max === null || r.occurrence > max.occurrence ? r : max),
    null,
  );
  const openDispute = lastFlagged && !resolved.has(lastFlagged.occurrence) ? lastFlagged : null;

  const out: CandidateEvent[] = [];
  if (status === "Disputed") {
    if (!openDispute) {
      out.push({ eventKey: "dispute_flagged", occurrence: (lastFlagged?.occurrence ?? 0) + 1, suppressed: backfill });
    }
    return out;
  }
  if (openDispute) {
    // Members who were never told about the dispute shouldn't hear it ended.
    out.push({ eventKey: "dispute_resolved", occurrence: openDispute.occurrence, suppressed: openDispute.suppressed });
  }
  const statusEvent = STATUS_EVENTS[status];
  if (statusEvent) out.push({ ...statusEvent, suppressed: backfill });
  return out;
}

export interface DeliveryResult {
  sent: number;
  retrying: number;
  failed: number;
  skipped: number;
}

/**
 * Sends queued messages (optionally only one contract's). Each message is
 * claimed (`sending`, attempts + 1) in a short transaction before any
 * network call, so concurrent runs never both send the same message.
 * `sent` is terminal, matching docs/sms-templates.md's "do not re-send on
 * retries after the gateway accepts the message". The remaining
 * duplicate window is a crash between the gateway accepting a message
 * and this row being updated. That one is accepted and not engineered
 * away.
 *
 * Retries are observation-driven too: a failed attempt goes back to
 * `pending` and is picked up by the next delivery run for that contract,
 * until MAX_SMS_ATTEMPTS, after which it is `failed`.
 */
export async function deliverPendingMessages(
  provider: SmsProvider,
  opts: { contractId?: string; limit?: number } = {},
): Promise<DeliveryResult> {
  const claimed = await pool.query<{
    id: string;
    attempts: number;
    body: string;
    phone_number: string | null;
  }>(
    `WITH claim AS (
       SELECT m.id FROM sms_messages m
       JOIN sms_events e ON e.id = m.event_id
       WHERE (m.status = 'pending'
              OR (m.status = 'sending' AND m.claimed_at < now() - interval '${STALE_CLAIM_INTERVAL}'))
         AND ($1::text IS NULL OR e.contract_id = $1)
       ORDER BY m.created_at
       LIMIT $2
       FOR UPDATE OF m SKIP LOCKED
     )
     UPDATE sms_messages m
     SET status = 'sending', attempts = m.attempts + 1, claimed_at = now()
     FROM claim, allocation_members am
     WHERE m.id = claim.id AND am.id = m.allocation_member_id
     RETURNING m.id, m.attempts, m.body, am.phone_number`,
    [opts.contractId ?? null, opts.limit ?? 50],
  );

  const result: DeliveryResult = { sent: 0, retrying: 0, failed: 0, skipped: 0 };
  for (const msg of claimed.rows) {
    // Read at send time, never copied: an erased member (NDPA s.34) is
    // skipped even if their message was queued before the erasure.
    if (msg.phone_number === null) {
      await finish(msg.id, "skipped", { lastError: "recipient's phone number was erased" });
      result.skipped++;
      continue;
    }
    const to = normalizeNigerianPhone(msg.phone_number);
    if (to === null) {
      await finish(msg.id, "skipped", { lastError: "phone number is not a recognisable Nigerian mobile number" });
      result.skipped++;
      continue;
    }
    try {
      const { messageId } = await provider.send(to, msg.body);
      await finish(msg.id, "sent", { provider: provider.name, providerMessageId: messageId });
      result.sent++;
    } catch (err) {
      const giveUp = msg.attempts >= MAX_SMS_ATTEMPTS;
      await finish(msg.id, giveUp ? "failed" : "pending", {
        provider: provider.name,
        lastError: err instanceof Error ? err.message : String(err),
      });
      if (giveUp) result.failed++;
      else result.retrying++;
    }
  }
  return result;
}

async function finish(
  id: string,
  status: "sent" | "pending" | "failed" | "skipped",
  detail: { provider?: string; providerMessageId?: string | null; lastError?: string },
): Promise<void> {
  await pool.query(
    `UPDATE sms_messages
     SET status = $2,
         provider = COALESCE($3, provider),
         provider_message_id = COALESCE($4, provider_message_id),
         last_error = $5,
         sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
     WHERE id = $1`,
    [id, status, detail.provider ?? null, detail.providerMessageId ?? null, detail.lastError ?? null],
  );
}

/**
 * The hook server.ts calls after every commitments-cache refresh. The
 * events are recorded (awaited: it is a fast local write), and delivery
 * is started but deliberately not awaited, so a slow or down gateway
 * never slows a commitment read or turns a successful submission into
 * an error. Delivery failures are logged and left for the next run.
 */
export async function notifyCommitmentObserved(
  contractId: string,
  previousStatus: string | null,
  commitment: Commitment,
  config: NotificationConfig,
  log: { warn: (obj: object, msg: string) => void },
): Promise<void> {
  const queued = await recordNotificationEvents(contractId, previousStatus, commitment, config.locale);
  if (queued === 0) {
    // Nothing new, but still give earlier failures their retry.
    const pending = await pool.query(
      `SELECT 1 FROM sms_messages m JOIN sms_events e ON e.id = m.event_id
       WHERE e.contract_id = $1 AND m.status IN ('pending', 'sending') LIMIT 1`,
      [contractId],
    );
    if (pending.rowCount === 0) return;
  }
  void deliverPendingMessages(config.provider, { contractId }).catch((err: unknown) => {
    log.warn({ err }, "SMS delivery run failed");
  });
}

export interface NotificationSummary {
  event_key: SmsEventKey;
  occurrence: number;
  suppressed: boolean;
  created_at: string;
  messages: { pending: number; sending: number; sent: number; failed: number; skipped: number };
}

/**
 * Public, per-commitment delivery summary. Counts only, no recipients,
 * numbers, or member hashes, consistent with this API never exposing the
 * identity map over a read endpoint (see db/allocationMembers.ts).
 */
export async function getNotificationSummary(contractId: string): Promise<NotificationSummary[]> {
  const { rows } = await pool.query<{
    event_key: SmsEventKey;
    occurrence: number;
    suppressed: boolean;
    created_at: Date;
    status: string | null;
    n: string;
  }>(
    `SELECT e.event_key, e.occurrence, e.suppressed, e.created_at, m.status, count(m.id) AS n
     FROM sms_events e LEFT JOIN sms_messages m ON m.event_id = e.id
     WHERE e.contract_id = $1
     GROUP BY e.id, m.status
     ORDER BY e.created_at, e.event_key, e.occurrence`,
    [contractId],
  );
  const byEvent = new Map<string, NotificationSummary>();
  for (const r of rows) {
    const key = `${r.event_key}:${r.occurrence}`;
    let entry = byEvent.get(key);
    if (!entry) {
      entry = {
        event_key: r.event_key,
        occurrence: r.occurrence,
        suppressed: r.suppressed,
        created_at: r.created_at.toISOString(),
        messages: { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 },
      };
      byEvent.set(key, entry);
    }
    if (r.status) entry.messages[r.status as keyof NotificationSummary["messages"]] += Number(r.n);
  }
  return [...byEvent.values()];
}
