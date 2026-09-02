# Engram SDK

[![Python CI](https://github.com/engramly/engram-sdk/actions/workflows/python.yml/badge.svg)](https://github.com/engramly/engram-sdk/actions/workflows/python.yml)
[![TypeScript CI](https://github.com/engramly/engram-sdk/actions/workflows/typescript.yml/badge.svg)](https://github.com/engramly/engram-sdk/actions/workflows/typescript.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Official SDKs for Engramly Parse's high-fidelity PDF-to-Markdown API.

```
┌──────────────────────────────────────────────┐
│  PDF                                          │
│         │                                     │
│         ▼                                     │
│  Engram API                                   │
│         │                                     │
│         ▼                                     │
│  { markdown, pages, page_markdown, metadata } │
└──────────────────────────────────────────────┘
```

## SDKs

| Language   | Package              | Status | Docs                       |
|------------|----------------------|--------|----------------------------|
| Python     | `engramly`           | alpha  | [python/](./python)        |
| TypeScript | `@engramly/engram`   | alpha  | [typescript/](./typescript)|
| CLI        | `engramly`           | alpha  | [packages/cli/](./packages/cli) |
| MCP        | `@engramly/mcp-server` | alpha | [packages/mcp-server/](./packages/mcp-server) |

## Quickstart

### Python

```bash
pip install engramly
```

```python
from pathlib import Path
from engramly import Engram

engram = Engram(api_key="unkey_...")
job = engram.pdf.parse_prepared(Path("report.pdf").read_bytes())

print(job.result.markdown)
```

### TypeScript

```bash
npm install @engramly/engram
# or
bun add @engramly/engram
```

```ts
import { Engram } from "@engramly/engram"

const engram = new Engram({ apiKey: process.env.ENGRAMLY_API_KEY })
const pdf = new Uint8Array(await Bun.file("report.pdf").arrayBuffer())
const job = await engram.pdf.parsePrepared(pdf)

console.log(job.result.markdown)
```

## Why Engram?

| Tool                | Markdown | Primary/Secondary | Tables | Math | Code | Tokens saved |
|---------------------|----------|-------------------|--------|------|------|--------------|
| Raw HTML to LLM     | —        | —                 | —      | —    | —    | 0%           |
| Readability.js      | ✓        | partial           | partial| —    | —    | ~30%         |
| **Engram**          | ✓        | **✓**             | **✓**  | **✓**| **✓**| **up to 50%**|

## API

The hosted API lives at `https://api.engramly.net`. See [`openapi.yaml`](./openapi.yaml) for the full schema.

The primary endpoints are:

- `POST /v1/pdf/inspect` — inspect page count and outline without OCR
- `POST /v1/pdf/preflight` — check cache and acknowledge predictive prewarm
- `POST /v1/pdf/parse` — parse a PDF into page-aware Markdown
- `POST /v1/pdf/prepare/status` — poll asynchronous cold-start readiness

The hosted API accepts uploaded PDFs and public HTTPS URLs that resolve to PDF
files. It does not expose general webpage/HTML parsing; those legacy SDK
methods remain experimental and are not part of this release contract.

## Integrations

- **LangChain** (Python) — `from engramly.langchain import EngramPDFLoader`
- **CLI and MCP** — scheduler-aware PDF parsing with cold-start progress

More coming — open an issue if you want a specific framework.

## Development

This is a multi-language monorepo. See per-package READMEs:

- [python/README.md](./python/README.md)
- [typescript/README.md](./typescript/README.md)

The OpenAPI spec in [`openapi.yaml`](./openapi.yaml) is the source of truth for both SDKs.

## License

MIT — see [LICENSE](./LICENSE).
