#!/bin/sh
# Door 2 — FULL NODE of Bitcoin mainnet KRAY. Separate folder/port from Signet.
# Assistants: docs/RUN-NODE.md first (quiz + preflight --universe main).
cd "$(dirname "$0")/../.." || exit 1
# Libraries, once — so "download and run this" just works, with no separate npm step to remember.
if [ ! -d apps/kray-core/node_modules ]; then
  echo "Installing libraries once (apps/kray-core) — this happens only the first time…"
  ( cd apps/kray-core && npm ci ) || { echo "  npm ci failed. Install Node.js 24+, then run: cd apps/kray-core && npm ci"; exit 1; }
fi
echo "Following mainnet — the explorer opens at http://127.0.0.1:4481/ once it verifies. This clone is a mirror, never the writer."
exec node scripts/follow/kray-follow.mjs --from https://www.kray.network --dir ./follower-main --watch --serve 4481
