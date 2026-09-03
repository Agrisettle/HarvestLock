#!/usr/bin/env bash
# Builds buyer-app and coop-pwa (still two separate codebases -- see
# TASKS.md/README.md for why they're deliberately not merged into one
# app) and stitches their output into a single deployable tree so
# Vercel serves both from one domain: /buyer/, /coop/, and a landing
# page at / that links to each. Referenced by vercel.json's buildCommand.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> building buyer-app"
(cd buyer-app && npm ci && npm run build)

echo "==> building coop-pwa"
(cd coop-pwa && npm ci && npm run build)

echo "==> assembling combined output in ./dist"
rm -rf dist
mkdir -p dist
cp -r buyer-app/dist dist/buyer
cp -r coop-pwa/dist dist/coop
cp landing/index.html dist/index.html
