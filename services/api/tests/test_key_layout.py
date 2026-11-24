from datetime import UTC, datetime

from app.config import layout

CREATED = datetime(2026, 1, 31, 23, 59, 58, tzinfo=UTC)


def test_clip_id_shape():
    clip_id = layout.make_clip_id(CREATED, "deadbeef")
    assert clip_id == "20260131T235958Z-deadbeef"
    assert layout.is_valid_clip_id(clip_id)


def test_recent_and_archive_keys():
    clip_id = layout.make_clip_id(CREATED, "deadbeef")
    assert layout.recent_keys("demo", clip_id, CREATED) == (
        "video/recent/demo/2026-01-31/20260131T235958Z-deadbeef.mp4",
        "video/recent/demo/2026-01-31/20260131T235958Z-deadbeef.json",
    )
    assert layout.archive_keys("demo", clip_id, CREATED)[0] == (
        "video/archive/demo/2026-01/20260131T235958Z-deadbeef.mp4"
    )


def test_manifest_key_roundtrip():
    key = layout.manifest_key("fox-shots")
    assert key == "video/manifests/fox-shots.jsonl"
    assert layout.project_from_manifest_key(key) == "fox-shots"
    assert layout.project_from_manifest_key("video/manifests/Bad Name.jsonl") is None


def test_project_names():
    assert layout.is_valid_project("demo")
    assert layout.is_valid_project("selftest-20260101")
    for bad in ("", "-x", "Demo", "a/b", "a" * 64):
        assert not layout.is_valid_project(bad)


def test_managed_prefixes():
    assert layout.is_managed_key("video/recent/demo/x.mp4")
    assert layout.is_managed_key("video/manifests/demo.jsonl")
    assert not layout.is_managed_key("video/notes.txt")
    assert not layout.is_managed_key("other/video/recent/x")
