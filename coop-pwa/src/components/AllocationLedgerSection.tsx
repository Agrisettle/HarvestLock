import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AllocationMember, CommitmentDetail as CommitmentDetailType } from "../api";
import { buildSetAllocationTx, getAllocationLedger, submitTx } from "../api";
import { useI18n } from "../i18n";
import { signTransactionXdr } from "../wallet";

// Mirrors lib.rs's set_allocation() guard: cooperative-gated, and only
// reachable before lock() moves the commitment out of Draft (PRD §4.8) —
// same reasoning as CommitmentDetail's canClaim check, avoiding an action
// the contract would just reject.
const SETTABLE_STATUSES = new Set(["Draft"]);

interface MemberRow {
  phoneNumber: string;
  // Kept as a string while editing, same convention as
  // CreateCommitmentForm's numeric text inputs.
  shareBps: string;
}

function emptyRow(): MemberRow {
  return { phoneNumber: "", shareBps: "" };
}

/**
 * PRD §4.8/§16.1's allocation ledger — the one gap `api/HANDOFF.md`'s
 * "next steps" flagged as API-complete but frontend-missing (item 9): the
 * contract/API side has been live and tested since Deployment 7, but no
 * coop-pwa UI ever collected member phone numbers/shares or displayed the
 * recorded ledger. Single-signer (cooperative only) — unlike
 * CancelSection/ReassignBuyerSection, this needs no multi-party
 * propose/sign/finalize staging, just a plain build -> sign -> submit,
 * same shape as CommitmentDetail's claim flow.
 *
 * A recorded ledger (hashes + shares, never a phone number — this contract
 * never stores one) is shown to anyone viewing the commitment once it
 * exists; only the *form* to create one is cooperative-and-pre-lock gated.
 */
export function AllocationLedgerSection({
  commitment,
  contractId,
  walletAddress,
}: {
  commitment: CommitmentDetailType;
  contractId: string;
  walletAddress: string | null;
}) {
  const { t, intlLocale } = useI18n();
  const [members, setMembers] = useState<AllocationMember[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [rows, setRows] = useState<MemberRow[]>([emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phoneInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const removeButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusAfterRowsChange = useRef<{ kind: "phone" | "remove"; index: number } | null>(null);

  const settable = SETTABLE_STATUSES.has(commitment.status);
  const isCooperative = walletAddress !== null && walletAddress === commitment.cooperative;
  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat(intlLocale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [intlLocale],
  );

  const refresh = useCallback(() => {
    setLoading(true);
    setReadError(null);
    getAllocationLedger(contractId)
      .then((m) => setMembers(m))
      .catch((err: unknown) => {
        setMembers(null);
        setReadError(
          t("allocation.readError", {
            contractId,
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      })
      .finally(() => setLoading(false));
  }, [contractId, t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const target = focusAfterRowsChange.current;
    if (!target) return;
    focusAfterRowsChange.current = null;
    if (target.kind === "phone") {
      phoneInputRefs.current[target.index]?.focus();
    } else {
      removeButtonRefs.current[target.index]?.focus();
    }
  }, [rows]);

  if (loading) {
    return (
      <div className="allocation-section">
        <div className="loading-state" role="status" aria-live="polite">{t("allocation.loading")}</div>
      </div>
    );
  }
  if (readError) {
    return (
      <div className="allocation-section">
        <div className="error-banner" role="alert">{readError}</div>
        <button className="action-button secondary" type="button" onClick={refresh}>{t("allocation.retry")}</button>
      </div>
    );
  }
  const hasLedger = members !== null;

  function updateRow(i: number, patch: Partial<MemberRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    focusAfterRowsChange.current = { kind: "phone", index: rows.length };
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(i: number) {
    if (rows.length === 1) return;
    const remainingRows = rows.length - 1;
    const nextIndex = Math.min(i, remainingRows - 1);
    focusAfterRowsChange.current =
      remainingRows === 1 ? { kind: "phone", index: 0 } : { kind: "remove", index: nextIndex };
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!walletAddress) return;

    const parsed = rows.map((r) => ({ phoneNumber: r.phoneNumber.trim(), shareBps: Number(r.shareBps) }));
    // Mirrors server.ts's set-allocation validation exactly -- same
    // "fail fast client-side, the API is what actually enforces it"
    // convention as every other form in this project.
    if (parsed.some((m) => m.phoneNumber.length === 0)) {
      setError(t("allocation.errorPhone"));
      return;
    }
    if (parsed.some((m) => !Number.isInteger(m.shareBps) || m.shareBps < 0 || m.shareBps > 10_000)) {
      setError(t("allocation.errorShareRange"));
      return;
    }
    const totalBps = parsed.reduce((sum, m) => sum + m.shareBps, 0);
    if (totalBps > 10_000) {
      setError(t("allocation.errorShareTotal", { total: totalBps }));
      return;
    }

    setError(null);
    setBusy(true);
    buildSetAllocationTx(contractId, parsed, walletAddress)
      .then(({ xdr, members: staged }) =>
        signTransactionXdr(xdr, walletAddress).then((signedXdr) =>
          submitTx(signedXdr, undefined, undefined, contractId, staged),
        ),
      )
      .then(() => refresh())
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="allocation-section">
      {error && <div className="error-banner" role="alert">{error}</div>}

      {!hasLedger && <p className="empty-state">{t("allocation.empty")}</p>}

      {hasLedger && (
        <table className="allocation-table">
          <caption>{t("allocation.caption")}</caption>
          <thead>
            <tr>
              <th>{t("allocation.memberHash")}</th>
              <th>{t("allocation.share")}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.memberHash}>
                <td className="allocation-hash">{`${m.memberHash.slice(0, 12)}…`}</td>
                <td>{t("common.percent", { value: percentFormatter.format(m.shareBps / 100) })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!hasLedger && isCooperative && settable && (
        <form className="allocation-form" onSubmit={handleSubmit}>
          <h2>{t("allocation.formHeading")}</h2>
          {rows.map((row, i) => (
            <div className="allocation-row" key={i}>
              <input
                ref={(element) => {
                  phoneInputRefs.current[i] = element;
                }}
                aria-label={t("allocation.memberPhoneLabel", { number: i + 1 })}
                value={row.phoneNumber}
                onChange={(e) => updateRow(i, { phoneNumber: e.target.value })}
                placeholder={t("allocation.phonePlaceholder")}
              />
              <input
                aria-label={t("allocation.memberShareLabel", { number: i + 1 })}
                value={row.shareBps}
                onChange={(e) => updateRow(i, { shareBps: e.target.value.replace(/[^0-9]/g, "") })}
                placeholder={t("allocation.sharePlaceholder")}
                inputMode="numeric"
              />
              <button
                ref={(element) => {
                  removeButtonRefs.current[i] = element;
                }}
                type="button"
                className="action-button secondary"
                onClick={() => removeRow(i)}
                disabled={rows.length === 1}
              >
                {t("allocation.remove")}
              </button>
            </div>
          ))}
          <button type="button" className="action-button secondary" onClick={addRow}>
            {t("allocation.addMember")}
          </button>
          <button className="action-button" type="submit" disabled={busy}>
            {busy ? t("allocation.recording") : t("allocation.record")}
          </button>
        </form>
      )}
    </div>
  );
}
