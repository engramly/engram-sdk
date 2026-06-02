# @engramly/engram

Official TypeScript SDK for [Engram](https://github.com/engramly/engram) — flawless memory engrams from any web page.

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

const engram = new Engram({ apiKey: process.env.ENGRAM_API_KEY })
const result = await engram.parse("https://example.com/article")

console.log(result.markdown)
console.log(`saved ${result.stats.tokensSaved} tokens`)
```

## Parse HTML you already have

```ts
const result = await engram.parseHtml(html, { url: "https://example.com" })
```

## Streaming

```ts
for await (const event of engram.parseStream("https://example.com")) {
  if (event.type === "markdown_chunk") process.stdout.write(String(event.data))
  if (event.type === "done") break
}
```

## Config

```ts
new Engram({
  apiKey: "sk-...",            // or ENGRAM_API_KEY
  baseUrl: "https://api.engramly.com", // or ENGRAM_BASE_URL
  timeout: 60_000,
  fetch: customFetch,          // optional override
})
```

## Errors

```ts
import { EngramError, AuthError, RateLimitError } from "@engramly/engram"

try {
  await engram.parse(url)
} catch (e) {
  if (e instanceof RateLimitError) console.log("retry after", e.retryAfter)
  else if (e instanceof AuthError) console.log("bad key")
  else if (e instanceof EngramError) console.log(e.code, e.message)
}
```

## AbortSignal

```ts
const ac = new AbortController()
setTimeout(() => ac.abort(), 5_000)
await engram.parse(url, { signal: ac.signal })
```

## Development

```bash
bun install
bun test
bun run build
```

## License

MIT
