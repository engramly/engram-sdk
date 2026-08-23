# Distribution checklist

- Deploy and run `bun run test:preview` before publishing clients.
- Publish `@engramly/engram`, Python `engramly`, CLI `engramly`, then `@engramly/mcp-server`.
- Verify `npx -y @engramly/mcp-server` using the stdio `tools/list` smoke test.
- Submit `distribution/mcp-server.json` to the official MCP registry, then add Smithery, Glama, PulseMCP, and mcp.so listings using the same package metadata.
- Distribute `skills/engramly-pdf` as the canonical Agent Skill and use `adapters/` for host-specific configuration examples.
- Open LangChain and LlamaIndex integration PRs only after the Python package version containing `EngramPDFLoader` and `EngramPDFReader` is available on PyPI.
