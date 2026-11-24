"""Service-layer errors; runtime/ maps each to one HTTP status."""


class ClipServiceError(Exception):
    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)


class ClipNotFoundError(ClipServiceError):
    """404: the project or clip is not in any manifest."""


class InvalidClipRequestError(ClipServiceError):
    """400: a value the registry or key layout does not allow."""


class RegistryMismatchError(ClipServiceError):
    """409: a manifest entry's model or revision is not in the pinned registry."""
