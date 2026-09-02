from __future__ import annotations

import asyncio
import hashlib
import inspect as inspect_module
import time
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path
from typing import Optional, Union

import httpx

from engramly.client import _raise_for_status
from engramly.errors import APIError
from engramly.types import (
    PdfInspectResult,
    PdfParseResult,
    PdfPreflightResult,
    PdfPrepared,
    PdfPreparedResult,
    PdfProgress,
    PdfRequestInfo,
)

Source = Union[str, Path, bytes]
DEFAULT_PDF_TIMEOUT = httpx.Timeout(15 * 60.0, connect=15.0, write=5 * 60.0, pool=30.0)
PREPARE_FAST_POLL_SECONDS = 0.5
PREPARE_NORMAL_POLL_SECONDS = 1.0
PREPARE_SLOW_POLL_SECONDS = 2.0
Progress = Optional[Callable[[PdfProgress], object]]


def _emit(callback: Progress, event: PdfProgress) -> None:
    if callback is None:
        return
    with suppress(Exception):
        callback(event)


async def _emit_async(callback: Progress, event: PdfProgress) -> None:
    if callback is None:
        return
    with suppress(Exception):
        result = callback(event)
        if inspect_module.isawaitable(result):
            await result


def _content(source: Source) -> bytes:
    if isinstance(source, bytes):
        return source
    value = str(source)
    if value.startswith("https://"):
        raise ValueError("This operation requires local PDF bytes")
    return Path(value).read_bytes()


def _prepare_poll_seconds(elapsed: float) -> float:
    if elapsed < 30.0:
        return PREPARE_FAST_POLL_SECONDS
    if elapsed < 120.0:
        return PREPARE_NORMAL_POLL_SECONDS
    return PREPARE_SLOW_POLL_SECONDS


def _form(
    source: Source, *, figures: Optional[bool] = None, dpi: Optional[int] = None,
) -> tuple[dict[str, str], Optional[dict[str, tuple[str, bytes, str]]]]:
    if isinstance(source, bytes):
        data = {}
        if figures is not None:
            data["figures"] = str(figures).lower()
        if dpi is not None:
            data["dpi"] = str(dpi)
        return data, {"file": ("document.pdf", source, "application/pdf")}
    value = str(source)
    if value.startswith("https://"):
        return {"url": value}, None
    path = Path(value)
    data = {}
    if figures is not None:
        data["figures"] = str(figures).lower()
    if dpi is not None:
        data["dpi"] = str(dpi)
    return data, {"file": (path.name, path.read_bytes(), "application/pdf")}


def _timings(value: Optional[str]) -> dict[str, float]:
    output: dict[str, float] = {}
    for part in (value or "").split(","):
        fields = [field.strip() for field in part.split(";")]
        duration = next((field[4:] for field in fields[1:] if field.startswith("dur=")), None)
        if not fields[0] or not duration:
            continue
        try:
            output[fields[0]] = float(duration)
        except ValueError:
            continue
    return output


def _request(response: httpx.Response, started: float) -> PdfRequestInfo:
    raw_workers = response.headers.get("x-engram-workers")
    try:
        workers = int(raw_workers) if raw_workers is not None else None
    except ValueError:
        workers = None
    raw_target = response.headers.get("x-engram-worker-target")
    try:
        worker_target = int(raw_target) if raw_target is not None else None
    except ValueError:
        worker_target = None
    origin = response.headers.get("x-engram-origin")
    return PdfRequestInfo(
        elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
        request_id=response.headers.get("x-engram-request-id"),
        origin=origin if origin in {"edge", "modal", "vast"} else None,
        cache=response.headers.get("x-engram-cache"),
        inspect_cache=(
            response.headers.get("x-engram-inspect-cache")
            if response.headers.get("x-engram-inspect-cache") in {"hit", "miss"}
            else None
        ),
        workers=workers,
        worker_target=worker_target,
        cf_ray=response.headers.get("cf-ray"),
        timings=_timings(response.headers.get("server-timing")),
    )


def _parse(response: httpx.Response, started: float) -> PdfParseResult:
    _raise_for_status(response, phase="parse", request=_request(response, started))
    result = PdfParseResult.model_validate(response.json())
    result.request = _request(response, started)
    return result


class PdfClient:
    def __init__(
        self, api_key: str, base_url: str, timeout: Union[float, httpx.Timeout] = DEFAULT_PDF_TIMEOUT,
        *, client: Optional[httpx.Client] = None,
    ) -> None:
        self._owned = client is None
        self._client = client or httpx.Client(
            base_url=base_url, headers={"Authorization": f"Bearer {api_key}"}, timeout=timeout,
        )
        self._timeout = timeout
        self._prepare_timeout = (
            float(timeout) if isinstance(timeout, (int, float)) else float(timeout.read or 15 * 60.0)
        )

    def __enter__(self) -> PdfClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        if self._owned:
            self._client.close()

    def inspect(
        self, source: Source, *, figures: bool = False, dpi: int = 200,
        _async_prepare: bool = False,
    ) -> PdfInspectResult:
        data, files = _form(source, figures=figures, dpi=dpi)
        started = time.perf_counter()
        response = self._client.post(
            "/v1/pdf/inspect", data=data, files=files, timeout=self._timeout,
            headers={"X-Engram-Async-Prepare": "1"} if _async_prepare else None,
        )
        _raise_for_status(response, phase="inspect", request=_request(response, started))
        result = PdfInspectResult.model_validate(response.json())
        result.request = _request(response, started)
        result.prepared = response.headers.get("x-engram-prepared") == "1"
        result.prepare_token = response.headers.get("x-engram-prepare-token")
        return result

    def preflight(
        self, source: Source, *, figures: bool = False, dpi: int = 200, pages: Optional[int] = None,
    ) -> PdfPreflightResult:
        started = time.perf_counter()
        response = self._client.post("/v1/pdf/preflight", json={
            "sha256": hashlib.sha256(_content(source)).hexdigest(), "figures": figures,
            "dpi": dpi, "pages": pages,
        }, timeout=self._timeout)
        _raise_for_status(response, phase="preflight", request=_request(response, started))
        result = PdfPreflightResult.model_validate(response.json())
        result.request = _request(response, started)
        return result

    def prepare(
        self, source: Source, *, figures: bool = False, dpi: int = 200,
        on_progress: Progress = None,
    ) -> PdfPrepared:
        started = time.perf_counter()
        _emit(on_progress, PdfProgress(phase="prepare", state="started", elapsed_ms=0))
        local = _content(source)
        try:
            inspect = self.inspect(local, figures=figures, dpi=dpi, _async_prepare=True)
        except Exception as error:
            _emit(on_progress, PdfProgress(
                phase="prepare", state="failed", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                request=error.request if isinstance(error, APIError) else None,
            ))
            raise
        if inspect.prepared and inspect.request is not None:
            result = PdfPrepared(inspect=inspect, preflight=PdfPreflightResult(
                cache="hit" if inspect.request.cache == "edge" else "miss",
                workers=inspect.request.workers or 0,
                target=inspect.request.worker_target or 0, supported=True, request=inspect.request,
            ), elapsed_ms=round((time.perf_counter() - started) * 1000, 1))
            _emit(on_progress, PdfProgress(
                phase="prepare", state="completed", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                pages=inspect.pages, workers=result.preflight.workers, target=result.preflight.target,
                supported=True, request=inspect.request,
            ))
            return result
        if inspect.prepare_token:
            try:
                request = self._wait_for_preparation(inspect, started, on_progress)
            except Exception as error:
                _emit(on_progress, PdfProgress(
                    phase="prepare", state="failed", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                    pages=inspect.pages, request=error.request if isinstance(error, APIError) else None,
                ))
                raise
            preflight = PdfPreflightResult(
                cache="hit" if inspect.request and inspect.request.cache == "edge" else "miss",
                workers=inspect.request.workers if inspect.request and inspect.request.workers else 0,
                target=inspect.request.worker_target if inspect.request and inspect.request.worker_target else 0,
                supported=True, request=request,
            )
            inspect.prepared = True
            _emit(on_progress, PdfProgress(
                phase="prepare", state="completed", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                pages=inspect.pages, workers=preflight.workers, target=preflight.target,
                supported=True, request=request,
            ))
            return PdfPrepared(
                inspect=inspect, preflight=preflight,
                elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
            )
        try:
            preflight = self.preflight(local, figures=figures, dpi=dpi, pages=inspect.pages)
        except APIError as error:
            if error.status_code != 404:
                _emit(on_progress, PdfProgress(
                    phase="prepare", state="failed", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                    pages=inspect.pages, request=error.request,
                ))
                raise
            preflight = PdfPreflightResult(
                cache="miss", workers=0, target=0, supported=False, request=inspect.request,
            )
        result = PdfPrepared(
            inspect=inspect, preflight=preflight,
            elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
        )
        _emit(on_progress, PdfProgress(
            phase="prepare", state="completed", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
            pages=inspect.pages, workers=preflight.workers, target=preflight.target,
            supported=preflight.supported, request=preflight.request,
        ))
        return result

    def _wait_for_preparation(
        self, inspect: PdfInspectResult, started: float, on_progress: Progress,
    ) -> PdfRequestInfo:
        deadline = started + self._prepare_timeout
        while time.perf_counter() < deadline:
            poll = time.perf_counter()
            response = self._client.post(
                "/v1/pdf/prepare/status", json={"token": inspect.prepare_token},
                timeout=min(self._prepare_timeout, 30.0),
            )
            _raise_for_status(response, phase="preflight", request=_request(response, poll))
            state = response.json().get("state")
            if state == "ready":
                request = _request(response, started)
                if inspect.request is not None:
                    request.workers = inspect.request.workers
                    request.worker_target = inspect.request.worker_target
                return request
            if state != "pending":
                raise APIError("PDF inference preparation failed", status_code=response.status_code, phase="preflight")
            remaining = deadline - time.perf_counter()
            if remaining <= 0:
                break
            time.sleep(min(_prepare_poll_seconds(time.perf_counter() - started), remaining))
            _emit(on_progress, PdfProgress(
                phase="prepare", state="waiting", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                pages=inspect.pages, workers=inspect.request.workers if inspect.request else None,
                target=inspect.request.worker_target if inspect.request else None,
                supported=True, request=inspect.request,
            ))
        raise APIError(
            "PDF inference preparation timed out", status_code=408, phase="preflight", request=inspect.request,
        )

    def parse(
        self, source: Source, *, pages: Optional[str] = None, figures: bool = False, dpi: int = 200,
        on_progress: Progress = None, _prewarmed: bool = False,
        _prepared_origin: Optional[str] = None, _page_count: Optional[int] = None,
    ) -> PdfParseResult:
        data, files = _form(source)
        data.update({"figures": str(figures).lower(), "dpi": str(dpi)})
        if pages:
            data["pages"] = pages
        if _prewarmed:
            data["prewarmed"] = "true"
        if _prepared_origin:
            data["prepared_origin"] = _prepared_origin
        if _page_count is not None:
            data["page_count"] = str(_page_count)
        started = time.perf_counter()
        _emit(on_progress, PdfProgress(phase="parse", state="started", elapsed_ms=0, pages=_page_count))
        try:
            result = _parse(self._client.post(
                "/v1/pdf/parse", data=data, files=files, timeout=self._timeout,
            ), started)
        except Exception as error:
            _emit(on_progress, PdfProgress(
                phase="parse", state="failed", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                pages=_page_count, request=error.request if isinstance(error, APIError) else None,
            ))
            raise
        _emit(on_progress, PdfProgress(
            phase="parse", state="completed", elapsed_ms=result.request.elapsed_ms if result.request else 0,
            pages=result.pages, request=result.request,
        ))
        return result

    def parse_prepared(
        self, source: Source, *, pages: Optional[str] = None, figures: bool = False, dpi: int = 200,
        on_progress: Progress = None,
    ) -> PdfPreparedResult:
        if pages:
            raise ValueError(
                "Prepared parsing supports complete documents only; "
                "use parse() for selected pages"
            )
        local = _content(source)
        prepared = self.prepare(local, figures=figures, dpi=dpi, on_progress=on_progress)
        try:
            result = self.parse(
                local, pages=pages, figures=figures, dpi=dpi, on_progress=on_progress,
                _prewarmed=prepared.preflight.supported,
                _prepared_origin=(
                    "edge" if prepared.preflight.cache == "hit" else
                    "vast" if prepared.preflight.workers > 0 else "modal"
                ) if prepared.preflight.supported else None,
                _page_count=prepared.inspect.pages,
            )
        except APIError as error:
            error.prepared = prepared
            raise
        return PdfPreparedResult(
            inspect=prepared.inspect, preflight=prepared.preflight,
            elapsed_ms=prepared.elapsed_ms, result=result,
        )


class AsyncPdfClient:
    def __init__(
        self, api_key: str, base_url: str, timeout: Union[float, httpx.Timeout] = DEFAULT_PDF_TIMEOUT,
        *, client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self._owned = client is None
        self._client = client or httpx.AsyncClient(
            base_url=base_url, headers={"Authorization": f"Bearer {api_key}"}, timeout=timeout,
        )
        self._timeout = timeout
        self._prepare_timeout = (
            float(timeout) if isinstance(timeout, (int, float)) else float(timeout.read or 15 * 60.0)
        )

    async def __aenter__(self) -> AsyncPdfClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    async def close(self) -> None:
        if self._owned:
            await self._client.aclose()

    async def inspect(
        self, source: Source, *, figures: bool = False, dpi: int = 200,
        _async_prepare: bool = False,
    ) -> PdfInspectResult:
        data, files = _form(source, figures=figures, dpi=dpi)
        started = time.perf_counter()
        response = await self._client.post(
            "/v1/pdf/inspect", data=data, files=files, timeout=self._timeout,
            headers={"X-Engram-Async-Prepare": "1"} if _async_prepare else None,
        )
        _raise_for_status(response, phase="inspect", request=_request(response, started))
        result = PdfInspectResult.model_validate(response.json())
        result.request = _request(response, started)
        result.prepared = response.headers.get("x-engram-prepared") == "1"
        result.prepare_token = response.headers.get("x-engram-prepare-token")
        return result

    async def preflight(
        self, source: Source, *, figures: bool = False, dpi: int = 200, pages: Optional[int] = None,
    ) -> PdfPreflightResult:
        started = time.perf_counter()
        response = await self._client.post("/v1/pdf/preflight", json={
            "sha256": hashlib.sha256(_content(source)).hexdigest(), "figures": figures,
            "dpi": dpi, "pages": pages,
        }, timeout=self._timeout)
        _raise_for_status(response, phase="preflight", request=_request(response, started))
        result = PdfPreflightResult.model_validate(response.json())
        result.request = _request(response, started)
        return result

    async def prepare(
        self, source: Source, *, figures: bool = False, dpi: int = 200,
        on_progress: Progress = None,
    ) -> PdfPrepared:
        started = time.perf_counter()
        await _emit_async(on_progress, PdfProgress(phase="prepare", state="started", elapsed_ms=0))
        local = _content(source)
        try:
            inspect = await self.inspect(local, figures=figures, dpi=dpi, _async_prepare=True)
        except Exception as error:
            await _emit_async(on_progress, PdfProgress(
                phase="prepare", state="failed", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                request=error.request if isinstance(error, APIError) else None,
            ))
            raise
        if inspect.prepared and inspect.request is not None:
            result = PdfPrepared(inspect=inspect, preflight=PdfPreflightResult(
                cache="hit" if inspect.request.cache == "edge" else "miss",
                workers=inspect.request.workers or 0,
                target=inspect.request.worker_target or 0, supported=True, request=inspect.request,
            ), elapsed_ms=round((time.perf_counter() - started) * 1000, 1))
            await _emit_async(on_progress, PdfProgress(
                phase="prepare", state="completed", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                pages=inspect.pages, workers=result.preflight.workers, target=result.preflight.target,
                supported=True, request=inspect.request,
            ))
            return result
        if inspect.prepare_token:
            try:
                request = await self._wait_for_preparation(inspect, started, on_progress)
            except Exception as error:
                await _emit_async(on_progress, PdfProgress(
                    phase="prepare", state="failed", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                    pages=inspect.pages, request=error.request if isinstance(error, APIError) else None,
                ))
                raise
            preflight = PdfPreflightResult(
                cache="hit" if inspect.request and inspect.request.cache == "edge" else "miss",
                workers=inspect.request.workers if inspect.request and inspect.request.workers else 0,
                target=inspect.request.worker_target if inspect.request and inspect.request.worker_target else 0,
                supported=True, request=request,
            )
            inspect.prepared = True
            await _emit_async(on_progress, PdfProgress(
                phase="prepare", state="completed", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                pages=inspect.pages, workers=preflight.workers, target=preflight.target,
                supported=True, request=request,
            ))
            return PdfPrepared(
                inspect=inspect, preflight=preflight,
                elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
            )
        try:
            preflight = await self.preflight(
                local, figures=figures, dpi=dpi, pages=inspect.pages,
            )
        except APIError as error:
            if error.status_code != 404:
                await _emit_async(on_progress, PdfProgress(
                    phase="prepare", state="failed", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                    pages=inspect.pages, request=error.request,
                ))
                raise
            preflight = PdfPreflightResult(
                cache="miss", workers=0, target=0, supported=False, request=inspect.request,
            )
        result = PdfPrepared(
            inspect=inspect, preflight=preflight,
            elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
        )
        await _emit_async(on_progress, PdfProgress(
            phase="prepare", state="completed", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
            pages=inspect.pages, workers=preflight.workers, target=preflight.target,
            supported=preflight.supported, request=preflight.request,
        ))
        return result

    async def _wait_for_preparation(
        self, inspect: PdfInspectResult, started: float, on_progress: Progress,
    ) -> PdfRequestInfo:
        deadline = started + self._prepare_timeout
        while time.perf_counter() < deadline:
            poll = time.perf_counter()
            response = await self._client.post(
                "/v1/pdf/prepare/status", json={"token": inspect.prepare_token},
                timeout=min(self._prepare_timeout, 30.0),
            )
            _raise_for_status(response, phase="preflight", request=_request(response, poll))
            state = response.json().get("state")
            if state == "ready":
                request = _request(response, started)
                if inspect.request is not None:
                    request.workers = inspect.request.workers
                    request.worker_target = inspect.request.worker_target
                return request
            if state != "pending":
                raise APIError("PDF inference preparation failed", status_code=response.status_code, phase="preflight")
            remaining = deadline - time.perf_counter()
            if remaining <= 0:
                break
            await asyncio.sleep(min(
                _prepare_poll_seconds(time.perf_counter() - started), remaining,
            ))
            await _emit_async(on_progress, PdfProgress(
                phase="prepare", state="waiting", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                pages=inspect.pages, workers=inspect.request.workers if inspect.request else None,
                target=inspect.request.worker_target if inspect.request else None,
                supported=True, request=inspect.request,
            ))
        raise APIError(
            "PDF inference preparation timed out", status_code=408, phase="preflight", request=inspect.request,
        )

    async def parse(
        self, source: Source, *, pages: Optional[str] = None, figures: bool = False, dpi: int = 200,
        on_progress: Progress = None, _prewarmed: bool = False,
        _prepared_origin: Optional[str] = None, _page_count: Optional[int] = None,
    ) -> PdfParseResult:
        data, files = _form(source)
        data.update({"figures": str(figures).lower(), "dpi": str(dpi)})
        if pages:
            data["pages"] = pages
        if _prewarmed:
            data["prewarmed"] = "true"
        if _prepared_origin:
            data["prepared_origin"] = _prepared_origin
        if _page_count is not None:
            data["page_count"] = str(_page_count)
        started = time.perf_counter()
        await _emit_async(on_progress, PdfProgress(phase="parse", state="started", elapsed_ms=0, pages=_page_count))
        try:
            result = _parse(await self._client.post(
                "/v1/pdf/parse", data=data, files=files, timeout=self._timeout,
            ), started)
        except Exception as error:
            await _emit_async(on_progress, PdfProgress(
                phase="parse", state="failed", elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
                pages=_page_count, request=error.request if isinstance(error, APIError) else None,
            ))
            raise
        await _emit_async(on_progress, PdfProgress(
            phase="parse", state="completed", elapsed_ms=result.request.elapsed_ms if result.request else 0,
            pages=result.pages, request=result.request,
        ))
        return result

    async def parse_prepared(
        self, source: Source, *, pages: Optional[str] = None, figures: bool = False, dpi: int = 200,
        on_progress: Progress = None,
    ) -> PdfPreparedResult:
        if pages:
            raise ValueError(
                "Prepared parsing supports complete documents only; "
                "use parse() for selected pages"
            )
        local = _content(source)
        prepared = await self.prepare(local, figures=figures, dpi=dpi, on_progress=on_progress)
        try:
            result = await self.parse(
                local, pages=pages, figures=figures, dpi=dpi, on_progress=on_progress,
                _prewarmed=prepared.preflight.supported,
                _prepared_origin=(
                    "edge" if prepared.preflight.cache == "hit" else
                    "vast" if prepared.preflight.workers > 0 else "modal"
                ) if prepared.preflight.supported else None,
                _page_count=prepared.inspect.pages,
            )
        except APIError as error:
            error.prepared = prepared
            raise
        return PdfPreparedResult(
            inspect=prepared.inspect, preflight=prepared.preflight,
            elapsed_ms=prepared.elapsed_ms, result=result,
        )
