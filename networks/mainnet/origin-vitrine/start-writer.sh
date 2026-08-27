#!/usr/bin/env bash
# MAINNET writer. Ignition. Do not run until probe.sh is green.
set -euo pipefail
ROOT="${KRAY_VITRINE_ROOT:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
if [[ -z "$ROOT" && -f "$HERE/../hot/machine.env" ]]; then
  ROOT="$(grep -E '^KRAY_VITRINE_ROOT=' "$HERE/../hot/machine.env" | head -1 | cut -d= -f2-)"
fi
ROOT="${ROOT:-$HERE/..}"
if [[ ! -f "$ROOT/hot/ORIGIN-WRITER" ]]; then
  echo "refuse: touch $ROOT/hot/ORIGIN-WRITER after probe.sh is green"
  exit 1
fi
if [[ ! -f "$ROOT/hot/origin-local.env" && ! -f "$ROOT/hot/machine.env" ]]; then
  echo "refuse: copy machine.env.example to $ROOT/hot/machine.env and fill THIS bitcoin.conf"
  exit 1
fi
cd "$ROOT/code"
export KRAY_HOT="$ROOT/hot/node-hot.env"
export KRAY_LOCAL_OVERLAY="$ROOT/hot/origin-local.env"
export KRAY_MACHINE_OVERLAY="$ROOT/hot/machine.env"
export KRAY_DATA="$ROOT/state/data-main"
exec node --use-system-ca scripts/operator/start-mainnet-writer.mjs
