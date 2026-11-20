# API dependency cache in CI

The API workflow uses `actions/setup-node` with `cache: npm` and
`cache-dependency-path: api/package-lock.json` before running `npm ci`.

`setup-node` caches npm's package download cache, not `api/node_modules`. Its
cache key includes the runner operating system, the package manager, and a hash
of the selected dependency file. A changed `api/package-lock.json` therefore
selects a new cache entry, while runs with the same lockfile can reuse the
downloaded package data. `npm ci` still installs from the lockfile on every
run, so the cache does not skip dependency installation or change which
versions are installed.

The explicit `api/package-lock.json` path matters because the workflow runs
commands from `api/`, but `setup-node` discovers dependency files relative to
the repository checkout. Pointing it at the API lockfile makes cache
invalidation follow the dependencies that `npm ci` actually installs, rather
than a root-level or unrelated lockfile.

Keep this configuration aligned with the install step: if the API lockfile is
moved or the API switches package managers, update `cache-dependency-path` and
the matching `cache` value together. When reviewing cache effectiveness,
compare `setup-node` cache-hit output and the `npm ci` duration across runs;
the cache helps most when dependency downloads are a meaningful part of the
job time.
