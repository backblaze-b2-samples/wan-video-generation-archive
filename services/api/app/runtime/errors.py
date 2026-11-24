"""Map service-layer clip errors to HTTP statuses, in one place."""

from collections.abc import Callable
from typing import TypeVar

from fastapi import HTTPException

from app.service.errors import (
    ClipNotFoundError,
    ClipServiceError,
    InvalidClipRequestError,
    RegistryMismatchError,
)

T = TypeVar("T")

_STATUS: dict[type[ClipServiceError], int] = {
    ClipNotFoundError: 404,
    InvalidClipRequestError: 400,
    RegistryMismatchError: 409,
}

# Documented on every clip route so the contract lists the error shapes.
ERROR_RESPONSES: dict[int | str, dict] = {
    400: {"description": "Value not allowed by the registry or key layout"},
    404: {"description": "Project or clip not found"},
    409: {"description": "Manifest entry not in the pinned registry"},
    502: {"description": "Storage request failed"},
}


def call[T](fn: Callable[[], T]) -> T:
    try:
        return fn()
    except ClipServiceError as e:
        raise HTTPException(status_code=_STATUS.get(type(e), 400), detail=e.detail) from None
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"Storage request failed: {e}") from None
