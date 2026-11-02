#!/usr/bin/env python3
"""Legacy wrapper for the canonical Threads commentary CLI.

The state is now stored outside the public repo by scripts/threads-commentary.mjs.
"""

from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
cmd = ['node', 'scripts/threads-commentary.mjs', *sys.argv[1:]]
raise SystemExit(subprocess.run(cmd, cwd=root).returncode)

