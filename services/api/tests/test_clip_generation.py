"""Generation through the service layer with a fake generator and in-memory bucket."""

import hashlib
import json

import pytest

from app.config.models import MODELS
from app.repo.manifest_store import decode_lines
from app.repo.video_encode import read_container_tags_from_bytes
from app.service.errors import InvalidClipRequestError, RegistryMismatchError
from app.types import GenerateClipRequest
from tests.fakes import FakeGenerator, make_services


def _generate(services, **kw):
    req = GenerateClipRequest(prompt=kw.pop("prompt", "a red fox"), **kw)
    return services.clips.run(services.clips.prepare_generate(req), lambda s, t: None)


def test_generate_writes_clip_sidecar_and_manifest_line():
    services, s3, gen, _ = make_services()
    record = _generate(services, seed=7, num_inference_steps=20, resolution="low")

    assert record.output_key.startswith("video/recent/demo/2026-03-15/")
    clip = s3.objects[record.output_key]
    assert clip.content_type == "video/mp4"
    assert hashlib.sha256(clip.body).hexdigest() == record.sha256 == clip.metadata["sha256"]
    assert clip.metadata["ai-generated"] == "true"
    assert clip.metadata["model-revision"] == MODELS["wan2.2-ti2v-5b"].revision
    assert clip.metadata["seed"] == "7"

    sidecar = json.loads(s3.objects[record.settings_key].body)
    assert sidecar["prompt"] == "a red fox" and sidecar["seed"] == 7
    assert "output_key" not in sidecar

    lines = decode_lines(s3.objects["video/manifests/demo.jsonl"].body)
    assert [r.clip_id for r in lines] == [record.clip_id]
    assert lines[0].ai_generated is True and lines[0].ai_label == "AI-generated"
    assert gen.calls[0].width == 672 and gen.calls[0].height == 384


def test_mp4_carries_ai_generated_container_tags():
    services, s3, _, _ = make_services()
    record = _generate(services, seed=99)
    tags = read_container_tags_from_bytes(s3.objects[record.output_key].body)
    assert tags["ai_generated"] == "true"
    assert tags["ai_label"] == "AI-generated"
    assert tags["model"] == "wan2.2-ti2v-5b"
    assert tags["model_revision"] == MODELS["wan2.2-ti2v-5b"].revision
    assert tags["seed"] == "99"
    assert "AI-generated" in tags["comment"]


def test_omitted_seed_is_random_but_recorded():
    services, _, gen, _ = make_services()
    record = _generate(services)
    assert record.seed == 1234 == gen.calls[0].seed


def test_generation_failure_leaves_no_object_and_no_line():
    services, s3, _, _ = make_services(generator=FakeGenerator(fail=True))
    with pytest.raises(RuntimeError):
        _generate(services)
    assert s3.objects == {}


def test_manifest_write_failure_removes_written_objects():
    services, s3, _, _ = make_services()
    s3.fail_put_for = {".jsonl"}
    with pytest.raises(RuntimeError):
        _generate(services)
    assert s3.objects == {}


def test_unknown_model_or_resolution_is_rejected():
    services, _, _, _ = make_services()
    with pytest.raises(InvalidClipRequestError):
        services.clips.prepare_generate(GenerateClipRequest(prompt="x", model_id="ltx-video"))
    with pytest.raises(InvalidClipRequestError):
        services.clips.prepare_generate(
            GenerateClipRequest(prompt="x", model_id="wan2.1-t2v-1.3b", resolution="720p")
        )


def test_regenerate_copies_settings_and_links_source():
    services, _, gen, clock = make_services()
    source = _generate(
        services, prompt="fox", negative_prompt="blurry", seed=5, guidance_scale=6.5
    )
    clock.advance(minutes=5)
    prepared = services.clips.prepare_regenerate("demo", source.clip_id)
    again = services.clips.run(prepared, lambda s, t: None)

    assert again.clip_id != source.clip_id
    assert again.regenerated_from == source.clip_id
    for field in ("prompt", "negative_prompt", "seed", "model", "model_revision",
                  "width", "height", "num_frames", "num_inference_steps", "guidance_scale"):
        assert getattr(again, field) == getattr(source, field), field
    assert gen.calls[0] == gen.calls[1]


def test_regenerate_refuses_unpinned_revision():
    services, _, _, _ = make_services()
    source = _generate(services)
    services.clips.manifests.replace(source.model_copy(update={"model_revision": "f" * 40}))
    with pytest.raises(RegistryMismatchError):
        services.clips.prepare_regenerate("demo", source.clip_id)


def test_delete_removes_objects_and_line():
    services, s3, _, _ = make_services()
    a = _generate(services)
    b = _generate(services)
    result = services.clips.delete("demo", a.clip_id)
    assert set(result.deleted_keys) == {a.output_key, a.settings_key}
    assert a.output_key not in s3.objects
    assert [r.clip_id for r in services.clips.manifests.read("demo")] == [b.clip_id]
    services.clips.delete("demo", b.clip_id)
    assert "video/manifests/demo.jsonl" not in s3.objects


def test_list_and_projects_summaries():
    services, _, _, _ = make_services()
    _generate(services, project="alpha", prompt="snowy fox")
    _generate(services, project="beta", prompt="ocean waves")
    assert [r.prompt for r in services.clips.list_clips(q="fox")] == ["snowy fox"]
    assert [p.name for p in services.clips.projects()] == ["alpha", "beta"]
    assert services.clips.projects()[0].recent_count == 1
