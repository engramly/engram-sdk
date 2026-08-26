"""Typed response models. Mirrors openapi.yaml ParseResult schema."""

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

Annotation = Literal["table", "math", "code", "image"]

class PdfPreflightResult(BaseModel):
    cache: Literal["hit", "miss"]


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

class PdfOutlineItem(BaseModel):
    level: int
    title: str
    page: int

class PdfInspectResult(BaseModel):
    document_id: str
    filename: Optional[str] = None
    pages: int
    title: Optional[str] = None
    author: Optional[str] = None
    encrypted: bool = False
    outline_source: Literal["pdf", "none"] = "none"
    outline: list[PdfOutlineItem] = Field(default_factory=list)

class PdfPage(BaseModel):
    page: int
    markdown: str

class PdfParseResult(BaseModel):
    document_id: Optional[str] = None
    markdown: str
    page_markdown: list[PdfPage] = Field(default_factory=list)
    pages: int
    crops: Optional[int] = None
    elapsed: float = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


StreamEventType = Literal[
    "heuristic", "annotation", "markdown_chunk", "done", "error"
]


class StreamEvent(BaseModel):
    type: StreamEventType
    data: Any = None
