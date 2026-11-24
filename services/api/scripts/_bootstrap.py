"""Shared start-up for the CLI scripts: repo-root env file, then the app package.

Mirrors main.py: the repo-root `.env` is the single source of configuration,
loaded before `app.config.settings` reads the environment.
"""

import sys
from pathlib import Path

from dotenv import load_dotenv

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]
load_dotenv(REPO_ROOT / ".env")
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))


def out(message: str) -> None:
    sys.stdout.write(f"{message}\n")
    sys.stdout.flush()
