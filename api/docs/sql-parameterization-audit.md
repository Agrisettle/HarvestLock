# PostgreSQL query parameterization audit

**Scope:** every query call in `api/src/db/*.ts` at the `fix/issue-165` review point. This is a static review of SQL construction and value flow, not a rewrite or a database penetration test. It does not cover SQL outside this directory or whether database roles/schema permissions are correctly provisioned.

## Result

No request-controlled value is concatenated or interpolated into a SQL statement. Values used by CRUD statements are passed separately as `pg` query parameters (`$1`, `$2`, …). Identifiers, clauses, and sort order are fixed in source. No current query needs a dynamic identifier; if one is added later, keep it allow-listed and quote it as an identifier rather than treating it as a value placeholder.

The migration runner is the one intentional exception to the placeholder pattern: it executes complete SQL text read from the repository's `api/src/db/migrations/*.sql` files. The filename list is filtered to `.sql`, sorted, and joined to a path derived from `import.meta.url`; it is not taken from an HTTP request or database value. This is trusted deployment code, not a parameterized CRUD query. Keep migrations review-controlled and do not allow user-writable files into that directory.

## Query inventory

| File | Query/work | Values and construction | Assessment |
|---|---|---|---|
| `allocationMembers.ts` | Insert allocation member rows; read members by contract; erase by member hash | Contract ID, phone number, shares, salt, hash, and lookup hash are bound parameters. Table/column names and ordering are fixed. | Parameterized; no dynamic SQL. |
| `commitments.ts` | Lock/read prior status; upsert commitment; list with limit/offset | Contract ID, all commitment fields, limit, and offset are bound parameters. Upsert column list and ordering are fixed. | Parameterized; pagination values are not interpolated. |
| `pendingMultisigProposals.ts` | Insert proposal; find active proposal; lookup by ID; lock proposal row; update signed entries; mark ready/completed | IDs, method, XDR, auth-entry JSON, and final XDR are bound parameters. Status literals and SQL structure are fixed. | Parameterized; serialized JSON remains a value, not SQL syntax. |
| `reputation.ts` | Read standing; upsert buyer default; insert event; increment forfeiture; conditionally bar address; insert event | Address and contract ID are bound parameters. Event/reason strings and update expressions are fixed literals. | Parameterized; no caller-supplied SQL fragments. |
| `migrate.ts` | Create/read migration ledger; apply migration; record applied filename | Ledger queries are fixed SQL; migration filename uses `$1`. Migration contents are executed as a complete trusted `.sql` file, as described above. | No request-controlled query construction. Treat migration files as executable code and review them accordingly. |
| `pool.ts` | Create the PostgreSQL pool | `DATABASE_URL` configures the driver connection; this module constructs no SQL statement. | Not a query-construction surface. |

Transaction control statements (`BEGIN`, `COMMIT`, `ROLLBACK`) are fixed literals. The inventory includes each `api/src/db/*.ts` module, including files with no dynamic query building.

## Recommendations

1. Preserve the current `pg` parameter-array pattern for every external or runtime value.
2. Keep table/column names and sort clauses static. If a future feature genuinely needs selectable identifiers or sort directions, choose from a source-code allow-list; placeholders cannot represent identifiers.
3. Keep migration SQL limited to reviewed repository files. Do not load migration content or migration paths from request input, environment-provided arbitrary paths, or writable application data.
4. Repeat this review when a new query or dynamic filter is introduced. This audit found no code fix warranted and intentionally makes no query rewrites.

