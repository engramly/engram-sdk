"""Typed response models. Mirrors openapi.yaml ParseResult schema."""

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


Annotation = Literal["table", "math", "code", "image"]


class Stats(BaseModel):
    noise_ratio: float = 0.0
    tokens_saved: int = 0
    node_count: int = 0
    latency_ms: int = 0


class ParseResult(BaseModel):
    markdown: str
    primary: list[int] = Field(default_factory=list)
    secondary: list[int] = Field(default_factory=list)
    annotations: dict[str, Annotation] = Field(default_factory=dict)
    stats: Stats = Field(default_factory=Stats)
    page_title: Optional[str] = None
    url: Optional[str] = None


StreamEventType = Literal[
    "heuristic", "annotation", "markdown_chunk", "done", "error"
]


class StreamEvent(BaseModel):
    type: StreamEventType
    data: Any = None
