#!/usr/bin/env bash
# Thin wrapper — prefer: bun run dev:ai
set -euo pipefail
cd "$(dirname "$0")/.."
exec bun run dev:ai
