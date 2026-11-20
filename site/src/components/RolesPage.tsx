import "./Roles.css";
import { Footer } from "./Footer";

/**
 * Roles & Responsibilities — the disclosure page every buyer sees before
 * creating a commitment (linked from buyer-app's CreateCommitmentForm
 * consent checkbox, PRD-adjacent but not in the PRD itself: this exists
 * so a defaulted or forfeiting party can never say they weren't told the
 * consequence in advance). A standalone static page, not a section on the
 * homepage — it needs its own stable link, and it isn't marketing copy.
 *
 * This explains the *product's* rules in plain language. It is not a
 * substitute for whatever binding legal terms eventually govern the
 * platform (none exist yet) — see the closing note.
 */
export function RolesPage() {
  return (
    <>
      <a href="#roles-content" className="skip-link">
        Skip to content
      </a>
      <main id="roles-content" tabIndex={-1}>
        <section className="roles-hero" aria-labelledby="roles-hero-title">
          <div className="wrap">
            <a href="/" className="roles-back" aria-label="Back to HarvestLock homepage">
              <span aria-hidden="true">←</span> HarvestLock
            </a>
            <span className="eyebrow">Before you commit</span>
            <h1 id="roles-hero-title">Roles &amp; responsibilities</h1>
            <p className="lede">
              What a buyer and a cooperative each owe one another on HarvestLock, what counts as
              failing to deliver on that, and what happens next. Read this before locking a
              commitment — not after.
            </p>
            <p className="roles-updated">Last updated 2 September 2026</p>
          </div>
        </section>

        <section className="roles-section" aria-labelledby="roles-money-title">
          <div className="wrap">
            <h2 id="roles-money-title">How a commitment moves money</h2>
            <p>
              Every commitment escrows funds in two steps, not one. Knowing both matters for
              understanding the default rules below.
            </p>
            <div className="roles-columns">
              <div className="roles-card">
                <h3>1. Deposit, at lock</h3>
                <ul>
                  <li>
                    When the buyer locks the commitment, only a <em>deposit</em> is escrowed — the
                    two advance-payment shares agreed at creation, not the full contract value.
                  </li>
                  <li>The cooperative can claim each advance share once its window opens.</li>
                </ul>
              </div>
              <div className="roles-card">
                <h3>2. Remainder, before delivery</h3>
                <ul>
                  <li>
                    When the cooperative signals it's setting out for delivery, the buyer's
                    remaining balance becomes due and is escrowed too, within a set window.
                  </li>
                  <li>Only once delivery is confirmed does any of this release to the cooperative.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="roles-section" aria-labelledby="roles-buyer-title">
          <div className="wrap">
            <h2 id="roles-buyer-title">The buyer's side</h2>
            <div className="roles-columns">
              <div className="roles-card">
                <h3>What's expected</h3>
                <ul>
                  <li>Escrow the deposit when locking the commitment.</li>
                  <li>
                    Fund the remaining balance within the window once the cooperative signals it's
                    ready to deliver. Both balances — what's already escrowed and what's still
                    owed — are visible on the commitment at all times.
                  </li>
                  <li>
                    Confirm delivery once the goods are verified received, so payment can release
                    to the cooperative.
                  </li>
                </ul>
              </div>
              <div className="roles-card">
                <h3>What counts as default</h3>
                <span
                  className="roles-severity immediate"
                  role="status"
                  aria-label="Consequence severity: Immediate permanent bar"
                >
                  Immediate permanent bar
                </span>
                <ul>
                  <li>
                    Missing the remainder-funding deadline is a default — full stop. There is no
                    grace period and no partial credit for funding late; the window either closed
                    in time or it didn't.
                  </li>
                  <li>
                    A default is enforced automatically once the deadline passes: whatever's
                    currently escrowed on that commitment goes to the cooperative, and the
                    commitment is marked <code>Defaulted</code> on-chain, permanently.
                  </li>
                  <li>
                    Off the chain, a default also means an <strong>immediate, permanent bar</strong>{" "}
                    from creating or being added to any future commitment on this platform — on the
                    first occurrence, not a third. This page is that advance notice.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="roles-section" aria-labelledby="roles-coop-title">
          <div className="wrap">
            <h2 id="roles-coop-title">The cooperative's side</h2>
            <div className="roles-columns">
              <div className="roles-card">
                <h3>What's expected</h3>
                <ul>
                  <li>
                    Progress the commitment as the season goes: release advance tranches, mark the
                    mid-season checkpoint, and signal ready-for-delivery when it's time to ship.
                  </li>
                  <li>
                    Actually deliver, and have the delivery confirmed, before the commitment's
                    overall delivery deadline.
                  </li>
                  <li>
                    <strong>The cooperative can never access escrowed funds early.</strong> Every
                    stroop sits in the commitment's own contract until it's explicitly claimed
                    (an advance, once its window opens) or the commitment settles — there is no
                    way to withdraw escrow ahead of that, by design.
                  </li>
                </ul>
              </div>
              <div className="roles-card">
                <h3>What counts as forfeiture</h3>
                <span
                  className="roles-severity graduated"
                  role="status"
                  aria-label="Consequence severity: Graduated — three before a bar"
                >
                  Graduated — three before a bar
                </span>
                <ul>
                  <li>
                    Not delivering — for any reason, including selling the crop elsewhere — before
                    the delivery deadline is a forfeiture. Any escrow still held on that commitment
                    returns to the buyer, and the commitment is marked <code>Forfeited</code>{" "}
                    on-chain, permanently.
                  </li>
                  <li>
                    Because the cooperative genuinely never had access to that money, a first or
                    second forfeiture is recorded against the cooperative's standing but does{" "}
                    <strong>not</strong> by itself bar them — legitimate reasons for a failed
                    delivery exist, and one bad season shouldn't end a cooperative's standing.
                  </li>
                  <li>
                    A <strong>third</strong> forfeiture is a pattern, not an incident. At that
                    point the cooperative is barred from future commitments, the same way an
                    immediate buyer default is.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="roles-section" aria-labelledby="roles-windows-title">
          <div className="wrap">
            <h2 id="roles-windows-title">Window lengths</h2>
            <p>
              Every commitment sets its own window lengths at creation — a buyer or cooperative
              agreeing to a commitment should check the actual values on that specific commitment,
              not assume the defaults below. These are simply the values HarvestLock suggests when
              a commitment is created:
            </p>
            <div
              className="roles-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Commitment window lengths"
            >
              <table className="roles-windows-table">
                <caption className="roles-table-caption">
                  Default commitment window durations and trigger points
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Window</th>
                    <th scope="col">Default duration</th>
                    <th scope="col">Starts when</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Remainder-payment window</th>
                    <td>7 days</td>
                    <td>the cooperative signals ready-for-delivery</td>
                  </tr>
                  <tr>
                    <th scope="row">Delivery window</th>
                    <td>120 days</td>
                    <td>the commitment is created</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="roles-section" aria-labelledby="roles-appeals-title">
          <div className="wrap">
            <h2 id="roles-appeals-title">Appeals</h2>
            <div className="roles-appeal">
              <p>
                A default or a bar-triggering forfeiture that's already happened on-chain can't be
                undone — the escrow movement and the status are permanent by design, the same way
                any settled transaction is.
              </p>
              <p>
                The <strong>off-chain bar</strong> is a separate thing, and it isn't automatic or
                final. If you're a buyer or a cooperative affected by one and believe there's a
                legitimate explanation — and what you intend to do about it — reach out to{" "}
                <a
                  className="text-link"
                  href="mailto:samuelojetunde898@gmail.com"
                  aria-label="Send appeal email to samuelojetunde898@gmail.com"
                >
                  samuelojetunde898@gmail.com
                </a>
                . A real person reviews every appeal; there's no automated reinstatement.
              </p>
            </div>
          </div>
        </section>

        <section className="roles-section" aria-label="Platform legal disclosure">
          <div className="wrap">
            <p>
              This page explains how the HarvestLock product actually behaves — the rules its
              smart contract and platform enforce — so no one commits without knowing them
              upfront. It is not a substitute for a binding legal agreement between the parties to
              a commitment, which does not yet exist as a separate document.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
