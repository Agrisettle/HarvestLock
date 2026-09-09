# Demo video script — pitch-only cut

**Target length:** ~2 minutes (≈290 words at a natural ~140 wpm AI voiceover pace)
**What this shows:** the live [GitHub Pages preview](https://agrisettle.github.io/HarvestLock/) — the landing page and all three product dashboards (`buyer-app`, `coop-pwa`, `warehouse-app`). No live API sits behind that preview (see the README's Deployment section), so this cut demonstrates the *design and interaction model*, not a live transaction — the script is written to be honest about that, on camera, not to paper over it.
**What this doesn't show:** a real testnet transaction end to end. That's the *functional* cut — a separate script, needs a local API + Postgres + a funded Freighter wallet running, and is worth doing once that setup is convenient to record against.

Voiceover tool suggestion: ElevenLabs (free tier is enough for a ~290-word script) or another natural-sounding TTS service — see the process notes in the conversation this script came out of for the full recording → voiceover → editing pipeline.

---

## Scene 1 — Hook (0:00–0:15)

**Screen:** Landing page hero (`agrisettle.github.io/HarvestLock`), on load, before scrolling.

**Voiceover:**
> "A cooperative needs capital before harvest. A buyer wants supply assurance. Right now, one of them has to trust the other's word. HarvestLock removes that — with an escrow contract on Stellar."

**On-screen caption:** *Forward commitments, without the trust problem.*

---

## Scene 2 — The mechanism (0:15–0:45)

**Screen:** Scroll the landing page to the "How it works" four-step section (Agree the deal → Lock the funds → Advance the cooperative → Deliver & settle). Pause on each step icon roughly in sync with the corresponding sentence below.

**Voiceover:**
> "Here's how it works. The buyer and cooperative agree a price and quantity before harvest. The buyer's deposit locks into a Soroban escrow contract — not into either party's hands. A capped advance reaches the cooperative early, so they can plant with real capital. And the final payout only releases once an independent warehouse operator confirms the grain actually arrived — not against anyone's say-so."

**On-screen caption:** *Escrow. Not custody.*

---

## Scene 3 — Buyer dashboard walkthrough (0:45–1:15)

**Screen:** Navigate to `/buyer/`. Show a commitment's detail view — status badge, the lock/settle action button, then scroll to reveal the Cancel and Reassign sections' buttons (don't need to actually click through the multi-party flow, just show the buttons/labels exist).

**Voiceover:**
> "The buyer's dashboard shows exactly where a commitment stands — locked, in checkpoint, ready for delivery — and only offers the actions that make sense at that stage. Cancelling needs both parties to agree. Reassigning the position needs three signatures. And if something genuinely goes wrong, any of the three parties can flag a dispute — freezing the contract until it's resolved, never one side deciding alone."

**On-screen caption:** *No single party ever acts unilaterally.*

---

## Scene 4 — Cooperative + warehouse dashboards (1:15–1:45)

**Screen:** Navigate to `/coop/` — show the tranche table and its claim action. Then `/warehouse/` — show the "Mark mid-season checkpoint" button and the confirm-delivery form (quantity + grade fields).

**Voiceover:**
> "The cooperative claims each advance tranche directly from their own dashboard. And the warehouse operator — the independent party in the middle — is the one who actually confirms delivery: quantity and grade, against a schedule both sides agreed on before harvest. That's what makes settlement possible — and once it's confirmed, settlement itself needs no one's permission to run."

**On-screen caption:** *Verified by the warehouse. Not either party's word.*

---

## Scene 5 — Honest close (1:45–2:05)

**Screen:** Back to the landing page footer / status section (the "pre-pilot, testnet only" language), then a final card showing the GitHub org/repo.

**Voiceover:**
> "This is pre-pilot software, running on Stellar testnet — no cooperative or buyer has moved real money through it yet, and we say so, openly, in the docs. Everything you just saw is real, tested code, not a mockup. If you want to see how it works, or help build what's still open — the repository's public, right now."

**On-screen caption:** *github.com/Agrisettle/HarvestLock*

---

## Production notes

- **Pacing:** write for ~140 words/minute when generating the voiceover — faster reads rushed on a technical script like this one; slower drags. Most TTS tools let you set a speed multiplier if the default read feels off.
- **Captions:** burn in the bracketed caption line for each scene, not the full voiceover text — captions should be a beat, not a transcript, since most first-time viewers watch muted.
- **Recording:** capture each scene as its own short clip (matches the scene breaks above) rather than one continuous take — makes it trivial to re-record just one scene if the voiceover timing doesn't match, and to reorder scenes later if needed.
- **Cursor movement:** keep it slow and deliberate on screen — this is a walkthrough people are meant to actually read, not a fast scroll.
- **Music:** optional, low and unobtrusive under the voiceover if used at all — this script doesn't need it to land.
