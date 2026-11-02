#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PATH="$HOME/.local/node/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
node scripts/telegram-control.mjs --seed
