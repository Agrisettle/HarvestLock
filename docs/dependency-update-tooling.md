# Dependency update tooling

## Current coverage

`.github/dependabot.yml` checks all five npm workspaces (`api/`, `buyer-app/`, `coop-pwa/`, `warehouse-app/`, and `site/`) weekly. It also updates GitHub Actions weekly. Minor and patch npm updates are grouped, and each ecosystem is limited to five open update PRs. The root package has no dependencies to update.

## Renovate comparison

Renovate is a capable alternative when a repository needs more detailed package rules, cross-directory grouping, update windows, custom managers, or carefully gated automerge. Its presets and package rules can express more specialized policies, but adopting it also adds a second configuration surface and requires enabling and maintaining the Renovate GitHub App or a self-hosted runner. Running both tools would create overlapping update PRs unless their ownership and package scopes were divided.

For this repository, those extra controls do not address a current coverage gap: Dependabot already covers every npm workspace and workflow action, groups routine updates, and caps PR volume. Dependabot also has options for more advanced grouping if the repository later needs them.

## Recommendation

Keep Dependabot as the sole version-update bot for now. Reconsider Renovate if Dependabot cannot express a specific workflow the maintainers need, such as a distinct cadence or merge policy for selected packages, or if updates need consistent rules across a broader set of repositories. If that need appears, pilot Renovate on one workspace and disable the overlapping Dependabot entry before expanding.

## References

- [Dependabot version update configuration](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file)
- [Dependabot update grouping](https://docs.github.com/en/code-security/dependabot/optimizing-pr-creation-version-updates)
- [Renovate configuration options](https://docs.renovatebot.com/configuration-options/)
- [Renovate onboarding](https://docs.renovatebot.com/getting-started/installing-onboarding/)
