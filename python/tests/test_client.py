"""Basic client tests using respx to mock httpx."""

import httpx
import pytest
import respx

from engramly import AuthError, Engram, EngramError, RateLimitError

BASE = "https://api.engramly.net"

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
    with pytest.raises(EngramError):
        Engram()


@respx.mock
def test_parse_url():
    respx.post(f"{BASE}/v1/parse").mock(return_value=httpx.Response(200, json=SAMPLE))
    with Engram(api_key="sk-test") as engram:
        result = engram.parse("https://example.com")
    assert result.markdown.startswith("# Hello")
    assert result.stats.tokens_saved == 1200
    assert result.primary == [3, 4]


@respx.mock
def test_parse_html():
    respx.post(f"{BASE}/v1/parse-html").mock(return_value=httpx.Response(200, json=SAMPLE))
    with Engram(api_key="sk-test") as engram:
        result = engram.parse_html("<html></html>", url="https://example.com")
    assert result.page_title == "Hello"


@respx.mock
def test_auth_error():
    respx.post(f"{BASE}/v1/parse").mock(
        return_value=httpx.Response(401, json={"error": {"code": "auth", "message": "bad key"}})
    )
    with Engram(api_key="sk-bad") as engram, pytest.raises(AuthError):
        engram.parse("https://example.com")


@respx.mock
def test_rate_limit():
    respx.post(f"{BASE}/v1/parse").mock(
        return_value=httpx.Response(
            429,
            headers={"retry-after": "5"},
            json={"error": {"code": "rate_limited", "message": "slow down"}},
        )
    )
    with Engram(api_key="sk-test") as engram, pytest.raises(RateLimitError) as exc:
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
