# First PR walkthrough

This guide is for someone new to HarvestLock and Soroban. You do not need to understand Soroban to contribute to the buyer app, cooperative PWA, warehouse app, site, or API. The Soroban contract is maintained in the separate [`HarvestLock-Contracts`](https://github.com/Agrisettle/HarvestLock-Contracts) repository; contract source changes belong there, not in this repository.

## 1. Pick one small, scoped change

Start with the relevant GitHub issue and read its acceptance criteria. Then read this repository's [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`HANDOFF.md`](../HANDOFF.md), and the relevant section of [`docs/PRD.md`](PRD.md). Check [`TASKS.md`](../TASKS.md) for overlapping work. If the issue is about the API, read [`api/README.md`](../api/README.md) and [`api/HANDOFF.md`](../api/HANDOFF.md) too. For a contract change, read the contract repository's [`HANDOFF.md`](https://github.com/Agrisettle/HarvestLock-Contracts/blob/main/HANDOFF.md) before editing.

The components are separate projects. For example, buyer-facing screens and their tests live in `buyer-app/src/`; API routes and their tests live in `api/src/` and `api/test/`. The escrow contract lives in `HarvestLock-Contracts/contracts/escrow/`, in its own repository. Keep a first contribution to one issue and one component.

## 2. Set up only the component you are changing

For the JavaScript apps, use a Node version allowed by the root `package.json` (`^20.19.0 || >=22.12.0`). Node 24 matches the buyer-app CI workflow. In the app directory, install from its lockfile and run the app's own scripts. For example, in `buyer-app/`:

```sh
npm ci
npx tsc -b --noEmit
npm run lint
npm test
npm run build
```

The buyer app needs the API running to load real data; its README documents `VITE_API_URL` and local setup. Its tests mock network calls, so they do not need a wallet, API, or testnet. Other app directories have their own README and CI workflow. The API also has a live-testnet suite; do not run that suite casually because it sends real testnet transactions and needs configured credentials. Its CI runs only the network-free tests against a Postgres service.

For a contract change, first clone [`HarvestLock-Contracts`](https://github.com/Agrisettle/HarvestLock-Contracts) separately. The contract workflow installs stable Rust and checks formatting, then runs the host-target tests. From that repository's root, the matching commands are:

```sh
cargo fmt --check --manifest-path contracts/escrow/Cargo.toml
cd contracts/escrow
cargo test --locked --verbose
```

These tests use Soroban's Rust test utilities and do not need a Stellar CLI or a testnet account. Building a deployable WebAssembly contract is a separate check: `stellar contract build` requires the Stellar CLI (and, on Linux, the system headers described in the contract repository's `docs/dev-setup-troubleshooting.md`). A contract build is not a substitute for `cargo test`.

If you only want to make a documentation change, you can skip installing JavaScript or Rust dependencies. Review the referenced code and workflow files, and run `git diff --check` before committing.

## 3. Make and check the smallest useful change

Follow the issue's acceptance criteria and keep the diff focused. Add or update tests with behavior changes. If a decision affects documented project state, update the relevant README or HANDOFF in the same PR. Do not claim that a feature is deployed or testnet-verified unless the relevant code and verification actually support that claim.

Run the checks for the component you changed. The workflows under `.github/workflows/` show the exact CI commands; they are path-scoped, so only relevant components run for a change. Contract checks run in the separate contract repository. Include any checks you could not run in your PR description.

## 4. Create a fork and issue branch

Fork `Agrisettle/HarvestLock` on GitHub, then clone your fork and add the project repository as `upstream`:

```sh
git clone https://github.com/YOUR_GITHUB_USERNAME/HarvestLock.git
cd HarvestLock
git remote add upstream https://github.com/Agrisettle/HarvestLock.git
git fetch upstream
git switch -c fix/issue-123 upstream/main
```

Replace `YOUR_GITHUB_USERNAME` with your account and `123` with the issue number. If you already have a checkout, fetch `upstream` and base a fresh issue branch on `upstream/main` instead of recloning.

## 5. Commit and open the PR

Use a short Conventional Commit subject such as `fix: handle an empty commitment list` or `docs: explain the buyer-app test setup`, then commit and push your branch:

```sh
git add path/to/changed-file
git commit -m "docs: explain the buyer-app test setup"
git push -u origin fix/issue-123
```

On GitHub, open a PR from your fork's branch to `Agrisettle/HarvestLock`'s `main` branch. Describe the change, list the checks you ran, and link the issue with `Closes #123` when the PR resolves it. The repository's CI and assignment check run on the PR; a PR title should use a type accepted by `.github/workflows/validate-pr-title.yml`.
