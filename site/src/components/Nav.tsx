import "./Nav.css";

export function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <a href="#top" className="nav-brand">
          <img src="/favicon.png" alt="" width={26} height={26} />
          <span>HarvestLock</span>
        </a>
        <nav className="nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#status">Status</a>
          <a href="#partners">Partners</a>
          <a
            href="https://github.com/agrisettle/harvestlock"
            target="_blank"
            rel="noreferrer"
            className="nav-github"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
