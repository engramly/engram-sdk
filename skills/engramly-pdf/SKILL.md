---
name: engramly-pdf
description: Read, search, or extract complex local and remote PDFs with page-aware Markdown while keeping agent context small. Use for papers, financial reports, datasheets, tables, formulas, and multi-column documents.
---

# Engramly PDF

Use the Engramly MCP tools for PDF content. Do not load PDF bytes directly into context.

1. Call `inspect_pdf` before reading an unfamiliar document, especially when it may exceed 30 pages.
2. Choose the smallest relevant page range from the outline or user request.
3. Use `search_pdf` to locate facts when the relevant pages are unknown.
4. Use `read_pdf` for the selected pages. If it returns `nextCursor`, continue only when the remaining text is needed.
5. Cite original one-based PDF page numbers from tool results.
6. Export the full document only when the user explicitly requests an artifact; use `engram pdf parse --output` rather than placing the full Markdown in chat.

For input forms, page ranges, response fields, and recovery behavior, read [references/protocol.md](references/protocol.md).
