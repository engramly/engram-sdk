"""Typed response models. Mirrors openapi.yaml ParseResult schema."""

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

Annotation = Literal["table", "math", "code", "image"]

class PdfRequestInfo(BaseModel):
    elapsed_ms: float
    request_id: Optional[str] = None
    origin: Optional[Literal["edge", "modal", "vast"]] = None
    cache: Optional[str] = None
    inspect_cache: Optional[Literal["hit", "miss"]] = None
    workers: Optional[int] = None
    worker_target: Optional[int] = None
    cf_ray: Optional[str] = None
    timings: dict[str, float] = Field(default_factory=dict)


class PdfPreflightResult(BaseModel):
    cache: Literal["hit", "miss"]
    workers: int = 0
    target: int = 0
    supported: bool = True
    request: Optional[PdfRequestInfo] = None


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
    prepared: bool = False
    prepare_token: Optional[str] = None
    request: Optional[PdfRequestInfo] = None

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
    request: Optional[PdfRequestInfo] = None


class PdfProgress(BaseModel):
    phase: Literal["prepare", "parse"]
    state: Literal["started", "waiting", "completed", "failed"]
    elapsed_ms: float
    pages: Optional[int] = None
    workers: Optional[int] = None
    target: Optional[int] = None
    supported: Optional[bool] = None
    request: Optional[PdfRequestInfo] = None


class PdfPrepared(BaseModel):
    inspect: PdfInspectResult
    preflight: PdfPreflightResult
    elapsed_ms: float = 0


class PdfPreparedResult(PdfPrepared):
    result: PdfParseResult


StreamEventType = Literal[
    "heuristic", "annotation", "markdown_chunk", "done", "error"
]


class StreamEvent(BaseModel):
    type: StreamEventType
    data: Any = None
