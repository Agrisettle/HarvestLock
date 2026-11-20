#!/usr/bin/env bash
# Interim GitHub Pages preview build -- same three-app assembly as
# vercel-build.sh, but for a GitHub Pages *project* site (served from
# https://<org>.github.io/HarvestLock/, one path segment deeper than
# Vercel's domain root) rather than the real Vercel deployment. No API
# is deployed alongside this -- GitHub Pages only serves static files,
# it can't host the Fastify/Postgres service at all (see README.md's
# Deployment section) -- so every write action (lock, settle, cancel,
# ...) will fail against whatever VITE_API_URL defaults to
# (http://localhost:3000, unreachable from a visitor's browser). This
# exists purely so the UI itself is browsable from the repo before the
# real Vercel + Render(/Neon) deployment lands; not a substitute for it.
# GITHUB_PAGES=true (set by the workflow that calls this, not here)
# is what flips each app's vite.config.ts to the /HarvestLock/<app>/
# base path instead of Vercel's /<app>/ or local dev's /.
set -euo pipefail

cd "$(dirname "$0")"

export GITHUB_PAGES=true

echo "==> building buyer-app"
(cd buyer-app && npm ci && npm run build)

echo "==> building coop-pwa"
(cd coop-pwa && npm ci && npm run build)

echo "==> building warehouse-app"
(cd warehouse-app && npm ci && npm run build)

echo "==> assembling combined output in ./gh-pages-dist"
rm -rf gh-pages-dist
mkdir -p gh-pages-dist
cp -r buyer-app/dist gh-pages-dist/buyer
cp -r coop-pwa/dist gh-pages-dist/coop
cp -r warehouse-app/dist gh-pages-dist/warehouse

# landing/index.html's three dashboard links are absolute root paths
# (/buyer/, /coop/, /warehouse/) since it was built for Vercel's domain
# root. A GitHub Pages project site needs them one level deeper --
# rewritten here at build time rather than forking the file, since
# these three exact strings are the only place the two platforms'
# paths actually diverge (see landing/index.html itself: everything
# else is in-page anchors or a data-URI favicon, no other absolute
# paths exist to catch).
sed \
  -e 's|href="/buyer/"|href="/HarvestLock/buyer/"|' \
  -e 's|href="/coop/"|href="/HarvestLock/coop/"|' \
  -e 's|href="/warehouse/"|href="/HarvestLock/warehouse/"|' \
  landing/index.html > gh-pages-dist/index.html

# GitHub Pages' default Jekyll processing would otherwise ignore/mangle
# files and folders starting with an underscore. Strictly unnecessary
# for actions/deploy-pages (which uploads this artifact directly, no
# Jekyll involved) -- included anyway since it's the standard,
# zero-cost safeguard against that class of surprise if the deploy
# mechanism here ever changes.
# Same reasoning as vercel-build.sh's copy of this file: robots.txt is
# only honored from the site root, and warehouse-app's own output sits
# one level down at /HarvestLock/warehouse/. Worth noting honestly:
# GitHub Pages is served from github.io's root domain, and crawlers only
# read robots.txt at a host's root -- so this file at
# /HarvestLock/robots.txt is served and verifiable, but only a real
# custom-domain deployment (Vercel) is where it will actually be obeyed.
cp warehouse-app/public/robots.txt gh-pages-dist/robots.txt

touch gh-pages-dist/.nojekyll
