"""Official Python SDK for Engram."""

from engramly.client import AsyncEngram, Engram
from engramly.errors import (
    APIError,
    AuthError,
    EngramError,
    RateLimitError,
)
from engramly.pdf import AsyncPdfClient, PdfClient
from engramly.types import (
    Annotation,
    ParseResult,
    PdfProgress,
    Stats,
    StreamEvent,
)

__version__ = "0.1.0"

__all__ = [
    "APIError",
    "Annotation",
    "AsyncEngram",
    "AsyncPdfClient",
    "AuthError",
    "Engram",
    "EngramError",
    "ParseResult",
    "PdfClient",
    "PdfProgress",
    "RateLimitError",
    "Stats",
    "StreamEvent",
]
