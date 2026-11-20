# Spike: Push Updates Versus Polling

**Decision: keep the current polling and manual list refresh for now.** The
existing behavior is simple, bounded, and adequate for the project's current
scale; there is no production traffic evidence in the repository that would
justify an always-open connection service yet.

## Current behavior

- `CancelSection`, `ReassignBuyerSection`, and `DisputeSection` refresh an
  active pending proposal every 10 seconds. They stop polling when no proposal
  is pending, and cancellation/reassignment also stop once the proposal is
  ready for the viewer's next action.
- One waiting proposal viewer therefore makes up to 6 GET requests per minute
  (360 per hour). The API's current global rate limit is 100 requests per
  minute per IP, so 16 such viewers behind one IP could consume nearly the
  entire limit before normal reads and writes are counted. The actual number
  of simultaneous proposals per viewer can vary.
- Commitment-list refresh is manual, not a periodic poll. A successful write
  refreshes the relevant detail view; users can explicitly refresh the list.
- Postgres is a cache, not a chain indexer. The list cache changes when an API
  read or write refreshes a commitment. Push notifications alone would not
  discover arbitrary state changes made directly on Stellar.

## Options and cost

| Option | Benefit | Cost and risk | Rough implementation estimate |
|---|---|---|---|
| Keep 10-second polling | No new infrastructure; predictable recovery after missed requests; at most 10 seconds of normal proposal-state delay | 6 GETs/minute per waiting proposal viewer; shared-IP rate limit can matter as concurrency grows | No change |
| Server-Sent Events (SSE) for proposals | One-way server-to-browser updates fit proposal status; fewer repeated GETs and faster updates | Add stream lifecycle, keepalives, reconnect behavior, event delivery after each proposal mutation, and integration tests. Multiple API instances need shared event delivery (for example Postgres notifications); a connection alone does not solve cache/indexing freshness. Verify Render proxy behavior. | About 2–4 engineering days for a deployable first version, including shared-instance behavior and tests |
| WebSockets | Supports two-way low-latency messaging | More connection, protocol, reconnection, and operational complexity than needed for server-to-client status changes; still needs event delivery and state recovery | About 4–7 engineering days for a production-ready first version |

Estimates assume proposal updates only, not a live replacement for every
commitment list refresh. Extending push to commitment state would also require
a reliable source of changes outside this API's own write requests or an
indexer/background watcher, which is explicitly not present today.

## Revisit when

Measure active pending-proposal viewers, proposal-poll request volume, rate
limit responses, and user-reported waiting delay before changing the design.
Reconsider SSE if polling becomes a material share of the per-IP request
budget, causes observed `429` responses, or the 10-second update delay blocks
real cooperative workflows. If that threshold is reached, prototype SSE for
proposal state only, retain the GET endpoint for initial state and reconnect
recovery, and leave the manually refreshed list unchanged until its own
freshness requirement is demonstrated.

Do not build either transport solely to make the architecture appear more
real-time. At today's unproven traffic level, its always-on connections,
recovery paths, and multi-instance event-delivery requirements outweigh the
saved polling requests.