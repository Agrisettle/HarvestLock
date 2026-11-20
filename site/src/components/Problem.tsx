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
    <section id="problem" aria-labelledby="problem-heading">
      <div className="wrap">
        <Reveal as="div" className="section-head">
          <div className="eyebrow">The problem</div>
          <h2 id="problem-heading">The price crash isn&rsquo;t a market failure. It&rsquo;s a timing failure.</h2>
          <p className="lede">
            Harvest is the moment of maximum weakness — the crop is
            perishable, storage is scarce, and everyone sells at once. Four
            compounding failures keep it that way.
          </p>
        </Reveal>

        <ol className="problem-grid" role="list" aria-label="Compounding harvest timing failures">
          {failures.map((f, i) => (
            <Reveal
              as="li"
              key={f.n}
              delay={i * 90}
              className="problem-card"
              tabIndex={0}
              aria-label={`Failure ${f.n}: ${f.title}`}
            >
              <span className="problem-n mono" aria-hidden="true">{f.n}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
