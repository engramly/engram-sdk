# Engramly Parse MCP Server

Run with `npx -y @engramly/mcp-server` and set `ENGRAMLY_API_KEY`. Exposes `inspect_pdf`, `read_pdf`, and `search_pdf`.
For clients that attach an MCP progress token, `read_pdf` and `search_pdf`
emit protocol progress notifications for preparation and parsing.
