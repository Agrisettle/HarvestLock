# api

HarvestLock API (TypeScript/Node). Owns contract orchestration, the
allocation ledger's off-chain identity map, voucher issuance/redemption
tracking, and warehouse receipt attestation intake. Talks to the Soroban
contract via `@stellar/stellar-sdk` and to SDP (deployed, not forked — PRD
§17.1) over its own HTTP API.

Not started yet. See `../ROADMAP.md`, Phase 1 (MVP and Testnet tranches).
