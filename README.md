# Engram SDK

[![Python CI](https://github.com/engramly/engram-sdk/actions/workflows/python.yml/badge.svg)](https://github.com/engramly/engram-sdk/actions/workflows/python.yml)
[![TypeScript CI](https://github.com/engramly/engram-sdk/actions/workflows/typescript.yml/badge.svg)](https://github.com/engramly/engram-sdk/actions/workflows/typescript.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Official SDKs for [Engram](https://github.com/engramly/engram) — flawless memory engrams from any web page.

Engram turns messy web pages into clean Markdown with primary/secondary classification, perfectly preserved tables, math, and code blocks. Save up to 50% of your LLM token costs.

```
┌──────────────────────────────────────────────┐
│  URL or HTML                                  │
│         │                                     │
│         ▼                                     │
│  Engram API                                   │
│         │                                     │
│         ▼                                     │
│  { markdown, primary, secondary,              │
│    annotations, stats: { tokensSaved } }     │
└──────────────────────────────────────────────┘
```

## SDKs

| Language   | Package              | Status | Docs                       |
|------------|----------------------|--------|----------------------------|
| Python     | `engramly`           | alpha  | [python/](./python)        |
| TypeScript | `@engramly/engram`   | alpha  | [typescript/](./typescript)|

## Quickstart

### Python

```bash
pip install engramly
```

```python
from engramly import Engram

engram = Engram(api_key="sk-...")
result = engram.parse("https://example.com/article")

print(result.markdown)
print(f"saved {result.stats.tokens_saved} tokens ({result.stats.noise_ratio:.0%} noise)")
```

### TypeScript

```bash
npm install @engramly/engram
# or
bun add @engramly/engram
```

```ts
import { Engram } from "@engramly/engram"

const engram = new Engram({ apiKey: process.env.ENGRAM_API_KEY })
const result = await engram.parse("https://example.com/article")

console.log(result.markdown)
console.log(`saved ${result.stats.tokensSaved} tokens`)
```

## Why Engram?

| Tool                | Markdown | Primary/Secondary | Tables | Math | Code | Tokens saved |
|---------------------|----------|-------------------|--------|------|------|--------------|
| Raw HTML to LLM     | —        | —                 | —      | —    | —    | 0%           |
| Readability.js      | ✓        | partial           | partial| —    | —    | ~30%         |
| **Engram**          | ✓        | **✓**             | **✓**  | **✓**| **✓**| **up to 50%**|

## API

The hosted API lives at `https://api.engramly.com` (placeholder during alpha). See [`openapi.yaml`](./openapi.yaml) for the full schema.

Two endpoints power both SDKs:

- `POST /v1/parse`       — engram fetches and parses a URL server-side
- `POST /v1/parse-html`  — you supply HTML; engram parses it

Both support streaming via Server-Sent Events.

## Integrations

- **LangChain** (Python) — `from engramly.langchain import EngramLoader`

More coming — open an issue if you want a specific framework.

## Development

This is a multi-language monorepo. See per-package READMEs:

- [python/README.md](./python/README.md)
- [typescript/README.md](./typescript/README.md)

The OpenAPI spec in [`openapi.yaml`](./openapi.yaml) is the source of truth for both SDKs.

## License

MIT — see [LICENSE](./LICENSE).
