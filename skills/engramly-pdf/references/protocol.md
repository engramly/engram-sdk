# Engramly PDF protocol

- `source` accepts an absolute local path, an HTTPS URL, or a returned 64-character cache id.
- `pages` uses one-based ranges such as `1-5,8,11-15`; duplicates are removed and pages are sorted.
- `inspect_pdf` returns `cacheId`, `pages`, PDF metadata, and embedded outline data when present. An empty outline is valid.
- `read_pdf` returns page-marked Markdown, a `cacheId`, and `nextCursor` when its bounded response has more content.
- `search_pdf` returns at most eight page-numbered excerpts from parsed Markdown. It is lexical search, not semantic retrieval.

If a document is encrypted, ask for an unlocked copy. For invalid ranges, inspect the page count and retry with a valid range. For quota or rate-limit errors, report the service error without retrying repeatedly. Never print, persist in a repository, or echo an API key.
