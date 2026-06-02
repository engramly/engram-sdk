# Contributing to engram-sdk

Thanks for helping shape the SDK! A few conventions:

## Repo layout

```
engram-sdk/
├── openapi.yaml       # Source of truth for both SDKs — keep schemas in sync
├── python/            # `engramly` (pip)
├── typescript/        # `@engramly/engram` (npm)
└── .github/workflows/ # Per-language CI
```

When you change a request/response shape, update `openapi.yaml` first, then both SDKs.

## Python

```bash
cd python
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,langchain]"
pytest
ruff check .
```

## TypeScript

```bash
cd typescript
bun install
bun test
bun run build
```

## Style

- Python: ruff defaults, type hints required on public API
- TypeScript: strict mode on, no `any` in public API
- Both: snake_case on the wire, snake_case in Python, camelCase in TS

## Tests

Mock the HTTP layer — never hit the live API in CI.

## Commits

Conventional commits welcome but not required.
