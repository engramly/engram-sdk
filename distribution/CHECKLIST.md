# Distribution checklist

- Deploy and run `bun run test:preview` before publishing clients.
- Diff the OpenAPI paths against the deployed gateway router and probe every
  documented public route. Do not advertise legacy URL/HTML methods unless the
  hosted gateway serves them.
- Require authenticated `POST /v1/pdf/preflight` to return something other
  than `404`, then run the scheduler benchmark with at least one unique and one
  cache request. Zero failures are required; a `524` blocks release.
- Do not release the PDF skill until the production scheduler benchmark has
  successful cold/warm/cache samples, the Vast preflight is fully green, and
  multi-worker routing plus scale-down cost have been observed live.
- Run the benchmark with `--release-gate`, explicit latency/cost ceilings,
  `--require-vast`, `--require-scale-down`, and `--min-peak-workers 2`; require
  `gate.passed: true` and `cost.peakReadyWorkers >= 2` in the saved report.
- Publish `@engramly/engram`, Python `engramly`, CLI `engramly`, then `@engramly/mcp-server`.
- Verify `npx -y @engramly/mcp-server` using the stdio `tools/list` smoke test.
- Submit `distribution/mcp-server.json` to the official MCP registry, then add Smithery, Glama, PulseMCP, and mcp.so listings using the same package metadata.
- Distribute `skills/engramly-pdf` as the canonical Agent Skill and use `adapters/` for host-specific configuration examples.
- Open LangChain and LlamaIndex integration PRs only after the Python package version containing `EngramPDFLoader` and `EngramPDFReader` is available on PyPI.
