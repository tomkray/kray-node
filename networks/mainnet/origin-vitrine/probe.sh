#!/usr/bin/env bash
# Prove THIS disk. Does not ignite the writer. Unix twin of probe.cmd.
set -euo pipefail
ROOT="${KRAY_VITRINE_ROOT:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
if [[ -z "$ROOT" && -f "$HERE/../hot/machine.env" ]]; then
  ROOT="$(grep -E '^KRAY_VITRINE_ROOT=' "$HERE/../hot/machine.env" | head -1 | cut -d= -f2-)"
fi
ROOT="${ROOT:-$HERE/..}"
if [[ ! -f "$ROOT/code/apps/kray-net/server.mjs" ]]; then
  echo "missing $ROOT/code — run pack-writer-vitrine.sh first"
  exit 1
fi
mkdir -p "$ROOT/hot"
[[ -f "$ROOT/hot/ORIGIN-WRITER" ]] || : > "$ROOT/hot/ORIGIN-WRITER"
cd "$ROOT/code"
export KRAY_HOT="$ROOT/hot/node-hot.env"
export KRAY_LOCAL_OVERLAY="$ROOT/hot/origin-local.env"
export KRAY_MACHINE_OVERLAY="$ROOT/hot/machine.env"
export KRAY_DATA="$ROOT/state/data-main"
exec node --use-system-ca scripts/operator/start-mainnet-writer.mjs --probe-only
