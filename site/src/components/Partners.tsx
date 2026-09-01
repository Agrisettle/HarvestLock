import { Reveal } from "./Reveal";
import "./Partners.css";

export function Partners() {
  return (
    <section id="partners" className="partners">
      <div className="wrap">
        <Reveal as="div" className="partners-card">
          <div className="partners-mark" aria-hidden="true">
            <svg viewBox="0 0 1024 1024" width="100%" height="100%">
              <polygon points="512,200 222,824 802,824" fill="var(--pine)" />
              <polygon points="512,200 435,520 589,520" fill="var(--void)" />
              <polygon points="426,560 598,560 662,824 362,824" fill="var(--void)" />
            </svg>
          </div>
          <div className="partners-content">
            <div className="eyebrow">For partners</div>
            <h2>
              Running an outgrower programme, or a warehouse that grades and
              stores?
            </h2>
            <p className="lede">
              We&rsquo;re not fundraising or onboarding publicly yet — the
              pilot needs one real institutional off-taker and one warehouse
              operator before anything else. If that&rsquo;s you, the fastest
              way in is directly, not a form.
            </p>
            <div className="partners-cta">
              <a
                className="btn btn-primary"
                href="https://github.com/agrisettle/harvestlock/issues"
                target="_blank"
                rel="noreferrer"
              >
                Open an issue on GitHub →
              </a>
              <a
                className="btn btn-ghost"
                href="https://github.com/agrisettle/harvestlock/blob/main/docs/PRD.md"
                target="_blank"
                rel="noreferrer"
              >
                Read the full PRD first
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
