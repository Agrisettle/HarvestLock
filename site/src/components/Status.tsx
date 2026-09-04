import { Reveal } from "./Reveal";
import { useLiveStatus } from "../hooks/useLiveStatus";
import "./Status.css";

const REFERENCE_CONTRACT_ID = "CDVF6UVJOLF3OHCFSYSJ72RMG2T6DUQ42VRJ6IHL6MVEFDYEBZ3KTFK4";

const shipped = [
  "Full escrow state machine, Draft through Settled",
  "Claim/reclaim-with-expiry for both advance tranches",
  "Mutual cancellation, buyer- and cooperative-co-signed",
  "Warehouse-operator-gated attestation steps",
  "30/30 tests passing, deployed and exercised live on testnet",
  "API: full lifecycle, testnet-verified, powers the badge below",
];

const next = [
  "Per-member allocation ledger (salted, not raw identifiers)",
  "Settlement against a real warehouse receipt, not a boolean gate",
  "Buyer-position assignability",
  "Buyer default and dispute paths",
];

export function Status() {
  const liveStatus = useLiveStatus(REFERENCE_CONTRACT_ID);

  return (
    <section id="status">
      <div className="wrap">
        <Reveal as="div" className="section-head">
          <div className="eyebrow">Where this actually stands</div>
          <h2>Pre-validation. Building in the open, not behind a deck.</h2>
          <p className="lede">
            No pilot partner announced yet. What exists is real, tested, and
            checkable — not a mockup standing in for a product.
          </p>
        </Reveal>

        <div className="status-grid">
          <Reveal as="div" className="status-col">
            <h3 className="status-col-title">Shipped</h3>
            <ul className="status-list">
              {shipped.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Reveal>
          <Reveal as="div" delay={90} className="status-col">
            <h3 className="status-col-title status-col-title--next">Next</h3>
            <ul className="status-list status-list--next">
              {next.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal as="div" delay={140} className="status-links">
          <a
            className="status-link"
            href="https://github.com/Agrisettle/HarvestLock"
            target="_blank"
            rel="noreferrer"
          >
            <span className="status-link-label">Repository</span>
            <span className="mono status-link-value">Agrisettle/HarvestLock</span>
          </a>
          <a
            className="status-link"
            href="https://github.com/Agrisettle/HarvestLock-Contracts"
            target="_blank"
            rel="noreferrer"
          >
            <span className="status-link-label">Contract source</span>
            <span className="mono status-link-value">agrisettle/HarvestLock-Contracts</span>
          </a>
          <a
            className="status-link"
            href="https://stellar.expert/explorer/testnet/contract/CDVF6UVJOLF3OHCFSYSJ72RMG2T6DUQ42VRJ6IHL6MVEFDYEBZ3KTFK4"
            target="_blank"
            rel="noreferrer"
          >
            <span className="status-link-label">Testnet contract</span>
            <span className="mono status-link-value">
              CDVF6U…FK4
              {liveStatus && <span className="status-live-badge">{liveStatus}</span>}
            </span>
          </a>
        </Reveal>
      </div>
    </section>
  );
}
