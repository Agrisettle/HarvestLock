import "./Nav.css";

export function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <a href="#top" className="nav-brand" aria-label="HarvestLock homepage">
          <img src="/favicon.png" alt="" width={26} height={26} aria-hidden="true" />
          <span>HarvestLock</span>
        </a>
        <nav className="nav-links" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#status">Status</a>
          <a href="#partners">Partners</a>
          <a
            href="https://github.com/Agrisettle/HarvestLock"
            target="_blank"
            rel="noreferrer noopener"
            className="nav-github"
            aria-label="View Agrisettle/HarvestLock repository on GitHub (opens in a new tab)"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
