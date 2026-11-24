"""Live self-test: the real Wan model and a real B2 bucket, in one pass.

Run on the GPU host (TI2V-5B) or locally with WAN_MODEL=wan2.1-t2v-1.3b:

    RUN_LIVE_B2_TESTS=1 pnpm test:live:gpu

Uses a unique project `selftest-<run id>` at the self-test preset (low, 17
frames, 20 steps) and deletes only that project's keys and manifest at the end.
"""

import hashlib
import os
import urllib.request
import uuid
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from dotenv import load_dotenv

# Same configuration source as main.py, loaded before app.config reads it.
load_dotenv(Path(__file__).resolve().parents[3] / ".env")

from app.config import layout, settings  # noqa: E402
from app.config.models import SELF_TEST_PRESET, get_model  # noqa: E402
from app.repo.b2_client import get_s3_client  # noqa: E402
from app.repo.video_encode import read_container_tags_from_bytes  # noqa: E402
from app.repo.wan_pipeline import WanGenerator  # noqa: E402
from app.service.container import build_services  # noqa: E402
from app.types import GenerateClipRequest, ShareRequest  # noqa: E402

pytestmark = [pytest.mark.live, pytest.mark.gpu]

REQUIRED_ENV = (
    "B2_APPLICATION_KEY_ID",
    "B2_APPLICATION_KEY",
    "B2_BUCKET_NAME",
    "B2_REGION",
)


@pytest.fixture(scope="module")
def live() -> Iterator[tuple]:
    if os.environ.get("RUN_LIVE_B2_TESTS") != "1":
        pytest.skip("set RUN_LIVE_B2_TESTS=1 to allow real B2 requests and a real model run")
    missing = [name for name in REQUIRED_ENV if not os.environ.get(name)]
    if missing:
        pytest.skip(f"missing {missing}")

    get_s3_client.cache_clear()
    client = get_s3_client()
    services = build_services(
        client,
        settings.b2_bucket_name,
        WanGenerator(settings.wan_device, settings.wan_cpu_offload),
    )
    project = f"selftest-{uuid.uuid4().hex[:10]}"
    yield services, client, settings, project

    store = services.clips.store
    for prefix in (
        f"{layout.RECENT_PREFIX}{project}/",
        f"{layout.ARCHIVE_PREFIX}{project}/",
    ):
        for obj in store.list(prefix):
            store.delete(obj.key)
    store.delete(layout.manifest_key(project))


def _generate(services, project, model_id, prompt, seed):
    req = GenerateClipRequest(
        project=project,
        prompt=prompt,
        seed=seed,
        model_id=model_id,
        resolution=SELF_TEST_PRESET["resolution"],
        num_frames=SELF_TEST_PRESET["num_frames"],
        num_inference_steps=SELF_TEST_PRESET["num_inference_steps"],
    )
    return services.clips.run(services.clips.prepare_generate(req), lambda s, t: None)


def _assert_labelled_and_intact(services, record):
    head = services.clips.store.head(record.output_key)
    assert head is not None, record.output_key
    assert head.metadata.get("ai-generated") == "true"
    assert head.metadata.get("sha256") == record.sha256

    link = services.share.share(record.project, record.clip_id, ShareRequest().expires_in_seconds)
    with urllib.request.urlopen(link.url, timeout=60) as resp:
        assert resp.status == 200
        assert resp.headers.get("Content-Type") == "video/mp4"
        body = resp.read()
    assert hashlib.sha256(body).hexdigest() == record.sha256

    tags = read_container_tags_from_bytes(body)
    assert tags.get("ai_generated") == "true"
    assert tags.get("ai_label") == "AI-generated"
    assert record.ai_generated is True and record.ai_label == "AI-generated"


def test_generate_age_share_regenerate(live):
    services, client, settings, project = live
    model_id = settings.wan_model
    assert get_model(model_id) is not None, f"WAN_MODEL={model_id} is not in the registry"
    now = services.clips.clock()

    # 1. Clip A ages past the threshold and moves to the archive tier.
    a = _generate(services, project, model_id, "A red fox trotting through fresh snow", 11)
    result = services.archive.age(
        project, as_of=now + timedelta(days=settings.archive_after_days + 1)
    )
    assert [m.clip_id for m in result.moved] == [a.clip_id]
    a = services.clips.get(project, a.clip_id)
    month = a.created_at.strftime("%Y-%m")
    assert a.tier == "archive"
    assert a.output_key.startswith(f"{layout.ARCHIVE_PREFIX}{project}/{month}/")
    assert services.clips.store.head(layout.recent_keys(project, a.clip_id, a.created_at)[0]) is None

    # 2. Clip B is young and stays recent.
    b = _generate(services, project, model_id, "Ocean waves rolling onto a beach", 22)
    assert services.archive.age(project, as_of=services.clips.clock()).moved == []
    assert services.clips.get(project, b.clip_id).tier == "recent"

    # 3 + 4. Share links play, checksums match, labels are present everywhere.
    for record in (a, services.clips.get(project, b.clip_id)):
        _assert_labelled_and_intact(services, record)

    # 5. Regenerate A from its manifest entry.
    again = services.clips.run(
        services.clips.prepare_regenerate(project, a.clip_id), lambda s, t: None
    )
    assert again.regenerated_from == a.clip_id
    for field in ("prompt", "seed", "model", "model_revision", "width", "height",
                  "num_frames", "num_inference_steps", "guidance_scale"):
        assert getattr(again, field) == getattr(a, field), field

    # 6. B2 standards on the live client.
    assert client.meta.config.user_agent_extra == "b2ai-wan-video-generation-archive"
    assert client.meta.endpoint_url == f"https://s3.{settings.b2_region}.backblazeb2.com"
