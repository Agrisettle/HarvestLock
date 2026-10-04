import { useCallback, useEffect, useState } from "react";
import type { AllocationMember, CommitmentDetail as CommitmentDetailType } from "../api";
import { buildSetAllocationTx, getAllocationLedger, submitTx } from "../api";
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
  const [members, setMembers] = useState<AllocationMember[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<MemberRow[]>([emptyRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settable = SETTABLE_STATUSES.has(commitment.status);
  const isCooperative = walletAddress !== null && walletAddress === commitment.cooperative;

  const refresh = useCallback(() => {
    getAllocationLedger(contractId)
      .then((m) => setMembers(m))
      .catch(() => {
        // Best-effort, same convention as CancelSection/ReassignBuyerSection's
        // background polls -- a failed read on mount shouldn't break the
        // rest of the page for every viewer. A genuine failure here (vs.
        // "never set yet", already turned into `null` by getAllocationLedger
        // itself) just means the form shows again; set_allocation's own
        // one-time contract guard is what actually prevents a double-set,
        // not this read.
      })
      .finally(() => setLoaded(true));
  }, [contractId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!loaded) return null;
  // Array.isArray, not just `!== null` -- a malformed response (or a test
  // double shaped for a different endpoint) should read as "nothing to
  // show" here, not crash this component trying to .map() over it.
  const hasLedger = Array.isArray(members);
  if (!hasLedger && (!isCooperative || !settable)) return null;

  function updateRow(i: number, patch: Partial<MemberRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(i: number) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!walletAddress) return;

    const parsed = rows.map((r) => ({ phoneNumber: r.phoneNumber.trim(), shareBps: Number(r.shareBps) }));
    // Mirrors server.ts's set-allocation validation exactly -- same
    // "fail fast client-side, the API is what actually enforces it"
    // convention as every other form in this project.
    if (parsed.some((m) => m.phoneNumber.length === 0)) {
      setError("Every member needs a phone number.");
      return;
    }
    if (parsed.some((m) => !Number.isInteger(m.shareBps) || m.shareBps < 0 || m.shareBps > 10_000)) {
      setError("Every share must be a whole number between 0 and 10000 basis points.");
      return;
    }
    const totalBps = parsed.reduce((sum, m) => sum + m.shareBps, 0);
    if (totalBps > 10_000) {
      setError(`Shares sum to ${totalBps} basis points, over the 10000 (100%) ceiling.`);
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
      {error && <div className="error-banner">{error}</div>}

      {hasLedger && (
        <table className="allocation-table">
          <caption>Allocation ledger</caption>
          <thead>
            <tr>
              <th>Member hash</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {members!.map((m) => (
              <tr key={m.memberHash}>
                <td className="allocation-hash">{m.memberHash.slice(0, 12)}…</td>
                <td>{(m.shareBps / 100).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!hasLedger && isCooperative && settable && (
        <form className="allocation-form" onSubmit={handleSubmit}>
          <h4>Record member allocation</h4>
          {rows.map((row, i) => (
            <div className="allocation-row" key={i}>
              <input
                aria-label={`Member ${i + 1} phone number`}
                value={row.phoneNumber}
                onChange={(e) => updateRow(i, { phoneNumber: e.target.value })}
                placeholder="Phone number"
              />
              <input
                aria-label={`Member ${i + 1} share (basis points)`}
                value={row.shareBps}
                onChange={(e) => updateRow(i, { shareBps: e.target.value.replace(/[^0-9]/g, "") })}
                placeholder="Share (bps)"
                inputMode="numeric"
              />
              <button
                type="button"
                className="action-button secondary"
                onClick={() => removeRow(i)}
                disabled={rows.length === 1}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="action-button secondary" onClick={addRow}>
            Add member
          </button>
          <button className="action-button" type="submit" disabled={busy}>
            {busy ? "Recording…" : "Record allocation"}
          </button>
        </form>
      )}
    </div>
  );
}
