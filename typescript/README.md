# @engramly/engram

Official TypeScript SDK for Engramly Parse's high-fidelity PDF API.

Runs anywhere `fetch` works: Node 18+, Bun, Deno, Cloudflare Workers, Vercel Edge.

## Install

```bash
npm install @engramly/engram
# or
bun add @engramly/engram
```

## Quickstart

```ts
import { Engram } from "@engramly/engram"

const engram = new Engram({ apiKey: process.env.ENGRAMLY_API_KEY })
const pdf = new Uint8Array(await Bun.file("report.pdf").arrayBuffer())
const job = await engram.pdf.parsePrepared(pdf)

console.log(job.result.markdown)
```

## Parse a PDF with predictive prewarm

Use `parsePrepared` for full-document production work. On current gateways its
single preparation request inspects the real page count, checks the cache, and
acknowledges scheduler prewarm before parsing. Older gateways automatically use
the compatible `inspect → preflight` fallback. Plain `pdf.parse`
remains the one-upload low-overhead path for warm capacity and page ranges;
prepared parsing rejects page ranges because Vast currently accepts only whole documents.
If an older deployed gateway has no preflight route, the SDK safely proceeds
without predictive prewarm; it never retries a parse that may already be
running on a billable GPU.

```ts
const job = await engram.pdf.parsePrepared(pdfBytes)
console.log(job.preflight.workers, job.preflight.target, job.result.request.origin)
console.log(job.result.request.timings) // scale, admit, vast/modal, total
```

Long cold starts can be shown as explicit preparation and parse phases:

```ts
const job = await engram.pdf.parsePrepared(pdfBytes, {
  onProgress: event => {
    console.log(event.phase, event.state, event.pages, event.elapsedMs)
  },
})
```

Completion events include known page count, worker capacity, and sanitized
request telemetry. Observer errors are isolated from the parse.
During a true-cold Modal allocation, current gateways return an opaque
preparation token and the SDK polls short status requests adaptively: every
500 ms during the latency-sensitive first 30 seconds, then with a bounded
backoff during longer provider allocation.
This avoids holding one Cloudflare origin request past its timeout; `waiting`
progress events provide heartbeats to CLI and MCP clients.

Repeated inspection metadata is content-addressed at the edge. Check
`job.inspect.request.inspectCache` for `"hit"` or `"miss"`; this is separate
from the full parse-result cache in `request.cache`.

`workers` is the live runtime-probed Vast capacity; `target` is the desired
replica count. A target above the ready count means capacity is still booting
and the gateway keeps the Modal fallback warm.
`job.preflight.supported` is `false` when a legacy gateway has no preparation
route; zero workers on a supported preflight instead means Modal was warmed.

The hosted API accepts public HTTPS PDF URLs, but does not expose general
webpage/HTML parsing or web-parser SSE.
The legacy `parse`, `parseHtml`, and `parseStream` methods are experimental and
are not part of the supported production release surface.

## Config

```ts
new Engram({
  apiKey: "unkey_...",         // or ENGRAMLY_API_KEY
  baseUrl: "https://api.engramly.net", // or ENGRAMLY_BASE_URL
  timeout: 60_000,
  pdfTimeout: 15 * 60_000,   // includes GPU cold-start
  fetch: customFetch,          // optional override
})
```

## Errors

```ts
import { APIError, EngramError, AuthError, RateLimitError } from "@engramly/engram"

try {
  await engram.pdf.parsePrepared(pdfBytes)
} catch (e) {
  if (e instanceof RateLimitError) console.log("retry after", e.retryAfter)
  else if (e instanceof AuthError) console.log("bad key")
  else if (e instanceof APIError) {
    console.log(e.phase, e.request?.requestId, e.request?.timings)
    console.log(e.prepared?.inspect.pages, e.prepared?.preflight.target)
  }
  else if (e instanceof EngramError) console.log(e.code, e.message)
}
```

PDF `APIError`s expose `phase` (`inspect`, `preflight`, or `parse`) and the
failed response's sanitized `request` telemetry. If a prepared parse fails,
`prepared` retains its successful inspection and preflight. This is diagnostic
state only; a `524` parse remains ambiguous and is never automatically retried.

## AbortSignal

```ts
const ac = new AbortController()
setTimeout(() => ac.abort(), 5_000)
await engram.pdf.parsePrepared(pdfBytes, { signal: ac.signal })
```

## Development

```bash
bun install
bun test
bun run build
```

## License

MIT
