import { Reveal } from "./Reveal";
import "./HowItWorks.css";

const steps = [
  {
    state: "Draft",
    fn: "initialize()",
    body: "Buyer and cooperative agree price and quantity off-chain. The contract is created — no funds move yet.",
  },
  {
    state: "Locked",
    fn: "lock()",
    body: "The buyer’s full deposit moves into a neutral Soroban contract. Not the buyer’s wallet, not the cooperative’s — the contract’s.",
  },
  {
    state: "Advance released",
    fn: "release_advance_1() → claim_advance_1()",
    body: "A capped pre-harvest advance opens for the cooperative to claim within a window — or it reverts to the buyer if the window lapses unclaimed.",
  },
  {
    state: "Checkpoint passed",
    fn: "mark_checkpoint()",
    body: "The warehouse operator — not either party — attests to mid-season progress.",
  },
  {
    state: "Second advance",
    fn: "release_advance_2() → claim_advance_2()",
    body: "Same claim-or-expire mechanic, second tranche.",
  },
  {
    state: "Delivered",
    fn: "confirm_delivery()",
    body: "The warehouse operator confirms the harvest actually arrived. This is the only signature that can assert it did.",
  },
  {
    state: "Settled",
    fn: "settle()",
    body: "Every stroop still held by the contract pays out. Balance afterward: zero.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works">
      <div className="wrap">
        <Reveal as="div" className="section-head">
          <div className="eyebrow">How it works</div>
          <h2>Seven states. One contract per commitment. No step skippable.</h2>
          <p className="lede">
            This is not a diagram of a plan — it&rsquo;s the actual state machine
            deployed and exercised on Stellar testnet, function names
            included.
          </p>
        </Reveal>

        <ol className="steps">
          {steps.map((s, i) => (
            <Reveal as="li" key={s.state} delay={i * 70} className="step">
              <div className="step-marker">
                <span className="mono">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="step-body">
                <div className="step-head">
                  <h3>{s.state}</h3>
                  <code className="step-fn">{s.fn}</code>
                </div>
                <p>{s.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
