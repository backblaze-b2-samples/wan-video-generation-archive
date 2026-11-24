from datetime import timedelta

import pytest

from app.service.errors import ClipNotFoundError
from app.service.share import clamp_ttl
from app.types import GenerateClipRequest
from tests.fakes import make_services


@pytest.mark.parametrize(
    ("requested", "expected"),
    [(None, 3600), (10, 60), (60, 60), (900, 900), (604_800, 604_800), (10**9, 604_800)],
)
def test_ttl_is_clamped(requested, expected):
    assert clamp_ttl(requested, 3600) == expected


def test_share_signs_inline_mp4_for_current_key():
    services, s3, _, clock = make_services()
    req = GenerateClipRequest(prompt="x")
    clip = services.clips.run(services.clips.prepare_generate(req), lambda s, t: None)

    link = services.share.share("demo", clip.clip_id, 900)

    signed = s3.presigned[-1]
    assert signed["params"]["Key"] == clip.output_key == link.key
    assert signed["params"]["ResponseContentType"] == "video/mp4"
    assert signed["params"]["ResponseContentDisposition"].startswith("inline")
    assert signed["expires"] == 900
    assert link.expires_at == clock.now + timedelta(seconds=900)
    assert link.tier == "recent"


def test_share_missing_object_is_not_found():
    services, s3, _, _ = make_services()
    req = GenerateClipRequest(prompt="x")
    clip = services.clips.run(services.clips.prepare_generate(req), lambda s, t: None)
    del s3.objects[clip.output_key]
    with pytest.raises(ClipNotFoundError):
        services.share.share("demo", clip.clip_id)
