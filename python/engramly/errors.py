"""Error hierarchy for the Engram SDK."""

from typing import Any, Optional


class EngramError(Exception):
    """Base error for all Engram SDK exceptions."""

    def __init__(self, message: str, *, code: Optional[str] = None) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class AuthError(EngramError):
    """401 — missing or invalid API key."""


class RateLimitError(EngramError):
    """429 — too many requests."""

    def __init__(self, message: str, *, retry_after: Optional[float] = None) -> None:
        super().__init__(message, code="rate_limited")
        self.retry_after = retry_after


class APIError(EngramError):
    """Generic 4xx/5xx error from the API."""

    def __init__(
        self, message: str, *, status_code: int, code: Optional[str] = None,
        phase: Optional[str] = None, request: Any = None, prepared: Any = None,
    ) -> None:
        super().__init__(message, code=code)
        self.status_code = status_code
        self.phase = phase
        self.request = request
        self.prepared = prepared
