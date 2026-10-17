#!/usr/bin/env bash
# Builds buyer-app, coop-pwa, and warehouse-app (still three separate
# codebases -- see TASKS.md/README.md for why they're deliberately not
# merged into one app) and stitches their output into a single
# deployable tree so Vercel serves all three from one domain: /buyer/,
# /coop/, /warehouse/, and a landing page at / that links to each.
# Referenced by vercel.json's buildCommand.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> building buyer-app"
(cd buyer-app && npm ci && npm run build)

echo "==> building coop-pwa"
(cd coop-pwa && npm ci && npm run build)

echo "==> building warehouse-app"
(cd warehouse-app && npm ci && npm run build)

echo "==> assembling combined output in ./dist"
rm -rf dist
mkdir -p dist
cp -r buyer-app/dist dist/buyer
cp -r coop-pwa/dist dist/coop
cp -r warehouse-app/dist dist/warehouse
cp landing/index.html dist/index.html

# robots.txt is only honored when served from the domain root, but this
# app's own build output (with the robots.txt copied from its public/
# directory) lands one level down at /warehouse/ -- see vite.config.ts's
# base. Copy warehouse-app's file (the only app that has one; it's the
# internal operational tool that shouldn't be indexed) up to the root of
# the assembled tree so crawlers actually read it. The whole domain here
# is internal tooling -- only site/, deployed separately, is meant to be
# publicly indexed -- so a root-level Disallow: / is correct for it.
cp warehouse-app/public/robots.txt dist/robots.txt
