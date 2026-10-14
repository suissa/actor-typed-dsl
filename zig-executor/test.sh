#!/usr/bin/env sh
set -eu

BIN="${1:-./zig-out/bin/maty-exec}"
GOOD="examples/ping-pong.json"
RECURSIVE="examples/recursive-ping.json"
BAD="examples/invalid-direction.json"

output="$("$BIN" "$GOOD")"
printf '%s\n' "$output" | grep -F '"ok":true'
printf '%s\n' "$output" | grep -F '"events_executed":2'
printf '%s\n' "$output" | grep -F '"state":"end"'

recursive_output="$("$BIN" "$RECURSIVE")"
printf '%s\n' "$recursive_output" | grep -F '"events_executed":3'
printf '%s\n' "$recursive_output" | grep -F '"state":"end"'

if "$BIN" "$BAD" >/dev/null 2>&1; then
  echo "expected invalid direction fixture to fail" >&2
  exit 1
fi

echo "Zig executor integration tests passed."
