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


def test_kept_count_excludes_already_archived_clips():
    services, _, _, clock = make_services()
    _at(services, clock, datetime(2026, 1, 1, tzinfo=UTC))
    services.archive.age("demo", as_of=datetime(2026, 3, 1, tzinfo=UTC))
    _at(services, clock, datetime(2026, 4, 1, tzinfo=UTC))
    _at(services, clock, datetime(2026, 5, 25, tzinfo=UTC))

    result = services.archive.age("demo", older_than_days=30, as_of=datetime(2026, 6, 1, tzinfo=UTC))

    assert len(result.moved) == 1
    assert result.kept_count == 1


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


def test_live_share_link_holds_clip_in_recent_until_it_expires():
    """A presigned link is bound to one key: the move waits for the link to expire."""
    services, s3, _, clock = make_services()
    clip = _at(services, clock, datetime(2026, 1, 1, tzinfo=UTC))
    link = services.share.share("demo", clip.clip_id, 3600)
    assert services.clips.get("demo", clip.clip_id).share_expires_at == link.expires_at

    held = services.archive.age("demo", older_than_days=0)
    assert held.moved == [] and held.kept_count == 1
    assert [(h.clip_id, h.share_expires_at) for h in held.held] == [
        (clip.clip_id, link.expires_at)
    ]
    assert clip.output_key in s3.objects  # the link still resolves
    # A future as_of previews aging but cannot expire a real link early.
    future = services.archive.age("demo", 0, as_of=datetime(2027, 1, 1, tzinfo=UTC))
    assert future.moved == [] and len(future.held) == 1

    clock.advance(seconds=3601)
    moved = services.archive.age("demo", older_than_days=0)
    assert [m.clip_id for m in moved.moved] == [clip.clip_id] and moved.held == []
    assert services.clips.get("demo", clip.clip_id).tier == "archive"


def test_share_minted_during_the_copy_cancels_the_move():
    services, s3, _, clock = make_services()
    clip = _at(services, clock, datetime(2026, 1, 1, tzinfo=UTC))
    real_copy = s3.copy

    def copy_then_share(**kwargs):
        real_copy(**kwargs)
        if kwargs["Key"].endswith(".json"):
            services.share.share("demo", clip.clip_id, 900)

    s3.copy = copy_then_share
    result = services.archive.age("demo", older_than_days=0)
    assert result.moved == [] and [h.clip_id for h in result.held] == [clip.clip_id]
    record = services.clips.get("demo", clip.clip_id)
    assert record.tier == "recent" and record.output_key == clip.output_key
    assert clip.output_key in s3.objects
    assert not any(k.startswith("video/archive/") for k in s3.objects)


def test_share_of_an_archived_clip_sets_no_hold():
    services, _, _, clock = make_services()
    clip = _at(services, clock, datetime(2026, 1, 1, tzinfo=UTC))
    services.archive.age("demo", older_than_days=0)
    services.share.share("demo", clip.clip_id, 900)
    assert services.clips.get("demo", clip.clip_id).share_expires_at is None


def test_include_held_moves_a_held_clip_and_clears_its_hold():
    """The deliberate way through: the clip moves now and its live link stops working."""
    services, s3, _, clock = make_services()
    clip = _at(services, clock, datetime(2026, 1, 1, tzinfo=UTC))
    link = services.share.share("demo", clip.clip_id, 3600)

    preview = services.archive.age("demo", 0, dry_run=True, include_held=True)
    assert [m.clip_id for m in preview.moved] == [clip.clip_id] and preview.held == []
    assert [(r.clip_id, r.share_expires_at) for r in preview.released] == [
        (clip.clip_id, link.expires_at)
    ]
    assert services.clips.get("demo", clip.clip_id).tier == "recent"

    result = services.archive.age("demo", 0, include_held=True)
    assert [m.clip_id for m in result.moved] == [clip.clip_id]
    assert result.held == [] and result.kept_count == 0
    assert [r.clip_id for r in result.released] == [clip.clip_id]
    record = services.clips.get("demo", clip.clip_id)
    assert record.tier == "archive" and record.share_expires_at is None
    assert clip.output_key not in s3.objects


def test_project_summary_counts_held_clips():
    services, _, _, clock = make_services()
    clip = _at(services, clock, datetime(2026, 1, 1, tzinfo=UTC))
    _at(services, clock, datetime(2026, 1, 2, tzinfo=UTC))
    services.share.share("demo", clip.clip_id, 900)
    [summary] = services.clips.projects()
    assert summary.recent_count == 2 and summary.held_count == 1
    clock.advance(seconds=901)
    assert services.clips.projects()[0].held_count == 0
