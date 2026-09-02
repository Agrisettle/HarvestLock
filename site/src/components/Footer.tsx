import "./Footer.css";

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <div className="footer-brand">
          <img src="/favicon.png" alt="" width={20} height={20} />
          <span>HarvestLock</span>
          <span className="footer-org">
            part of{" "}
            <a href="https://github.com/agrisettle" target="_blank" rel="noreferrer">
              Agrisettle
            </a>
          </span>
        </div>

        <div className="footer-links">
          <a href="/roles.html">Roles &amp; responsibilities</a>
          <a href="https://github.com/agrisettle/harvestlock" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a
            href="https://github.com/agrisettle/harvestlock/blob/main/docs/PRD.md"
            target="_blank"
            rel="noreferrer"
          >
            PRD
          </a>
          <a
            href="https://github.com/agrisettle/harvestlock/blob/main/LICENSE"
            target="_blank"
            rel="noreferrer"
          >
            Apache-2.0
          </a>
        </div>
      </div>
    </footer>
  );
}
