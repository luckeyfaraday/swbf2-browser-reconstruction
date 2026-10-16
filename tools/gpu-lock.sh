#!/usr/bin/env bash
# Serializes GPU-heavy browser checks between concurrently working agents so
# their measurements do not distort each other. mkdir is atomic; a lock older
# than 30 minutes is treated as abandoned. Usage: tools/gpu-lock.sh <command...>
lock="$(cd "$(dirname "$0")/.." && pwd)/.local/gpu.lock"
mkdir -p "$(dirname "$lock")"
until mkdir "$lock" 2>/dev/null; do
  if [ -n "$(find "$lock" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rmdir "$lock" 2>/dev/null; fi
  sleep 5
done
trap 'rmdir "$lock" 2>/dev/null' EXIT
"$@"
