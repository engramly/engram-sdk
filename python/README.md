# engramly

Official Python SDK for Engramly Parse's high-fidelity PDF API.

## Install

```bash
pip install engramly
```

With LangChain support:

```bash
pip install "engramly[langchain]"
```

## Quickstart

```python
from pathlib import Path
from engramly import Engram

engram = Engram(api_key="unkey_...")  # or set ENGRAMLY_API_KEY
job = engram.pdf.parse_prepared(Path("report.pdf").read_bytes())

print(job.result.markdown)
```

## Async

```python
import asyncio
from engramly import AsyncEngram

async def main():
    async with AsyncEngram(api_key="unkey_...") as engram:
        job = await engram.pdf.parse_prepared(Path("report.pdf").read_bytes())
        print(job.result.markdown)

asyncio.run(main())
```

## Parse a PDF with predictive prewarm

```python
job = engram.pdf.parse_prepared(pdf_bytes)
print(job.preflight.workers, job.preflight.target, job.result.request.origin)
print(job.result.request.timings)  # scale, admit, vast/modal, total
```

Long cold starts can be shown as explicit preparation and parse phases:

```python
def progress(event):
    print(event.phase, event.state, event.pages, event.elapsed_ms)

job = engram.pdf.parse_prepared(pdf_bytes, on_progress=progress)
```

The async client also accepts an async callback and awaits each update.
Completion events include known page count, worker capacity, and sanitized
request telemetry. Observer errors are isolated from the parse.
During a true-cold Modal allocation, current gateways return an opaque
preparation token and the SDK polls short status requests adaptively: every
500 ms during the latency-sensitive first 30 seconds, then with a bounded
backoff during longer provider allocation.
This avoids holding one Cloudflare origin request past its timeout; `waiting`
progress events provide heartbeats to CLI and MCP clients.

Repeated inspection metadata is content-addressed at the edge. Check
`job.inspect.request.inspect_cache` for `"hit"` or `"miss"`; this is separate
from the full parse-result cache in `request.cache`.

`workers` is the live runtime-probed Vast capacity; `target` is the desired
replica count. A target above the ready count means capacity is still booting
and the gateway keeps the Modal fallback warm.
Current gateways poll Modal and Vast readiness concurrently; the first ready
provider wins without submitting inference during the race. Both sync and async
clients preserve that provider's origin and worker count and then submit the PDF
exactly once.
`job.preflight.supported` is false when a legacy gateway has no preparation
route; zero workers on a supported preflight instead means Modal was warmed.

`parse_prepared` uses one preparation request on current gateways to inspect the
real page count, check the cache, and acknowledge scheduler prewarm, then parses
the complete document. Older gateways automatically use the compatible
`inspect → preflight` fallback. Use `pdf.parse` directly for page ranges or a warm one-upload
path. `AsyncEngram.pdf` exposes the same methods asynchronously. PDF requests
default to 15 minutes because cold GPU startup can exceed the web parser's
60-second default. Parse requests are not application-retried: after admission,
a retry could duplicate paid GPU work.
If an older deployed gateway has no preflight route, prepared parsing safely
continues without predictive prewarm. A `524` explains that capacity timed out
and reiterates that no automatic retry occurred.

PDF `APIError`s expose `phase` (`inspect`, `preflight`, or `parse`) and the
failed response's sanitized `request` telemetry. If `parse_prepared` fails,
`error.prepared` retains the successful inspection and preflight, including
page count and worker target. This state is for diagnosis; ambiguous parses are
still not retried.

The hosted API accepts public HTTPS PDF URLs, but does not expose general
webpage/HTML parsing or web-parser SSE.
The legacy `parse`, `parse_html`, and `parse_stream` methods are experimental
and are not part of the supported production release surface.

## LangChain PDF loader

```python
from engramly.langchain import EngramPDFLoader

loader = EngramPDFLoader("report.pdf", api_key="unkey_...")
docs = loader.load()  # One Document per original PDF page
```

## Config

| Arg            | Env                   | Default                      |
|----------------|-----------------------|------------------------------|
| `api_key`      | `ENGRAMLY_API_KEY`    | —                            |
| `base_url`     | `ENGRAMLY_BASE_URL`   | `https://api.engramly.net`   |
| `timeout`      | —                     | `60.0`                       |
| `pdf_timeout`  | —                     | `900.0`                      |
| `max_retries`  | —                     | `0`                          |

Retries are disabled by default because a disconnected PDF parse may already
be running on a GPU. If `max_retries` is enabled for a custom web-parser
origin, PDF requests still use a separate no-retry transport.

## Errors

```python
from engramly import EngramError, AuthError, RateLimitError

try:
    engram.pdf.parse_prepared(pdf_bytes)
except AuthError:
    ...
except RateLimitError as e:
    print(e.retry_after)
except EngramError as e:
    print(e.code, e.message)
```

## Development

```bash
pip install -e ".[dev,langchain]"
pytest
ruff check .
```

## License

MIT
