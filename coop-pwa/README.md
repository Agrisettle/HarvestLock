# coop-pwa

Cooperative-facing PWA (React + Vite). Phone-based auth, offline-tolerant
with a service-worker/IndexedDB queue (PRD §7 — connectivity loss at depot
is a named edge case, not an afterthought).

Note what this app is *not*: individual farmers never get an app. They get
SMS (and eventually USSD) only — PRD §13 (P3) and §16.1 (shared handsets)
both rule out an app for that user. Don't build one.

Not started yet. See `../ROADMAP.md`, Phase 1 (Mainnet + UX tranche).
