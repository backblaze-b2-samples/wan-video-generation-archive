"""Registry pins, the huggingface.co-only guard, and device / offload selection."""

import re

import pytest

from app.config.models import (
    DEFAULT_MODEL_ID,
    FRAME_OPTIONS,
    HF_BASE_URL,
    MODELS,
    is_pinned,
)
from app.repo.wan_pipeline import check_hf_endpoint, resolve_offload, select_device


def test_every_model_is_pinned_to_a_full_commit_and_apache_2():
    assert DEFAULT_MODEL_ID in MODELS
    for spec in MODELS.values():
        assert re.fullmatch(r"[0-9a-f]{40}", spec.revision), spec.id
        assert spec.license == "apache-2.0", spec.id
        assert re.fullmatch(r"Wan-AI/[A-Za-z0-9.\-]+-Diffusers", spec.hf_repo), spec.id


def test_no_restricted_license_models_are_offered():
    for spec in MODELS.values():
        assert "ltx" not in spec.hf_repo.lower()


def test_frame_options_are_4k_plus_1_and_resolutions_fit_the_vae():
    assert all((n - 1) % 4 == 0 for n in FRAME_OPTIONS)
    for spec in MODELS.values():
        for r in spec.resolutions:
            assert r.width % 16 == 0 and r.height % 16 == 0


def test_is_pinned_requires_exact_revision():
    spec = MODELS[DEFAULT_MODEL_ID]
    assert is_pinned(spec.id, spec.revision)
    assert not is_pinned(spec.id, "0" * 40)
    assert not is_pinned("ltx-video", spec.revision)


@pytest.mark.parametrize("value", [None, "", HF_BASE_URL, HF_BASE_URL + "/"])
def test_hf_endpoint_guard_accepts_huggingface(value):
    check_hf_endpoint(value)


@pytest.mark.parametrize("value", ["https://hf-mirror.com", "http://huggingface.co"])
def test_hf_endpoint_guard_refuses_mirrors(value):
    with pytest.raises(RuntimeError, match=r"huggingface\.co"):
        check_hf_endpoint(value)


def test_device_autodetect_order():
    yes, no = (lambda: True), (lambda: False)
    assert select_device("auto", yes, yes) == "cuda"
    assert select_device("auto", no, yes) == "mps"
    assert select_device("auto", no, no) == "cpu"
    assert select_device("cpu", yes, yes) == "cpu"
    with pytest.raises(ValueError):
        select_device("tpu", yes, yes)


def test_cpu_offload_auto_below_40_gb():
    assert resolve_offload("auto", "cuda", 24.0) is True
    assert resolve_offload("auto", "cuda", 48.0) is False
    assert resolve_offload("off", "cuda", 24.0) is False
    assert resolve_offload("on", "cuda", 80.0) is True
    assert resolve_offload("on", "mps", None) is False


def test_api_never_imports_torch():
    import sys

    import main  # noqa: F401

    assert "torch" not in sys.modules
    assert "diffusers" not in sys.modules
