#!/bin/sh
# Door 2 — FULL NODE of Signet KRAY. Never a second writer. Never the pot key.
# Assistants: docs/RUN-NODE.md first (quiz + node scripts/follow/preflight.mjs).
cd "$(dirname "$0")/../.." || exit 1
# Libraries, once — so "download and run this" just works, with no separate npm step to remember.
if [ ! -d apps/kray-core/node_modules ]; then
  echo "Installing libraries once (apps/kray-core) — this happens only the first time…"
  ( cd apps/kray-core && npm ci ) || { echo "  npm ci failed. Install Node.js 24+, then run: cd apps/kray-core && npm ci"; exit 1; }
fi
echo "Following Signet — the explorer opens at http://127.0.0.1:4480/ once it verifies. Leave this running."
exec node scripts/follow/kray-follow.mjs --from https://signet.kray.network --dir ./follower --watch --serve 4480
