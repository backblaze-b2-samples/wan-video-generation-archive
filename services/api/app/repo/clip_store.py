"""Object operations on clips, sidecars and manifests (S3-compatible API).

`ClipStore` wraps any boto3-shaped S3 client so the service layer and the unit
tests share one code path: production passes the tagged client from
`b2_client.get_s3_client()`, tests pass an in-memory fake.
"""

import io
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from boto3.s3.transfer import TransferConfig
from botocore.exceptions import ClientError

from app.repo.list_cache import invalidate as _invalidate_list_cache

# Clips are megabytes; keep every managed copy a single CopyObject so
# `MetadataDirective=COPY` carries the AI-generated metadata across verbatim
# (multipart copies rebuild metadata from a separate head call).
_SINGLE_PART_COPY = TransferConfig(multipart_threshold=4 * 1024**3)


@dataclass(frozen=True)
class ObjectHead:
    key: str
    size: int
    content_type: str
    metadata: dict[str, str]
    last_modified: datetime | None


@dataclass(frozen=True)
class ObjectSummary:
    key: str
    size: int
    last_modified: datetime


def _is_not_found(err: ClientError) -> bool:
    code = err.response.get("Error", {}).get("Code", "")
    return code in ("404", "NoSuchKey", "NotFound")


class ClipStore:
    def __init__(self, client: Any, bucket: str):
        self._client = client
        self._bucket = bucket

    def put(
        self,
        key: str,
        data: bytes,
        content_type: str,
        metadata: dict[str, str] | None = None,
    ) -> None:
        try:
            self._client.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=io.BytesIO(data),
                ContentType=content_type,
                Metadata=metadata or {},
            )
        except ClientError as e:
            raise RuntimeError(f"B2 put failed for '{key}': {e}") from e
        _invalidate_list_cache()

    def get(self, key: str) -> bytes | None:
        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
        except ClientError as e:
            if _is_not_found(e):
                return None
            raise RuntimeError(f"B2 get failed for '{key}': {e}") from e
        return response["Body"].read()

    def head(self, key: str) -> ObjectHead | None:
        try:
            r = self._client.head_object(Bucket=self._bucket, Key=key)
        except ClientError as e:
            if _is_not_found(e):
                return None
            raise RuntimeError(f"B2 head failed for '{key}': {e}") from e
        return ObjectHead(
            key=key,
            size=int(r["ContentLength"]),
            content_type=r.get("ContentType", "application/octet-stream"),
            metadata={k.lower(): v for k, v in (r.get("Metadata") or {}).items()},
            last_modified=r.get("LastModified"),
        )

    def copy(self, src_key: str, dst_key: str) -> None:
        """Managed server-side copy that keeps content type and user metadata."""
        try:
            self._client.copy(
                CopySource={"Bucket": self._bucket, "Key": src_key},
                Bucket=self._bucket,
                Key=dst_key,
                ExtraArgs={"MetadataDirective": "COPY"},
                Config=_SINGLE_PART_COPY,
            )
        except ClientError as e:
            raise RuntimeError(f"B2 copy failed '{src_key}' -> '{dst_key}': {e}") from e
        _invalidate_list_cache()

    def delete(self, key: str) -> None:
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except ClientError as e:
            raise RuntimeError(f"B2 delete failed for '{key}': {e}") from e
        _invalidate_list_cache()

    def list(self, prefix: str) -> list[ObjectSummary]:
        out: list[ObjectSummary] = []
        kwargs: dict = {"Bucket": self._bucket, "Prefix": prefix, "MaxKeys": 1000}
        try:
            while True:
                r = self._client.list_objects_v2(**kwargs)
                for obj in r.get("Contents", []):
                    out.append(ObjectSummary(obj["Key"], int(obj["Size"]), obj["LastModified"]))
                if not r.get("IsTruncated"):
                    break
                kwargs["ContinuationToken"] = r["NextContinuationToken"]
        except ClientError as e:
            raise RuntimeError(f"B2 list failed for '{prefix}': {e}") from e
        return out

    def presign_inline_video(self, key: str, expires_in: int) -> str:
        """Presigned GET that a browser plays in place (inline `video/mp4`)."""
        filename = key.rsplit("/", 1)[-1]
        try:
            return self._client.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": self._bucket,
                    "Key": key,
                    "ResponseContentType": "video/mp4",
                    "ResponseContentDisposition": f'inline; filename="{filename}"',
                },
                ExpiresIn=expires_in,
            )
        except ClientError as e:
            raise RuntimeError(f"B2 presign failed for '{key}': {e}") from e
