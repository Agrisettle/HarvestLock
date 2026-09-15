# Demo video script — pitch-only cut

**Recorded — [watch it here](https://github.com/Agrisettle/HarvestLock/releases/tag/demo-v1).** ~108 seconds, matches the scene breakdown below exactly. What actually got captured, vs. what was originally planned:

- **Scenes 1, 2, 5** (landing page): the real, live [GitHub Pages preview](https://agrisettle.github.io/HarvestLock/), exactly as planned below.
- **Scenes 3, 4** (dashboards): upgraded from the original plan — rather than showing the GitHub Pages preview's UI with no data behind it, these were recorded against a **local API pointed at real Stellar testnet**, reading a real throwaway commitment (`CDMGPVBEFG35ULSRELQVI3FIATB53PKKJOUWXTPGJOLVJX4R5X27CFD4` and `CAX5JJ4UE3DYFZHBEJUMZ33R3S5I5Y6F4YVJ6ER2N33XL65EJFJOJ5FW`) driven through its actual on-chain lifecycle via `stellar-cli` for this recording — real status badges, real deadlines, real balances, not placeholder data. No local Postgres was available, so the unrelated `/commitments` cache-list feature was hidden for these shots (a recording-environment gap, not a product bug — see `api/HANDOFF.md`); the actual commitment-detail reads never touch Postgres at all.
- **Voiceover**: Microsoft Edge neural TTS (`edge-tts`, free, no API key, voice `en-US-AndrewNeural`), not ElevenLabs — generated from this file's exact narration text, word-for-word.
- **Wallet-gated sections** (Cancel/Reassign/Dispute, the primary lock/settle button): correctly render nothing in the recording, since no Freighter extension was available to connect a real wallet — same long-documented limitation as this project's own test suites. Real, honest behavior, not a bug.

The original plan (kept below for reference and for anyone re-recording this):

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
