import "./Hero.css";

export function Hero() {
  return (
    <section id="top" className="hero">
      <div className="hero-mark" aria-hidden="true">
        <svg viewBox="0 0 1024 1024" width="100%" height="100%">
          <polygon points="512,200 222,824 802,824" fill="var(--gold)" />
          <polygon points="512,200 435,520 589,520" fill="var(--void)" />
          <polygon points="426,560 598,560 662,824 362,824" fill="var(--void)" />
        </svg>
      </div>

      <div className="wrap hero-inner">
        <div className="eyebrow">Stellar testnet — live</div>
        <h1>
          Commit before harvest.
          <br />
          Settle on delivery —<em> never on anyone&rsquo;s word.</em>
        </h1>
        <p className="lede hero-lede">
          HarvestLock is escrow infrastructure for agricultural forward
          contracts. A buyer&rsquo;s deposit sits in a neutral Soroban contract
          and releases only against an independent warehouse operator&rsquo;s
          grading receipt — not a claim from either side.
        </p>

        <div className="hero-cta">
          <a
            className="btn btn-primary"
            href="https://stellar.expert/explorer/testnet/contract/CDVF6UVJOLF3OHCFSYSJ72RMG2T6DUQ42VRJ6IHL6MVEFDYEBZ3KTFK4"
            target="_blank"
            rel="noreferrer"
          >
            View the live contract →
          </a>
          <a
            className="btn btn-ghost"
            href="https://claude.ai/code/artifact/c9a2f2a6-b9f2-4218-b4e8-60651ddfbb5d"
            target="_blank"
            rel="noreferrer"
          >
            Read the architecture
          </a>
        </div>

        <div className="hero-stats">
          <div className="hero-stat">
            <span className="hero-stat-num mono">24/24</span>
            <span className="hero-stat-label">contract tests passing</span>
          </div>
          <div className="hero-stat-rule" />
          <div className="hero-stat">
            <span className="hero-stat-num mono">7</span>
            <span className="hero-stat-label">on-chain states, lock to settlement</span>
          </div>
          <div className="hero-stat-rule" />
          <div className="hero-stat">
            <span className="hero-stat-num mono">0</span>
            <span className="hero-stat-label">stroops ever stuck in escrow</span>
          </div>
        </div>
      </div>
    </section>
  );
}
