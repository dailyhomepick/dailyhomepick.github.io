#!/usr/bin/env bash
# Produce Threads/traffic outreach drafts with a chosen tone.
#
#   scripts/outreach.sh --count=5 --mode=threads
#
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/outreach.mjs "$@"
