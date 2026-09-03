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
SHAPES='100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}|[0-9a-z-]+\.ts\.net|\b10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b|\b192\.168\.[0-9]{1,3}\.|C:\\\\Users\\\\[A-Za-z]|/Users/[a-z0-9_-]+/|/home/[a-z0-9_-]+/|[a-z0-9]+-umbrel\b|mac-mini-[a-z0-9]+|[a-z0-9._%+-]+@(gmail|hotmail|outlook|yahoo|icloud|proton)\.[a-z]+|KRAY_CONSOLIDATION_SECRET=[0-9a-f]{64}|KRAY_VAULT_GUARDIAN_SECRETS?=[0-9a-f]{64}|KRAY_(POT|GUARDIAN)_SIGNER_TOKEN=[A-Za-z0-9+/]{16,}|KRAY_BTC_RPC_PASS=[A-Za-z0-9+/]{8,}|BEGIN (OPENSSH |RSA )?PRIVATE KEY'

# tracked files only — working-tree secrets that are gitignored must stay ignored.
# Placeholder doc paths (/Users/you, /home/user, <user>) are allowed.
# Proof fixtures used to be excluded — that hid /Users/… paths in fold artifacts.
# Tests may still use RFC1918 / CGNAT as hostile examples.
LEAK="$(git grep -nI -E "$SHAPES" \
  -- ':!apps/kray-core/src/test/*' ':!*.test.ts' ':!*.test.mjs' ':!scripts/oss-guard.sh' \
  | grep -vE '/Users/you/|/home/you/|/home/user/|/Users/<|/home/<' || true)"

# A public-door file must never point at the operator house. The house itself
# is gitignored; a leftover `import './operator/…'` is a map of the private tree.
OP_IMPORT="$(git grep -nI -E "import ['\"](\\.\\./)*operator/" -- ':!scripts/oss-guard.sh' || true)"
if [[ -n "$OP_IMPORT" ]]; then
  LEAK="${LEAK}"$'\n'"${OP_IMPORT}"
fi

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

# House folders a stranger clone must never carry
HOUSE="$(git ls-files 'scripts/exam/' 'scripts/lab/' 'scripts/operator/' 'ops/' \
  'apps/kray-net/later/desk/' 'docs/OPERATOR-SHIP.md' 'docs/KRAYOS-MIND.md' \
  'docs/HANDOFF-*.md' 'docs/POT-CUSTODY-OPS.md' 'scripts/pot-signer.mjs' \
  'networks/mainnet/origin-vitrine/' 'networks/mainnet/origin-local.env.example' \
  || true)"
if [[ -n "$HOUSE" ]]; then
  echo "✗ oss-guard: tracked private-house path:"
  echo "$HOUSE"
  exit 1
fi

# Public door (kray-node) must never carry the Creator's product mouths.
# Private backup may keep them on disk / in its own history — this check
# fires only when origin is the stranger clone.
REMOTE="$(git remote get-url origin 2>/dev/null || true)"
if [[ "$REMOTE" == *kray-node* ]]; then
  VIT="$(git ls-files 'apps/kray-net/defi.html' 'apps/kray-net/market.html' \
    'apps/kray-net/markets.html' 'apps/kray-net/pool.html' || true)"
  if [[ -n "$VIT" ]]; then
    echo "✗ oss-guard: tracked creator-vitrine path on the public door:"
    echo "$VIT"
    exit 1
  fi
fi

echo "  oss-guard: clean"
