#!/bin/bash
# e2e-test.sh - Offline/degraded E2E smoke for cass-memory CLI
set -euo pipefail

CM_BIN="./src/cm.ts"
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cm-e2e-XXXXXX")"
export HOME="$RUN_DIR/home"
mkdir -p "$HOME/.memory-system"

# Force degraded mode (no cass, no LLM)
export CASS_PATH="__missing__"
export LLM_DISABLED=1
export CASS_MEMORY_VERBOSE=1

log() { echo "[$(date -Iseconds)] $*"; }

cleanup() { rm -rf "$RUN_DIR"; }
trap cleanup EXIT

log "E2E run dir: $RUN_DIR"

run_step() {
  local name="$1"; shift
  log "--> $name: $*"
  "$@" >"$RUN_DIR/${name}.out" 2>"$RUN_DIR/${name}.err"
}

# 1) init
run_step init bun run "$CM_BIN" init
test -f "$HOME/.memory-system/config.json"

# 2) stats empty
run_step stats-empty bun run "$CM_BIN" stats --json
grep '"total": 0' "$RUN_DIR/stats-empty.out"

# 3) add + list rule
RULE_CONTENT="Always write atomically"
run_step playbook-add bun run "$CM_BIN" playbook add "$RULE_CONTENT" --category io --json
run_step playbook-list bun run "$CM_BIN" playbook list --json
BULLET_ID=$(bun -e 'const fs=require("fs");const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(Array.isArray(data)&&data[0]?.id||"");' "$RUN_DIR/playbook-list.out")
if [ -z "$BULLET_ID" ]; then
  echo "Failed to extract bullet id from playbook list"
  exit 1
fi

# 4) mark helpful
run_step mark-helpful bun run "$CM_BIN" mark "$BULLET_ID" --helpful --session "e2e-session" --json

# 5) context in no-cass mode should still return rules and no history
TASK="file operations and atomic writes"
run_step context bun run "$CM_BIN" context "$TASK" --json
grep "$RULE_CONTENT" "$RUN_DIR/context.out"
grep '"searchResults": \[\]' "$RUN_DIR/context.out"

# 6) stats should show total >=1
run_step stats-after bun run "$CM_BIN" stats --json
grep '"total": 1' "$RUN_DIR/stats-after.out"

# 7) doctor should run in degraded mode without cass/LLM
run_step doctor bun run "$CM_BIN" doctor --json

log "ALL E2E STEPS PASSED"
