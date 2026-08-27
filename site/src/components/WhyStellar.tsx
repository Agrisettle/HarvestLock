import { Reveal } from "./Reveal";
import "./WhyStellar.css";

const reasons = [
  {
    title: "Stellar Disbursement Platform",
    body: "Split settlement payouts to many recipients cheaply — the primitive this needed already exists, deployed rather than rebuilt.",
  },
  {
    title: "Claimable-balance semantics",
    body: "Advance tranches claim within a window or revert to the buyer — built natively into the contract, exercised and verified on testnet.",
  },
  {
    title: "Reflector",
    body: "SEP-40 FX reference for cross-border settlement, without running a price oracle from scratch.",
  },
  {
    title: "Licensed anchors",
    body: "Fiat on/off-ramp handled by regulated anchors — this contract never touches fiat, and never needs to.",
  },
];

export function WhyStellar() {
  return (
    <section id="why-stellar">
      <div className="wrap why-wrap">
        <Reveal as="div" className="why-head">
          <div className="eyebrow">Why Stellar</div>
          <h2>Built on primitives that already exist</h2>
          <p className="lede">
            Every piece below is an integration, not a research problem —
            the hard part was never the blockchain.
          </p>
        </Reveal>

        <div className="why-list">
          {reasons.map((r, i) => (
            <Reveal as="div" key={r.title} delay={i * 80} className="why-item">
              <div className="why-bar" />
              <div>
                <h3>{r.title}</h3>
                <p>{r.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
