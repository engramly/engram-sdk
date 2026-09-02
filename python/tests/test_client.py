"""Basic client tests using respx to mock httpx."""

import httpx
import pytest
import respx

from engramly import AuthError, Engram, EngramError, RateLimitError

BASE = "https://api.engramly.net"
WEB = "http://localhost:7842"

SAMPLE = {
    "markdown": "# Hello\n\nWorld.",
    "primary": [3, 4],
    "secondary": [2, 6],
    "annotations": {"5": "table"},
    "stats": {"noise_ratio": 0.4, "tokens_saved": 1200, "node_count": 12, "latency_ms": 800},
    "page_title": "Hello",
    "url": "https://example.com",
}


def test_requires_api_key(monkeypatch):
    monkeypatch.delenv("ENGRAM_API_KEY", raising=False)
    monkeypatch.delenv("ENGRAMLY_API_KEY", raising=False)
    with pytest.raises(EngramError):
        Engram()


def test_fails_fast_for_unsupported_hosted_web_parsing():
    with Engram(api_key="key") as engram:
        with pytest.raises(EngramError) as caught:
            engram.parse("https://example.com")
        assert caught.value.code == "unsupported_hosted_operation"
        with pytest.raises(EngramError):
            engram.parse_html("<p>x</p>")


@respx.mock
def test_parse_url():
    respx.post(f"{WEB}/v1/parse").mock(return_value=httpx.Response(200, json=SAMPLE))
    with Engram(api_key="sk-test", base_url=WEB) as engram:
        result = engram.parse("https://example.com")
    assert result.markdown.startswith("# Hello")
    assert result.stats.tokens_saved == 1200
    assert result.primary == [3, 4]


@respx.mock
def test_parse_html():
    respx.post(f"{WEB}/v1/parse-html").mock(return_value=httpx.Response(200, json=SAMPLE))
    with Engram(api_key="sk-test", base_url=WEB) as engram:
        result = engram.parse_html("<html></html>", url="https://example.com")
    assert result.page_title == "Hello"


@respx.mock
def test_auth_error():
    respx.post(f"{WEB}/v1/parse").mock(
        return_value=httpx.Response(401, json={"error": {"code": "auth", "message": "bad key"}})
    )
    with Engram(api_key="sk-bad", base_url=WEB) as engram, pytest.raises(AuthError):
        engram.parse("https://example.com")


@respx.mock
def test_rate_limit():
    respx.post(f"{WEB}/v1/parse").mock(
        return_value=httpx.Response(
            429,
            headers={"retry-after": "5"},
            json={"error": {"code": "rate_limited", "message": "slow down"}},
        )
    )
    with Engram(api_key="sk-test", base_url=WEB) as engram, pytest.raises(RateLimitError) as exc:
        engram.parse("https://example.com")
    assert exc.value.retry_after == 5.0


@respx.mock
def test_base_url_override():
    respx.post("http://localhost:7842/v1/parse").mock(
        return_value=httpx.Response(200, json=SAMPLE)
    )
    with Engram(api_key="sk-test", base_url="http://localhost:7842") as engram:
        result = engram.parse("https://example.com")
    assert result.stats.node_count == 12


@respx.mock
def test_pdf_prepared_flow_supplies_pages_and_exposes_telemetry():
    inspect = respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, json={
        "document_id": "abc", "pages": 42, "outline_source": "none", "outline": [],
    }))
    preflight = respx.post(f"{BASE}/v1/pdf/preflight").mock(return_value=httpx.Response(200, json={
        "cache": "miss", "workers": 2, "target": 3,
    }))
    respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(200, headers={
        "server-timing": "scale;dur=5, admit;dur=10, vast;dur=50",
        "x-engram-origin": "vast", "x-engram-workers": "2",
    }, json={"markdown": "ok", "pages": 42, "page_markdown": []}))
    with Engram(api_key="key") as engram:
        result = engram.pdf.parse_prepared(b"%PDF")
    assert inspect.called and preflight.called
    assert preflight.calls[0].request.content and b'"pages":42' in preflight.calls[0].request.content
    assert b'name="prewarmed"' in respx.calls[2].request.content
    assert b'name="prepared_origin"' in respx.calls[2].request.content
    assert b"vast" in respx.calls[2].request.content
    assert b'name="page_count"' in respx.calls[2].request.content
    assert b"42" in respx.calls[2].request.content
    assert result.result.request.origin == "vast"
    assert result.result.request.workers == 2
    assert result.result.request.timings["vast"] == 50
    assert result.preflight.target == 3


@respx.mock
def test_pdf_prepared_flow_uses_one_preparation_request_when_supported():
    inspect = respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, headers={
        "x-engram-prepared": "1", "x-engram-workers": "2",
        "x-engram-worker-target": "3",
        "x-engram-cache": "miss", "x-engram-inspect-cache": "hit",
        "x-engram-origin": "edge",
    }, json={
        "document_id": "abc", "pages": 42, "outline_source": "none", "outline": [],
    }))
    preflight = respx.post(f"{BASE}/v1/pdf/preflight").mock(return_value=httpx.Response(500))
    respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(200, json={
        "markdown": "ok", "pages": 42, "page_markdown": [],
    }))
    with Engram(api_key="key") as engram:
        result = engram.pdf.parse_prepared(b"%PDF")
    assert inspect.called
    assert not preflight.called
    assert result.inspect.prepared is True
    assert result.elapsed_ms >= 0
    assert result.inspect.request.inspect_cache == "hit"
    assert result.preflight.workers == 2
    assert result.preflight.target == 3


@respx.mock
def test_pdf_polls_asynchronous_preparation_before_parse():
    inspect = respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, headers={
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
    with Engram(api_key="key") as engram:
        result = engram.pdf.parse_prepared(b"%PDF")
    assert inspect.calls[0].request.headers["x-engram-async-prepare"] == "1"
    assert status.calls[0].request.content == b'{"token":"opaque-token"}'
    assert status.called and parse.called
    assert b'name="prewarmed"' in parse.calls[0].request.content
    assert b'name="prepared_origin"' in parse.calls[0].request.content
    assert b"modal" in parse.calls[0].request.content
    assert result.preflight.workers == 0
    assert result.inspect.prepared is True
    assert result.elapsed_ms >= 0


@respx.mock
def test_pdf_polls_pending_preparation_and_retains_status_telemetry(monkeypatch):
    respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, headers={
        "x-engram-prepared": "0", "x-engram-prepare-token": "opaque-token",
        "x-engram-worker-target": "1",
    }, json={
        "document_id": "abc", "pages": 2, "outline_source": "none", "outline": [],
    }))
    status = respx.post(f"{BASE}/v1/pdf/prepare/status").mock(side_effect=[
        httpx.Response(202, json={"state": "pending"}),
        httpx.Response(200, headers={
            "x-engram-origin": "modal", "server-timing": "total;dur=3",
        }, json={"state": "ready"}),
    ])
    respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(200, json={
        "markdown": "ok", "pages": 2, "page_markdown": [],
    }))
    monkeypatch.setattr("engramly.pdf.time.sleep", lambda _seconds: None)
    events = []
    with Engram(api_key="key") as engram:
        result = engram.pdf.parse_prepared(
            b"%PDF", on_progress=lambda event: events.append((event.phase, event.state)),
        )
    assert status.call_count == 2
    assert ("prepare", "waiting") in events
    assert result.preflight.request.origin == "modal"
    assert result.preflight.request.timings["total"] == 3
    assert result.preflight.target == 1


@respx.mock
def test_pdf_preparation_failure_does_not_submit_parse():
    respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, headers={
        "x-engram-prepared": "0", "x-engram-prepare-token": "opaque-token",
    }, json={
        "document_id": "abc", "pages": 2, "outline_source": "none", "outline": [],
    }))
    respx.post(f"{BASE}/v1/pdf/prepare/status").mock(return_value=httpx.Response(502, headers={
        "x-engram-origin": "modal",
    }, json={"state": "failed"}))
    parse = respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(200))
    with Engram(api_key="key") as engram, pytest.raises(Exception) as caught:
        engram.pdf.parse_prepared(b"%PDF")
    assert caught.value.phase == "preflight"
    assert caught.value.request.origin == "modal"
    assert not parse.called


@respx.mock
def test_pdf_prepared_flow_degrades_when_legacy_gateway_lacks_preflight():
    respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, json={
        "document_id": "abc", "pages": 2, "outline_source": "none", "outline": [],
    }))
    preflight = respx.post(f"{BASE}/v1/pdf/preflight").mock(return_value=httpx.Response(
        404, json={"error": "not_found"},
    ))
    parse = respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(200, json={
        "markdown": "ok", "pages": 2, "page_markdown": [],
    }))
    with Engram(api_key="key") as engram:
        result = engram.pdf.parse_prepared(b"%PDF")
    assert preflight.called and parse.called
    assert result.preflight.workers == 0
    assert result.preflight.supported is False
    assert b'name="prewarmed"' not in parse.calls[0].request.content
    assert b'name="prepared_origin"' not in parse.calls[0].request.content
    assert result.result.markdown == "ok"


@respx.mock
def test_pdf_uses_sdk_error_contract():
    respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(402, json={
        "error": "quota_exceeded", "detail": "upgrade",
    }))
    with Engram(api_key="key") as engram, pytest.raises(Exception) as error:
        engram.pdf.parse(b"%PDF")
    assert error.value.code == "quota_exceeded"
    assert str(error.value) == "upgrade"


@respx.mock
def test_pdf_origin_timeout_is_actionable_and_not_retried():
    route = respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(524))
    with Engram(api_key="key") as engram, pytest.raises(Exception) as error:
        engram.pdf.parse(b"%PDF")
    assert "not retried" in str(error.value)
    assert route.call_count == 1


@respx.mock
def test_prepared_parse_retains_preparation_and_failed_response_telemetry():
    respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, headers={
        "x-engram-prepared": "1", "x-engram-workers": "0",
        "x-engram-worker-target": "1", "x-engram-request-id": "prepare-1",
    }, json={
        "document_id": "abc", "pages": 3, "outline_source": "none", "outline": [],
    }))
    respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(524, headers={
        "x-engram-origin": "modal", "x-engram-request-id": "parse-1",
        "server-timing": "modal;dur=140000, total;dur=144000",
    }))
    with Engram(api_key="key") as engram, pytest.raises(Exception) as caught:
        engram.pdf.parse_prepared(b"%PDF")
    error = caught.value
    assert error.phase == "parse"
    assert error.prepared.inspect.pages == 3
    assert error.prepared.preflight.target == 1
    assert error.request.origin == "modal"
    assert error.request.timings["modal"] == 140000


@respx.mock
def test_prepared_parse_reports_lifecycle_and_ignores_observer_failure():
    respx.post(f"{BASE}/v1/pdf/inspect").mock(return_value=httpx.Response(200, headers={
        "x-engram-prepared": "1", "x-engram-worker-target": "1",
    }, json={
        "document_id": "abc", "pages": 3, "outline_source": "none", "outline": [],
    }))
    respx.post(f"{BASE}/v1/pdf/parse").mock(return_value=httpx.Response(200, json={
        "markdown": "ok", "pages": 3, "page_markdown": [],
    }))
    events = []

    def progress(event):
        events.append((event.phase, event.state, event.pages))
        if event.state == "started":
            raise RuntimeError("observer failure")

    with Engram(api_key="key") as engram:
        result = engram.pdf.parse_prepared(b"%PDF", on_progress=progress)
    assert result.result.markdown == "ok"
    assert events == [
        ("prepare", "started", None), ("prepare", "completed", 3),
        ("parse", "started", 3), ("parse", "completed", 3),
    ]


def test_pdf_shares_default_pool_and_closes_with_parent():
    engram = Engram(api_key="key")
    assert engram.pdf._client is engram._client
    engram.close()
    assert engram._client.is_closed


def test_opt_in_web_retries_never_replay_pdf_posts():
    engram = Engram(api_key="key", max_retries=2)
    assert engram.pdf._client is not engram._client
    assert engram._client._transport._pool._retries == 2
    assert engram.pdf._client._transport._pool._retries == 0
    engram.close()
    assert engram.pdf._client.is_closed


def test_prepared_parse_rejects_selected_pages_before_network():
    with Engram(api_key="key") as engram, pytest.raises(ValueError, match="complete documents only"):
        engram.pdf.parse_prepared(b"%PDF", pages="1")
