#!/usr/bin/env bash
# Pre-compaction hook: generate session note before context is compacted.
# Called by Claude Code's PreCompact hook. Receives JSON on stdin with:
#   { session_id, transcript_path, cwd, hook_event_name, trigger, ... }
#
# This is the safety net — if the agent already called cm_snapshot via MCP,
# the offset check makes this a no-op. If not, it uses the LLM (via API key)
# to summarize the transcript.
#
# Runs in the background so compaction isn't blocked.

export PATH="$HOME/.bun/bin:$PATH"

CM_PATH="$(dirname "$(dirname "$(realpath "$0")")")/src/cm.ts"

# Read hook input from stdin
INPUT="$(cat)"

# Extract session ID from the hook input JSON
SESSION_ID="$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)"

if [ -n "$SESSION_ID" ]; then
  bun run "$CM_PATH" snapshot --session "$SESSION_ID" &>/dev/null &
else
  bun run "$CM_PATH" snapshot --max-sessions 1 &>/dev/null &
fi
