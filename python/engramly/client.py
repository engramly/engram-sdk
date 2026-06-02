"""HTTP client for the Engram API.

Both sync and async clients share request/response handling via _build_request
and _handle_response so the wire format stays in one place.
"""

from __future__ import annotations

import json
import os
from typing import Any, AsyncIterator, Iterator, Optional

import httpx

from engramly.errors import APIError, AuthError, EngramError, RateLimitError
from engramly.types import ParseResult, StreamEvent

DEFAULT_BASE_URL = "https://api.engramly.com"
DEFAULT_TIMEOUT = 60.0
USER_AGENT = "engramly-python/0.1.0"


def _resolve(api_key: Optional[str], base_url: Optional[str]) -> tuple[str, str]:
    key = api_key or os.environ.get("ENGRAM_API_KEY")
    if not key:
        raise EngramError(
            "api_key is required. Pass api_key=... or set ENGRAM_API_KEY."
        )
    url = base_url or os.environ.get("ENGRAM_BASE_URL") or DEFAULT_BASE_URL
    return key, url.rstrip("/")


def _headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
    }


def _raise_for_status(response: httpx.Response) -> None:
    if response.status_code < 400:
        return
    body = _safe_json(response)
    err = (body or {}).get("error") or {}
    message = err.get("message") or response.text or response.reason_phrase
    code = err.get("code")
    if response.status_code == 401:
        raise AuthError(message)
    if response.status_code == 429:
        retry = response.headers.get("retry-after")
        retry_after = float(retry) if retry else None
        raise RateLimitError(message, retry_after=retry_after)
    raise APIError(message, status_code=response.status_code, code=code)


def _safe_json(response: httpx.Response) -> Optional[dict[str, Any]]:
    try:
        return response.json()
    except Exception:
        return None


def _parse_sse_line(line: str) -> Optional[StreamEvent]:
    if not line or not line.startswith("data:"):
        return None
    payload = line[5:].strip()
    if not payload or payload == "[DONE]":
        return None
    try:
        obj = json.loads(payload)
    except json.JSONDecodeError:
        return None
    return StreamEvent.model_validate(obj)


class Engram:
    """Synchronous Engram client."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = 2,
    ) -> None:
        key, url = _resolve(api_key, base_url)
        self._client = httpx.Client(
            base_url=url,
            headers=_headers(key),
            timeout=timeout,
            transport=httpx.HTTPTransport(retries=max_retries),
        )

    def __enter__(self) -> "Engram":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def parse(
        self,
        url: str,
        *,
        render: bool = True,
        timeout_ms: Optional[int] = None,
    ) -> ParseResult:
        """Parse a URL. Engram fetches it server-side."""
        body: dict[str, Any] = {"url": url, "render": render}
        if timeout_ms is not None:
            body["timeout_ms"] = timeout_ms
        response = self._client.post("/v1/parse", json=body)
        _raise_for_status(response)
        return ParseResult.model_validate(response.json())

    def parse_html(self, html: str, *, url: Optional[str] = None) -> ParseResult:
        """Parse HTML you already have."""
        body: dict[str, Any] = {"html": html}
        if url:
            body["url"] = url
        response = self._client.post("/v1/parse-html", json=body)
        _raise_for_status(response)
        return ParseResult.model_validate(response.json())

    def parse_stream(
        self,
        url: str,
        *,
        render: bool = True,
    ) -> Iterator[StreamEvent]:
        """Parse a URL and yield streaming events as they arrive."""
        body = {"url": url, "render": render, "stream": True}
        with self._client.stream(
            "POST", "/v1/parse", json=body, headers={"Accept": "text/event-stream"}
        ) as response:
            _raise_for_status(response)
            for line in response.iter_lines():
                event = _parse_sse_line(line)
                if event is not None:
                    yield event


class AsyncEngram:
    """Asynchronous Engram client."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = 2,
    ) -> None:
        key, url = _resolve(api_key, base_url)
        self._client = httpx.AsyncClient(
            base_url=url,
            headers=_headers(key),
            timeout=timeout,
            transport=httpx.AsyncHTTPTransport(retries=max_retries),
        )

    async def __aenter__(self) -> "AsyncEngram":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.close()

    async def close(self) -> None:
        await self._client.aclose()

    async def parse(
        self,
        url: str,
        *,
        render: bool = True,
        timeout_ms: Optional[int] = None,
    ) -> ParseResult:
        body: dict[str, Any] = {"url": url, "render": render}
        if timeout_ms is not None:
            body["timeout_ms"] = timeout_ms
        response = await self._client.post("/v1/parse", json=body)
        _raise_for_status(response)
        return ParseResult.model_validate(response.json())

    async def parse_html(self, html: str, *, url: Optional[str] = None) -> ParseResult:
        body: dict[str, Any] = {"html": html}
        if url:
            body["url"] = url
        response = await self._client.post("/v1/parse-html", json=body)
        _raise_for_status(response)
        return ParseResult.model_validate(response.json())

    async def parse_stream(
        self,
        url: str,
        *,
        render: bool = True,
    ) -> AsyncIterator[StreamEvent]:
        body = {"url": url, "render": render, "stream": True}
        async with self._client.stream(
            "POST", "/v1/parse", json=body, headers={"Accept": "text/event-stream"}
        ) as response:
            _raise_for_status(response)
            async for line in response.aiter_lines():
                event = _parse_sse_line(line)
                if event is not None:
                    yield event
