import { Reveal } from "./Reveal";
import "./Problem.css";

const failures = [
  {
    n: "01",
    title: "No price certainty before planting",
    body: "The farmer alone carries months of input cost against a price nobody can predict until the crop is already in the ground.",
  },
  {
    n: "02",
    title: "No cash before harvest",
    body: "Even a willing future buyer has no mechanism to advance value early — exactly when it would actually help.",
  },
  {
    n: "03",
    title: "No verifiable distribution",
    body: "Where cooperatives do capture better prices, members can’t confirm what reached them versus what stopped at the top.",
  },
  {
    n: "04",
    title: "No currency transparency",
    body: "Cross-border settlement is opaque to anyone without a fast, trustworthy way to check the local-currency equivalent.",
  },
];

export function Problem() {
  return (
    <section id="problem">
      <div className="wrap">
        <Reveal as="div" className="section-head">
          <div className="eyebrow">The problem</div>
          <h2>The price crash isn&rsquo;t a market failure. It&rsquo;s a timing failure.</h2>
          <p className="lede">
            Harvest is the moment of maximum weakness — the crop is
            perishable, storage is scarce, and everyone sells at once. Four
            compounding failures keep it that way.
          </p>
        </Reveal>

        <div className="problem-grid">
          {failures.map((f, i) => (
            <Reveal as="div" key={f.n} delay={i * 90} className="problem-card">
              <span className="problem-n mono">{f.n}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
