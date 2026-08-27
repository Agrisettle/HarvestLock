# contracts

Soroban escrow contract (Rust), one instance per commitment. Implements the
state machine in PRD §4.8: `Draft → Locked → Advance1_Released →
Checkpoint_Passed → Advance2_Released → Delivered → Settled`, with
`Cancelled` / `Defaulted` / `Disputed` exits.

Not started yet. First tasks are in `../ROADMAP.md`, Phase 0 Track B.
