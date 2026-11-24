"""Age job: cutoff boundaries, month bucketing, dry run, copy-verify-delete order."""

from datetime import UTC, datetime, timedelta

import pytest

from app.types import GenerateClipRequest
from tests.fakes import make_services


def _at(services, clock, when: datetime, project="demo"):
    clock.now = when
    req = GenerateClipRequest(prompt="clip", project=project, seed=1)
    return services.clips.run(services.clips.prepare_generate(req), lambda s, t: None)


def test_clip_exactly_at_cutoff_moves_one_second_younger_stays():
    services, s3, _, clock = make_services()
    old = _at(services, clock, datetime(2026, 1, 31, 10, 0, 0, tzinfo=UTC))
    young = _at(services, clock, datetime(2026, 1, 31, 10, 0, 1, tzinfo=UTC))
    as_of = datetime(2026, 3, 2, 10, 0, 0, tzinfo=UTC)  # exactly 30 days after `old`

    result = services.archive.age("demo", older_than_days=30, as_of=as_of)

    assert [m.clip_id for m in result.moved] == [old.clip_id]
    assert result.kept_count == 1
    assert result.cutoff == as_of - timedelta(days=30)
    moved = services.clips.get("demo", old.clip_id)
    assert moved.tier == "archive"
    assert moved.output_key == f"video/archive/demo/2026-01/{old.clip_id}.mp4"
    assert moved.settings_key.endswith(f"2026-01/{old.clip_id}.json")
    assert old.output_key not in s3.objects and old.settings_key not in s3.objects
    assert s3.objects[moved.output_key].metadata["ai-generated"] == "true"
    assert services.clips.get("demo", young.clip_id).tier == "recent"


def test_month_bucket_comes_from_created_at_not_move_date():
    services, _, _, clock = make_services()
    clip = _at(services, clock, datetime(2025, 12, 31, 23, 0, tzinfo=UTC))
    services.archive.age("demo", 1, as_of=datetime(2026, 2, 1, tzinfo=UTC))
    assert "/2025-12/" in services.clips.get("demo", clip.clip_id).output_key


def test_dry_run_reports_without_moving():
    services, s3, _, clock = make_services()
    clip = _at(services, clock, datetime(2026, 1, 1, tzinfo=UTC))
    before = dict(s3.objects)
    result = services.archive.age("demo", as_of=datetime(2026, 6, 1, tzinfo=UTC), dry_run=True)
    assert [m.clip_id for m in result.moved] == [clip.clip_id]
    assert result.dry_run is True
    assert s3.objects.keys() == before.keys()


def test_default_days_and_clock():
    services, _, _, clock = make_services()
    _at(services, clock, clock.now)
    clock.advance(days=29)
    assert services.archive.age("demo").moved == []
    clock.advance(days=1)
    assert len(services.archive.age("demo").moved) == 1


def test_archived_clips_are_not_moved_twice():
    services, s3, _, clock = make_services()
    _at(services, clock, datetime(2026, 1, 1, tzinfo=UTC))
    as_of = datetime(2026, 6, 1, tzinfo=UTC)
    services.archive.age("demo", as_of=as_of)
    copies = len(s3.copies)
    assert services.archive.age("demo", as_of=as_of).moved == []
    assert len(s3.copies) == copies


def test_failed_verification_keeps_recent_copy_and_manifest():
    services, s3, _, clock = make_services()
    clip = _at(services, clock, datetime(2026, 1, 1, tzinfo=UTC))
    real_copy = s3.copy

    def corrupt_copy(**kw):
        real_copy(**kw)
        s3.objects[kw["Key"]].metadata["sha256"] = "0" * 64

    s3.copy = corrupt_copy
    with pytest.raises(RuntimeError, match="verification"):
        services.archive.age("demo", as_of=datetime(2026, 6, 1, tzinfo=UTC))
    assert clip.output_key in s3.objects
    assert services.clips.get("demo", clip.clip_id).tier == "recent"


def test_copy_uses_metadata_directive_copy():
    services, s3, _, clock = make_services()
    _at(services, clock, datetime(2026, 1, 1, tzinfo=UTC))
    services.archive.age("demo", as_of=datetime(2026, 6, 1, tzinfo=UTC))
    assert all(c["extra"] == {"MetadataDirective": "COPY"} for c in s3.copies)
