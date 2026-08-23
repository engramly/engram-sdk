"""Async client tests."""

import httpx
import respx

from engramly import AsyncEngram

BASE = "https://api.engramly.net"

SAMPLE = {
    "markdown": "# Async",
    "primary": [],
    "secondary": [],
    "annotations": {},
    "stats": {"noise_ratio": 0.1, "tokens_saved": 100, "node_count": 5, "latency_ms": 50},
}


@respx.mock
async def test_async_parse():
    respx.post(f"{BASE}/v1/parse").mock(return_value=httpx.Response(200, json=SAMPLE))
    async with AsyncEngram(api_key="sk-test") as engram:
        result = await engram.parse("https://example.com")
    assert result.markdown == "# Async"


@respx.mock
async def test_async_parse_html():
    respx.post(f"{BASE}/v1/parse-html").mock(return_value=httpx.Response(200, json=SAMPLE))
    async with AsyncEngram(api_key="sk-test") as engram:
        result = await engram.parse_html("<p>hi</p>")
    assert result.stats.tokens_saved == 100
