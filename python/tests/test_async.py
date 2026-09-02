"""Async client tests."""

import httpx
import respx

from engramly import AsyncEngram

BASE = "https://api.engramly.net"
WEB = "http://localhost:7842"

SAMPLE = {
    "markdown": "# Async",
    "primary": [],
    "secondary": [],
    "annotations": {},
    "stats": {"noise_ratio": 0.1, "tokens_saved": 100, "node_count": 5, "latency_ms": 50},
}


@respx.mock
async def test_async_parse():
    respx.post(f"{WEB}/v1/parse").mock(return_value=httpx.Response(200, json=SAMPLE))
    async with AsyncEngram(api_key="sk-test", base_url=WEB) as engram:
        result = await engram.parse("https://example.com")
    assert result.markdown == "# Async"


@respx.mock
async def test_async_parse_html():
    respx.post(f"{WEB}/v1/parse-html").mock(return_value=httpx.Response(200, json=SAMPLE))
    async with AsyncEngram(api_key="sk-test", base_url=WEB) as engram:
        result = await engram.parse_html("<p>hi</p>")
    assert result.stats.tokens_saved == 100


@respx.mock
async def test_async_pdf_parity():
    respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, json={
        "document_id": "abc", "pages": 3, "outline_source": "none", "outline": [],
    }))
    respx.post(f"{BASE}/v1/pdf/preflight").mock(return_value=httpx.Response(200, json={
        "cache": "miss", "workers": 1,
    }))
    respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(200, json={
        "markdown": "pdf", "pages": 3, "page_markdown": [],
    }))
    async with AsyncEngram(api_key="key") as engram:
        result = await engram.pdf.parse_prepared(b"%PDF")
    assert result.inspect.pages == 3
    assert result.preflight.workers == 1
    assert result.result.markdown == "pdf"


@respx.mock
async def test_async_pdf_uses_single_preparation_request_when_supported():
    respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, headers={
        "x-engram-prepared": "1", "x-engram-workers": "1",
        "x-engram-cache": "miss",
    }, json={
        "document_id": "abc", "pages": 3, "outline_source": "none", "outline": [],
    }))
    preflight = respx.post(f"{BASE}/v1/pdf/preflight").mock(return_value=httpx.Response(500))
    respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(200, json={
        "markdown": "pdf", "pages": 3, "page_markdown": [],
    }))
    async with AsyncEngram(api_key="key") as engram:
        result = await engram.pdf.parse_prepared(b"%PDF")
    assert not preflight.called
    assert result.inspect.prepared is True
    assert result.elapsed_ms >= 0
    assert result.preflight.workers == 1


@respx.mock
async def test_async_pdf_polls_asynchronous_preparation_before_parse():
    respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, headers={
        "x-engram-prepared": "0", "x-engram-prepare-token": "opaque-token",
    }, json={
        "document_id": "abc", "pages": 2, "outline_source": "none", "outline": [],
    }))
    status = respx.post(f"{BASE}/v1/pdf/prepare/status").mock(return_value=httpx.Response(200, json={
        "state": "ready",
    }))
    parse = respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(200, json={
        "markdown": "ok", "pages": 2, "page_markdown": [],
    }))
    async with AsyncEngram(api_key="key") as engram:
        result = await engram.pdf.parse_prepared(b"%PDF")
    assert status.called
    assert b'name="prewarmed"' in parse.calls[0].request.content
    assert b'name="prepared_origin"' in parse.calls[0].request.content
    assert b"modal" in parse.calls[0].request.content
    assert result.preflight.workers == 0
    assert result.inspect.prepared is True


@respx.mock
async def test_async_pdf_uses_vast_when_it_wins_asynchronous_preparation():
    respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, headers={
        "x-engram-prepared": "0", "x-engram-prepare-token": "opaque-token",
        "x-engram-workers": "0", "x-engram-worker-target": "2",
    }, json={
        "document_id": "abc", "pages": 2, "outline_source": "none", "outline": [],
    }))
    respx.post(f"{BASE}/v1/pdf/prepare/status").mock(return_value=httpx.Response(200, headers={
        "x-engram-origin": "vast", "x-engram-workers": "2",
    }, json={"state": "ready", "origin": "vast", "workers": 2}))
    parse = respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(200, json={
        "markdown": "ok", "pages": 2, "page_markdown": [],
    }))

    async with AsyncEngram(api_key="key") as engram:
        result = await engram.pdf.parse_prepared(b"%PDF")

    assert b'name="prewarmed"' in parse.calls[0].request.content
    assert b'name="prepared_origin"' in parse.calls[0].request.content
    assert b"vast" in parse.calls[0].request.content
    assert result.preflight.workers == 2
    assert result.preflight.target == 2
    assert result.preflight.request.origin == "vast"


@respx.mock
async def test_async_pdf_polls_pending_preparation_without_blocking(monkeypatch):
    respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, headers={
        "x-engram-prepared": "0", "x-engram-prepare-token": "opaque-token",
    }, json={
        "document_id": "abc", "pages": 2, "outline_source": "none", "outline": [],
    }))
    status = respx.post(f"{BASE}/v1/pdf/prepare/status").mock(side_effect=[
        httpx.Response(202, json={"state": "pending"}),
        httpx.Response(200, headers={"x-engram-origin": "modal"}, json={"state": "ready"}),
    ])
    respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(200, json={
        "markdown": "ok", "pages": 2, "page_markdown": [],
    }))

    async def no_wait(_seconds):
        return None

    monkeypatch.setattr("engramly.pdf.asyncio.sleep", no_wait)
    async with AsyncEngram(api_key="key") as engram:
        result = await engram.pdf.parse_prepared(b"%PDF")
    assert status.call_count == 2
    assert result.preflight.request.origin == "modal"


@respx.mock
async def test_async_pdf_degrades_when_legacy_gateway_lacks_preflight():
    respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, json={
        "document_id": "abc", "pages": 2, "outline_source": "none", "outline": [],
    }))
    respx.post(f"{BASE}/v1/pdf/preflight").mock(return_value=httpx.Response(
        404, json={"error": "not_found"},
    ))
    parse = respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(200, json={
        "markdown": "ok", "pages": 2, "page_markdown": [],
    }))
    async with AsyncEngram(api_key="key") as engram:
        result = await engram.pdf.parse_prepared(b"%PDF")
    assert parse.called
    assert result.preflight.workers == 0
    assert b'name="prewarmed"' not in parse.calls[0].request.content
    assert b'name="prepared_origin"' not in parse.calls[0].request.content


async def test_async_pdf_pool_lifecycle_and_retry_isolation():
    engram = AsyncEngram(api_key="key", max_retries=2)
    assert engram.pdf._client is not engram._client
    assert engram._client._transport._pool._retries == 2
    assert engram.pdf._client._transport._pool._retries == 0
    await engram.close()
    assert engram._client.is_closed and engram.pdf._client.is_closed


@respx.mock
async def test_async_pdf_awaits_progress_callback():
    respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, headers={
        "x-engram-prepared": "1",
    }, json={
        "document_id": "abc", "pages": 2, "outline_source": "none", "outline": [],
    }))
    respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(200, json={
        "markdown": "ok", "pages": 2, "page_markdown": [],
    }))
    events = []

    async def progress(event):
        events.append(f"{event.phase}:{event.state}")

    async with AsyncEngram(api_key="key") as engram:
        await engram.pdf.parse_prepared(b"%PDF", on_progress=progress)
    assert events == [
        "prepare:started", "prepare:completed", "parse:started", "parse:completed",
    ]
