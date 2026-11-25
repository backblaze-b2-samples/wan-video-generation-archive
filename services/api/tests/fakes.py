"""In-memory stand-ins for the S3 client and the Wan generator (no GPU, no B2)."""

import io
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

from botocore.exceptions import ClientError

from app.service.container import Services, build_services
from app.types.generation import (
    DeviceProbe,
    GeneratedVideo,
    GenerationSpec,
    StageCallback,
    StepCallback,
)


def _missing(op: str) -> ClientError:
    return ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, op)


@dataclass
class StoredObject:
    body: bytes
    content_type: str
    metadata: dict[str, str]
    last_modified: datetime


class InMemoryS3:
    """The subset of the boto3 S3 client that ClipStore uses."""

    def __init__(self):
        self.objects: dict[str, StoredObject] = {}
        self.copies: list[dict] = []
        self.presigned: list[dict] = []
        self.fail_put_for: set[str] = set()

    def put_object(self, Bucket, Key, Body, ContentType, Metadata):
        if any(Key.endswith(s) for s in self.fail_put_for):
            raise ClientError({"Error": {"Code": "500", "Message": "boom"}}, "PutObject")
        self.objects[Key] = StoredObject(
            Body.read(), ContentType, dict(Metadata), datetime.now(UTC)
        )

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": io.BytesIO(self.objects[Key].body)}

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise _missing("HeadObject")
        o = self.objects[Key]
        return {
            "ContentLength": len(o.body),
            "ContentType": o.content_type,
            "Metadata": dict(o.metadata),
            "LastModified": o.last_modified,
        }

    def copy(self, CopySource, Bucket, Key, ExtraArgs=None, Config=None):
        self.copies.append({"src": CopySource["Key"], "dst": Key, "extra": ExtraArgs})
        src = self.objects[CopySource["Key"]]
        keep = (ExtraArgs or {}).get("MetadataDirective") == "COPY"
        self.objects[Key] = StoredObject(
            src.body, src.content_type, dict(src.metadata) if keep else {}, datetime.now(UTC)
        )

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)

    def list_objects_v2(self, Bucket, Prefix="", MaxKeys=1000, ContinuationToken=None):
        keys = sorted(k for k in self.objects if k.startswith(Prefix))
        return {
            "Contents": [
                {"Key": k, "Size": len(self.objects[k].body),
                 "LastModified": self.objects[k].last_modified}
                for k in keys
            ],
            "IsTruncated": False,
        }

    def generate_presigned_url(self, op, Params, ExpiresIn):
        self.presigned.append({"op": op, "params": Params, "expires": ExpiresIn})
        query = urlencode({"X-Amz-Expires": ExpiresIn, "ct": Params.get("ResponseContentType", "")})
        return f"https://s3.example.backblazeb2.com/bucket/{Params['Key']}?{query}"


class FakeGenerator:
    """Deterministic tiny frames; records every spec it was asked for."""

    def __init__(
        self,
        width: int = 32,
        height: int = 32,
        fail: bool = False,
        device_probe: DeviceProbe | None = None,
    ):
        self.size = (width, height)
        self.fail = fail
        self.calls: list[GenerationSpec] = []
        self._loaded: str | None = None
        # Default: a GPU host where every registry model can run.
        self.device_probe = device_probe or DeviceProbe("cuda", 80.0)

    def probe(self) -> DeviceProbe:
        return self.device_probe

    @property
    def loaded_model_id(self):
        return self._loaded

    @property
    def device(self):
        return "cpu" if self._loaded else None

    def generate(
        self,
        spec: GenerationSpec,
        on_step: StepCallback,
        on_stage: StageCallback | None = None,
    ) -> GeneratedVideo:
        stage = on_stage or (lambda s, d: None)
        self.calls.append(spec)
        stage("loading", f"Loading {spec.model_id} onto cpu")
        if self.fail:
            raise RuntimeError("out of memory")
        stage("generating", None)
        self._loaded = spec.model_id
        for step in range(spec.num_inference_steps):
            on_step(step + 1, spec.num_inference_steps)
        w, h = self.size
        frames = [bytes([(spec.seed + i * 16) % 256]) * (w * h * 3) for i in range(5)]
        return GeneratedVideo(frames, w, h, "cpu", "0.35.0-fake", "fake")


@dataclass
class Clock:
    now: datetime = field(default_factory=lambda: datetime(2026, 3, 15, 12, 0, tzinfo=UTC))

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs) -> None:
        self.now = self.now + timedelta(**kwargs)


def make_services(generator: FakeGenerator | None = None, clock: Clock | None = None):
    s3 = InMemoryS3()
    gen = generator or FakeGenerator()
    clk = clock or Clock()
    counter = iter(range(1, 10_000))
    services: Services = build_services(
        s3, "test-bucket", gen, clock=clk,
        token=lambda: f"{next(counter):08x}", random_seed=lambda: 1234,
    )
    return services, s3, gen, clk
