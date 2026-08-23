"""Official Python SDK for Engram."""

from engramly.client import Engram, AsyncEngram
from engramly.errors import (
    EngramError,
    AuthError,
    RateLimitError,
    APIError,
)
from engramly.types import (
    ParseResult,
    Stats,
    StreamEvent,
    Annotation,
)
from engramly.pdf import PdfClient

__version__ = "0.1.0"

__all__ = [
    "Engram",
    "AsyncEngram",
    "EngramError",
    "AuthError",
    "RateLimitError",
    "APIError",
    "ParseResult",
    "Stats",
    "StreamEvent",
    "Annotation",
    "PdfClient",
]
