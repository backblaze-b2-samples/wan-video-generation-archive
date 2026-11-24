"""HTTP surface: job queue, clip routes, archive route, explorer guard, user agent."""

import pytest

from app.service import container
from app.service import files as files_service
from tests.fakes import make_services


@pytest.fixture
def fake():
    services, s3, gen, clock = make_services()
    container.set_services(services)
    return services, s3, gen, clock


async def _generate(client, services, **body):
    resp = await client.post("/clips", json={"prompt": "fox", "resolution": "low", **body})
    assert resp.status_code == 202, resp.text
    services.jobs.wait_idle(timeout=30)
    job = (await client.get(f"/jobs/{resp.json()['job_id']}")).json()
    assert job["status"] == "succeeded", job
    return job


async def test_generate_job_runs_and_clip_is_listed(client, fake):
    services, _, _, _ = fake
    job = await _generate(client, services, num_inference_steps=20)
    assert job["step"] == job["total_steps"] == 20

    listing = (await client.get("/clips", params={"project": "demo"})).json()
    assert [c["clip_id"] for c in listing["items"]] == [job["clip_id"]]
    detail = await client.get(f"/projects/demo/clips/{job['clip_id']}")
    assert detail.json()["ai_label"] == "AI-generated"
    projects = (await client.get("/projects")).json()
    assert projects[0]["name"] == "demo" and projects[0]["recent_count"] == 1
    models = (await client.get("/models")).json()
    assert next(m for m in models if m["id"] == "wan2.2-ti2v-5b")["loaded"] is True


async def test_bad_requests(client, fake):
    assert (await client.post("/clips", json={"prompt": "x", "num_frames": 50})).status_code == 422
    assert (await client.post("/clips", json={"prompt": "x", "project": "Bad"})).status_code == 422
    resp = await client.post("/clips", json={"prompt": "x", "model_id": "ltx-video"})
    assert resp.status_code == 400
    assert (await client.get("/projects/demo/clips/nope")).status_code == 404
    assert (await client.get("/jobs/missing")).status_code == 404


async def test_failed_job_reports_error(client):
    from tests.fakes import FakeGenerator

    services, s3, _, _ = make_services(generator=FakeGenerator(fail=True))
    container.set_services(services)
    resp = await client.post("/clips", json={"prompt": "x"})
    services.jobs.wait_idle(timeout=30)
    job = (await client.get(f"/jobs/{resp.json()['job_id']}")).json()
    assert job["status"] == "failed" and "out of memory" in job["error"]
    assert s3.objects == {}


async def test_archive_share_regenerate_delete_routes(client, fake):
    services, _, _, clock = fake
    job = await _generate(client, services)
    clip_id = job["clip_id"]
    clock.advance(days=31)

    dry = await client.post("/projects/demo/archive", json={"dry_run": True})
    assert [m["clip_id"] for m in dry.json()["moved"]] == [clip_id]
    aged = await client.post("/projects/demo/archive", json={"older_than_days": 30})
    assert aged.status_code == 200 and aged.json()["dry_run"] is False

    share = await client.post(f"/projects/demo/clips/{clip_id}/share", json={})
    assert share.json()["tier"] == "archive" and "/video/archive/" in share.json()["url"]

    regen = await client.post(f"/projects/demo/clips/{clip_id}/regenerate")
    assert regen.status_code == 202
    services.jobs.wait_idle(timeout=30)
    new_id = (await client.get(f"/jobs/{regen.json()['job_id']}")).json()["clip_id"]
    new = (await client.get(f"/projects/demo/clips/{new_id}")).json()
    assert new["regenerated_from"] == clip_id and new["tier"] == "recent"

    deleted = await client.delete(f"/projects/demo/clips/{clip_id}")
    assert deleted.status_code == 200 and len(deleted.json()["deleted_keys"]) == 2


async def test_archive_unknown_project_404(client, fake):
    assert (await client.post("/projects/ghost/archive", json={})).status_code == 404


@pytest.mark.parametrize(
    "key",
    ["video/recent/demo/2026-01-01/x.mp4", "video/archive/demo/2026-01/x.json",
     "video/manifests/demo.jsonl"],
)
async def test_explorer_refuses_to_delete_managed_keys(client, monkeypatch, key):
    deleted: list[str] = []
    monkeypatch.setattr(files_service, "delete_file", deleted.append)
    for resp in (
        await client.delete(f"/files/{key}"),
        await client.delete("/files-by-key", params={"key": key}),
    ):
        assert resp.status_code == 409
        assert "Library" in resp.json()["detail"]
    assert deleted == []


def test_s3_client_user_agent_and_endpoint(monkeypatch):
    from app.config import settings
    from app.repo import b2_client

    monkeypatch.setattr(settings, "b2_region", "eu-central-003")
    b2_client.get_s3_client.cache_clear()
    client = b2_client.get_s3_client()
    assert client.meta.config.user_agent_extra == "b2ai-wan-video-generation-archive"
    assert client.meta.endpoint_url == "https://s3.eu-central-003.backblazeb2.com"
