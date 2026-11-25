"""In-process FIFO of generation jobs: one worker thread, one GPU job at a time.

This is not a batch scheduler: jobs live in memory and are lost on restart
(their clips, once written, are not). The single worker is what keeps one
model on the GPU and makes the API process the manifests' single writer.
"""

import logging
import queue
import threading
import uuid
from collections.abc import Callable
from datetime import datetime

from app.service.clips import PreparedGeneration, utcnow
from app.types.clips import ClipRecord, GenerationJob
from app.types.generation import StageCallback, StepCallback

logger = logging.getLogger(__name__)

Runner = Callable[[PreparedGeneration, StepCallback, StageCallback], ClipRecord]
MAX_HISTORY = 200


class JobQueue:
    def __init__(self, runner: Runner, clock: Callable[[], datetime] = utcnow):
        self._runner = runner
        self._clock = clock
        self._jobs: dict[str, GenerationJob] = {}
        self._queue: queue.Queue[tuple[str, PreparedGeneration]] = queue.Queue()
        self._lock = threading.Lock()
        self._worker: threading.Thread | None = None
        self.succeeded = 0
        self.failed = 0

    def submit(self, kind: str, prepared: PreparedGeneration) -> GenerationJob:
        job = GenerationJob(
            job_id=uuid.uuid4().hex,
            kind=kind,
            status="queued",
            project=prepared.project,
            prompt=prepared.spec.prompt,
            step=0,
            total_steps=prepared.spec.num_inference_steps,
            regenerated_from=prepared.regenerated_from,
            created_at=self._clock(),
        )
        with self._lock:
            self._jobs[job.job_id] = job
            self._trim()
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._loop, daemon=True, name="wan-jobs")
                self._worker.start()
        self._queue.put((job.job_id, prepared))
        return job

    def get(self, job_id: str) -> GenerationJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self) -> list[GenerationJob]:
        with self._lock:
            return sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)

    def wait_idle(self, timeout: float | None = None) -> None:
        """Block until every queued job has finished (tests and the CLI)."""
        self._queue.join() if timeout is None else self._join_with_timeout(timeout)

    def _join_with_timeout(self, timeout: float) -> None:
        done = threading.Event()
        threading.Thread(target=lambda: (self._queue.join(), done.set()), daemon=True).start()
        if not done.wait(timeout):
            raise TimeoutError("jobs still running")

    def _update(self, job_id: str, **changes) -> None:
        with self._lock:
            job = self._jobs[job_id]
            if "stage" in changes and changes["stage"] != job.stage:
                # The UI counts seconds in the current stage (e.g. a long model load).
                changes["stage_started_at"] = self._clock() if changes["stage"] else None
            self._jobs[job_id] = job.model_copy(update=changes)

    def _trim(self) -> None:
        finished = [j for j in self._jobs.values() if j.status in ("succeeded", "failed")]
        finished.sort(key=lambda j: j.created_at)
        for job in finished[: max(0, len(self._jobs) - MAX_HISTORY)]:
            del self._jobs[job.job_id]

    def _loop(self) -> None:
        while True:
            job_id, prepared = self._queue.get()
            try:
                self._run(job_id, prepared)
            finally:
                self._queue.task_done()

    def _run(self, job_id: str, prepared: PreparedGeneration) -> None:
        self._update(job_id, status="running", started_at=self._clock())

        def on_step(step: int, total: int) -> None:
            self._update(
                job_id, stage="generating", stage_detail=None, step=step, total_steps=total
            )

        def on_stage(stage: str, detail: str | None) -> None:
            self._update(job_id, stage=stage, stage_detail=detail)

        try:
            record = self._runner(prepared, on_step, on_stage)
        except Exception as e:
            logger.error("Generation job %s failed", job_id, exc_info=True)
            self.failed += 1
            self._update(
                job_id, status="failed", error=str(e) or type(e).__name__,
                stage=None, stage_detail=None,
                finished_at=self._clock(),
            )
            return
        self.succeeded += 1
        self._update(
            job_id, status="succeeded", clip_id=record.clip_id, stage=None, stage_detail=None,
            step=prepared.spec.num_inference_steps, finished_at=self._clock(),
        )
