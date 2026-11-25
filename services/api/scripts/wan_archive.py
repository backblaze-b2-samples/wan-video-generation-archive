"""Command-line front end over the same service layer the API uses.

Lets the GPU host (and a cron age job) work without the web UI:

    python scripts/wan_archive.py generate --project demo --prompt "A red fox..." [--seed 42]
    python scripts/wan_archive.py age --project demo [--older-than-days 30] [--as-of 2026-12-31] [--dry-run] [--include-held]
    python scripts/wan_archive.py lookup --project demo [--clip-id ID] [--q fox] [--tier recent]
    python scripts/wan_archive.py share --project demo --clip-id ID [--ttl 3600]
    python scripts/wan_archive.py regenerate --project demo --clip-id ID

Every command prints JSON. Generation runs in this process (it loads the model
itself), so do not run `generate` against a project while the API is also
writing that project's manifest: the API process is meant to be the single
writer (docs/RELIABILITY.md).
"""

import argparse
import json
import logging
from datetime import UTC, datetime

from _bootstrap import out

from app.config import settings
from app.config.models import DEMO_PRESET
from app.repo.b2_client import get_s3_client
from app.repo.wan_pipeline import WanGenerator
from app.service.container import Services, build_services
from app.service.errors import ClipServiceError
from app.types import GenerateClipRequest

logger = logging.getLogger("wan_archive")


def _services() -> Services:
    return build_services(
        get_s3_client(),
        settings.b2_bucket_name,
        WanGenerator(settings.wan_device, settings.wan_cpu_offload),
    )


def _progress(step: int, total: int) -> None:
    logger.info("step %d/%d", step, total)


def _parse_as_of(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _dump(model) -> None:
    out(json.dumps(model.model_dump(mode="json"), indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Wan video generation archive CLI.")
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate", help="generate one clip (runs the model here)")
    gen.add_argument("--project", default="demo")
    gen.add_argument("--prompt", required=True)
    gen.add_argument("--negative-prompt")
    gen.add_argument("--seed", type=int)
    gen.add_argument("--model", default=settings.wan_model)
    gen.add_argument("--resolution", default=DEMO_PRESET["resolution"])
    gen.add_argument("--frames", type=int, default=DEMO_PRESET["num_frames"])
    gen.add_argument("--steps", type=int, default=DEMO_PRESET["num_inference_steps"])
    gen.add_argument("--guidance", type=float, default=DEMO_PRESET["guidance_scale"])

    age = sub.add_parser("age", help="move clips older than N days to the archive tier")
    age.add_argument("--project", required=True)
    age.add_argument("--older-than-days", type=int)
    age.add_argument("--as-of", help="ISO date/time used as 'now' (default: now)")
    age.add_argument("--dry-run", action="store_true")
    age.add_argument(
        "--include-held", action="store_true",
        help="also move clips held by a live share link (those links stop working)",
    )

    look = sub.add_parser("lookup", help="print manifest entries")
    look.add_argument("--project")
    look.add_argument("--clip-id")
    look.add_argument("--q")
    look.add_argument("--tier", choices=["recent", "archive", "all"], default="all")

    share = sub.add_parser("share", help="print an expiring presigned link")
    share.add_argument("--project", required=True)
    share.add_argument("--clip-id", required=True)
    share.add_argument("--ttl", type=int)

    regen = sub.add_parser("regenerate", help="re-run a clip from its manifest entry")
    regen.add_argument("--project", required=True)
    regen.add_argument("--clip-id", required=True)
    return parser


def run(args: argparse.Namespace, services: Services) -> int:
    try:
        if args.command == "generate":
            req = GenerateClipRequest(
                project=args.project,
                prompt=args.prompt,
                negative_prompt=args.negative_prompt,
                seed=args.seed,
                model_id=args.model,
                resolution=args.resolution,
                num_frames=args.frames,
                num_inference_steps=args.steps,
                guidance_scale=args.guidance,
            )
            _dump(services.clips.run(services.clips.prepare_generate(req), _progress))
        elif args.command == "age":
            result = services.archive.age(
                args.project, args.older_than_days, _parse_as_of(args.as_of), args.dry_run,
                args.include_held,
            )
            _dump(result)
        elif args.command == "lookup":
            if args.clip_id:
                _dump(services.clips.get(args.project or "", args.clip_id))
            else:
                items = services.clips.list_clips(args.project, args.tier, args.q)
                out(json.dumps([r.model_dump(mode="json") for r in items], indent=2))
        elif args.command == "share":
            _dump(services.share.share(args.project, args.clip_id, args.ttl))
        elif args.command == "regenerate":
            prepared = services.clips.prepare_regenerate(args.project, args.clip_id)
            _dump(services.clips.run(prepared, _progress))
    except ClipServiceError as e:
        out(json.dumps({"error": e.detail}))
        return 2
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    return run(args, _services())


if __name__ == "__main__":
    raise SystemExit(main())
