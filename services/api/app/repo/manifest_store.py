"""Per-project JSONL manifests at `video/manifests/<project>.jsonl`.

B2 has no append, so every change is a read-modify-write of the whole file.
That is safe because the API process is the single writer: each project has
its own `threading.Lock`, and every mutation goes through `update()` under it.
Running a second API process (or the CLI against a live API) on the same
project could lose an update; see docs/RELIABILITY.md.
"""

import json
import threading
from collections.abc import Callable

from app.config.layout import MANIFEST_PREFIX, manifest_key, project_from_manifest_key
from app.repo.clip_store import ClipStore
from app.types.clips import ClipRecord

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(project: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(project, threading.Lock())


def encode_lines(records: list[ClipRecord]) -> bytes:
    return "".join(r.model_dump_json() + "\n" for r in records).encode("utf-8")


def decode_lines(data: bytes) -> list[ClipRecord]:
    return [
        ClipRecord.model_validate(json.loads(line))
        for line in data.decode("utf-8").splitlines()
        if line.strip()
    ]


class ManifestStore:
    def __init__(self, store: ClipStore):
        self._store = store

    def read(self, project: str) -> list[ClipRecord]:
        data = self._store.get(manifest_key(project))
        return decode_lines(data) if data else []

    def update(
        self, project: str, change: Callable[[list[ClipRecord]], list[ClipRecord]]
    ) -> list[ClipRecord]:
        """Apply `change` to the current lines and write the result, atomically per project."""
        with _lock_for(project):
            records = change(self.read(project))
            key = manifest_key(project)
            if records:
                self._store.put(key, encode_lines(records), "application/x-ndjson")
            else:
                self._store.delete(key)
            return records

    def append(self, record: ClipRecord) -> None:
        self.update(record.project, lambda rs: [*rs, record])

    def replace(self, record: ClipRecord) -> None:
        self.update(
            record.project,
            lambda rs: [record if r.clip_id == record.clip_id else r for r in rs],
        )

    def remove(self, project: str, clip_id: str) -> None:
        self.update(project, lambda rs: [r for r in rs if r.clip_id != clip_id])

    def list_projects(self) -> list[str]:
        names = (project_from_manifest_key(o.key) for o in self._store.list(MANIFEST_PREFIX))
        return sorted(n for n in names if n)
