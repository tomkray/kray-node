#!/usr/bin/env bash
# Fail if the public tree grew a leak: a live host, a private path, a personal
# identity, or a secret assignment. Run from the repo root before publishing.
#
# Every pattern is GENERIC by design — the guard hunts the SHAPE of a leak, never
# a specific name. A blocklist that spelled the actual host / user / email would
# itself BE the leak it guards against. Exact identifiers an operator wants banned
# locally go in a gitignored .oss-guard-local (one extended-regex per line, '#'
# comments allowed) — never committed here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Shape patterns — the whole Tailscale CGNAT range, any MagicDNS host, any private
# LAN IP, any personal /Users//home//C:\Users path, any '*-umbrel' / 'mac-mini-*'
# machine-name shape, any personal email by provider, and secret-shaped env
# assignments. None of these spell a real identity.
SHAPES='100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}|[0-9a-z-]+\.ts\.net|\b(nyon|vincione|aluzix)\b|\b10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b|\b192\.168\.[0-9]{1,3}\.|C:\\\\Users\\\\[A-Za-z]|/Users/[a-z0-9_-]+/|/home/[a-z0-9_-]+/|[a-z0-9]+-umbrel\b|mac-mini-[a-z0-9]+|[a-z0-9._%+-]+@(gmail|hotmail|outlook|yahoo|icloud|proton)\.[a-z]+|KRAY_CONSOLIDATION_SECRET=[0-9a-f]{64}|KRAY_VAULT_GUARDIAN_SECRETS?=[0-9a-f]{64}|KRAY_(POT|GUARDIAN)_SIGNER_TOKEN=[A-Za-z0-9+/]{16,}|KRAY_BTC_RPC_PASS=[A-Za-z0-9+/]{8,}|BEGIN (OPENSSH |RSA )?PRIVATE KEY'

# tracked files only — working-tree secrets that are gitignored must stay ignored.
# Placeholder doc paths (/Users/you, /home/user, <user>) are allowed.
LEAK="$(git grep -nI -E "$SHAPES" \
  -- ':!apps/kray-core/src/test/*' ':!*.test.ts' ':!*.test.mjs' ':!scripts/oss-guard.sh' \
  | grep -vE '/Users/you/|/home/you/|/home/user/|/Users/<|/home/<' || true)"

# optional LOCAL tripwires (gitignored) — exact strings/regexes the operator bans,
# kept off the public tree by design
if [[ -f .oss-guard-local ]]; then
  while IFS= read -r pat; do
    [[ -z "$pat" || "$pat" == \#* ]] && continue
    hit="$(git grep -nI -E "$pat" -- ':!scripts/oss-guard.sh' || true)"
    [[ -n "$hit" ]] && LEAK="${LEAK}"$'\n'"${hit}"
  done < .oss-guard-local
fi

# lines that DOCUMENT the TLS ban ("NEVER set …") are the guard's own spirit — allowed
TLS="$(git grep -nI 'NODE_TLS_REJECT_UNAUTHORIZED' -- ':!scripts/oss-guard.sh' | grep -viE 'KRAY_TLS_INSECURE|NEVER' || true)"
if [[ -n "$TLS" ]]; then
  LEAK="${LEAK}"$'\n'"${TLS}"
fi

if [[ -n "$LEAK" ]]; then
  echo "✗ oss-guard: leak-shaped content in tracked files:"
  echo "$LEAK"
  exit 1
fi

for f in \
  signet/vault-keys.env signet/node-hot.env signet/owner.box \
  mainnet/vault-keys.env mainnet/node-hot.env mainnet/owner.box \
  networks/signet/vault-keys.env networks/signet/node-hot.env networks/signet/owner.box \
  networks/mainnet/vault-keys.env networks/mainnet/node-hot.env networks/mainnet/owner.box \
  ops/ssh.pub
do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "✗ oss-guard: tracked operator/secret file: $f"
    exit 1
  fi
done

echo "  oss-guard: clean"
