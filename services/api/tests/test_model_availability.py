"""Per-device model availability, the server-side refusal, and job stages."""

import pytest

from app.config.models import DEMO_PRESET, MODELS, SELF_TEST_PRESET
from app.repo.wan_pipeline import format_bytes
from app.service import container
from app.service.availability import unavailable_reason
from app.service.errors import InvalidClipRequestError
from app.types import GenerateClipRequest
from app.types.generation import DeviceProbe
from tests.fakes import FakeGenerator, make_services

FIVE_B = MODELS["wan2.2-ti2v-5b"]
ONE_B = MODELS["wan2.1-t2v-1.3b"]
MAC = DeviceProbe("mps")


def test_5b_needs_cuda_and_24_gb():
    assert "CUDA" in unavailable_reason(FIVE_B, MAC)
    assert "CUDA" in unavailable_reason(FIVE_B, DeviceProbe("cpu"))
    assert "16.0 GB" in unavailable_reason(FIVE_B, DeviceProbe("cuda", 16.0))
    # A nominal 24 GB card (L4, A10G) reports about 22.5 GiB to torch.
    assert unavailable_reason(FIVE_B, DeviceProbe("cuda", 22.5)) is None
    assert unavailable_reason(FIVE_B, DeviceProbe("cuda", 80.0)) is None


def test_1_3b_runs_on_any_detected_device():
    for probe in (MAC, DeviceProbe("cpu"), DeviceProbe("cuda", 8.0)):
        assert unavailable_reason(ONE_B, probe) is None


def test_no_device_makes_every_model_unavailable_with_the_probe_error():
    probe = DeviceProbe(None, error="torch missing")
    assert unavailable_reason(ONE_B, probe) == "torch missing"
    assert unavailable_reason(FIVE_B, probe) == "torch missing"


def test_models_on_a_mac_default_to_the_runnable_model():
    services, *_ = make_services(generator=FakeGenerator(device_probe=MAC))
    models = {m.id: m for m in services.clips.models()}
    assert models[FIVE_B.id].available is False
    assert "CUDA" in models[FIVE_B.id].unavailable_reason
    assert models[FIVE_B.id].default is False
    assert models[ONE_B.id].available is True and models[ONE_B.id].default is True


def test_models_on_a_gpu_host_default_to_wan_model():
    services, *_ = make_services()
    models = {m.id: m for m in services.clips.models()}
    assert all(m.available for m in models.values())
    assert models[FIVE_B.id].default is True


def test_recommended_preset_is_light_off_cuda_and_demo_on_cuda():
    mac, *_ = make_services(generator=FakeGenerator(device_probe=MAC))
    for m in mac.clips.models():
        assert m.run_device == "mps"
        assert m.recommended.model_dump() == SELF_TEST_PRESET
        assert any(r.name == m.recommended.resolution for r in m.resolutions)
    gpu, *_ = make_services()
    for m in gpu.clips.models():
        assert m.run_device == "cuda"
        assert m.recommended.resolution == DEMO_PRESET["resolution"]
        assert m.recommended.num_frames == DEMO_PRESET["num_frames"]
        assert m.recommended.num_inference_steps == DEMO_PRESET["num_inference_steps"]


def test_unrunnable_model_is_refused_before_any_generation():
    services, s3, gen, _ = make_services(generator=FakeGenerator(device_probe=MAC))
    with pytest.raises(InvalidClipRequestError, match="CUDA"):
        services.clips.prepare_generate(GenerateClipRequest(prompt="fox"))
    assert gen.calls == [] and s3.objects == {}


def test_regenerate_of_an_unrunnable_model_is_refused():
    services, _, gen, _ = make_services()
    req = GenerateClipRequest(prompt="fox", resolution="low")
    record = services.clips.run(services.clips.prepare_generate(req), lambda s, t: None)
    gen.device_probe = MAC
    with pytest.raises(InvalidClipRequestError, match="CUDA"):
        services.clips.prepare_regenerate("demo", record.clip_id)


async def test_post_clips_refuses_5b_on_a_mac_with_400(client):
    services, *_ = make_services(generator=FakeGenerator(device_probe=MAC))
    container.set_services(services)
    resp = await client.post("/clips", json={"prompt": "fox"})
    assert resp.status_code == 400 and "CUDA" in resp.json()["detail"]
    assert (await client.get("/jobs")).json() == []
    ok = await client.post(
        "/clips", json={"prompt": "fox", "model_id": ONE_B.id, "resolution": "low"}
    )
    assert ok.status_code == 202
    services.jobs.wait_idle(timeout=30)
    models = (await client.get("/models")).json()
    assert {m["id"]: m["available"] for m in models} == {FIVE_B.id: False, ONE_B.id: True}


async def test_job_records_prompt_and_reports_stages(client):
    services, *_ = make_services()
    container.set_services(services)
    seen: list[str | None] = []
    original = services.jobs._update

    def spy(job_id, **changes):
        original(job_id, **changes)
        if "stage" in changes:
            seen.append(changes["stage"])

    services.jobs._update = spy
    resp = await client.post("/clips", json={"prompt": "a red fox", "resolution": "low"})
    assert resp.json()["prompt"] == "a red fox" and resp.json()["stage"] is None
    services.jobs.wait_idle(timeout=30)
    job = (await client.get(f"/jobs/{resp.json()['job_id']}")).json()
    assert job["status"] == "succeeded" and job["stage"] is None
    assert seen[0] == "loading" and "generating" in seen
    assert seen[-2:] == ["saving", None]
    assert job["stage_started_at"] is None


def test_stage_started_at_resets_only_when_the_stage_changes():
    """The Generate card counts seconds in the current stage, e.g. a long model load."""
    services, _, _, clock = make_services()
    jobs = services.jobs
    prepared = services.clips.prepare_generate(GenerateClipRequest(prompt="x", resolution="low"))
    job_id = jobs.submit("generate", prepared).job_id
    jobs.wait_idle(timeout=30)
    jobs._update(job_id, stage="loading", stage_detail="part 1 of 3")
    started = jobs.get(job_id).stage_started_at
    assert started is not None
    clock.advance(seconds=5)
    jobs._update(job_id, stage="loading", stage_detail="part 2 of 3")
    assert jobs.get(job_id).stage_started_at == started
    jobs._update(job_id, stage="generating")
    assert jobs.get(job_id).stage_started_at > started
    jobs._update(job_id, stage=None)
    assert jobs.get(job_id).stage_started_at is None


def test_format_bytes():
    assert format_bytes(512) == "512 B"
    assert format_bytes(1536) == "1.5 KB"
    assert format_bytes(5 * 1024**3) == "5.0 GB"
