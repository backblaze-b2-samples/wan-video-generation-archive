"""The wan_archive CLI drives the same services (fake bucket, fake generator)."""

import json
import sys
from pathlib import Path

from tests.fakes import make_services

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import wan_archive


def _run(capsys, services, *argv):
    args = wan_archive.build_parser().parse_args(list(argv))
    code = wan_archive.run(args, services)
    return code, capsys.readouterr().out


def test_generate_age_lookup_share(capsys):
    services, _, _, _ = make_services()
    code, out = _run(capsys, services, "generate", "--prompt", "fox", "--seed", "3",
                     "--resolution", "low", "--frames", "17", "--steps", "20")
    assert code == 0
    clip = json.loads(out)
    assert clip["seed"] == 3 and clip["tier"] == "recent"

    code, out = _run(capsys, services, "age", "--project", "demo", "--as-of", "2027-01-01",
                     "--dry-run")
    assert json.loads(out)["dry_run"] is True and len(json.loads(out)["moved"]) == 1

    services.share.share("demo", clip["clip_id"], 900)
    code, out = _run(capsys, services, "age", "--project", "demo", "--older-than-days", "0",
                     "--dry-run")
    assert json.loads(out)["moved"] == [] and len(json.loads(out)["held"]) == 1
    code, out = _run(capsys, services, "age", "--project", "demo", "--older-than-days", "0",
                     "--dry-run", "--include-held")
    assert len(json.loads(out)["moved"]) == 1 and len(json.loads(out)["released"]) == 1

    code, out = _run(capsys, services, "lookup", "--project", "demo", "--clip-id",
                     clip["clip_id"])
    assert json.loads(out)["clip_id"] == clip["clip_id"]

    code, out = _run(capsys, services, "share", "--project", "demo", "--clip-id",
                     clip["clip_id"], "--ttl", "5")
    assert json.loads(out)["key"] == clip["output_key"]


def test_unknown_clip_returns_error_code(capsys):
    services, _, _, _ = make_services()
    code, out = _run(capsys, services, "lookup", "--project", "demo", "--clip-id", "nope")
    assert code == 2 and "not found" in json.loads(out)["error"]
