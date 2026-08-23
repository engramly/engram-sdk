"""LangChain document loader for Engram.

Lazy import keeps langchain optional.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from typing import Optional

from engramly.client import Engram
from engramly.pdf import PdfClient, Source


def _import_document():
    try:
        from langchain_core.documents import Document
    except ImportError as e:
        raise ImportError(
            "langchain-core is required. Install with: pip install 'engramly[langchain]'"
        ) from e
    return Document


class EngramLoader:
    """Load web pages as clean Markdown LangChain Documents.

    Each page becomes one Document. `page_content` is the clean markdown;
    `metadata` carries url, title, tokens_saved, noise_ratio.
    """

    def __init__(
        self,
        urls: Iterable[str],
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        render: bool = True,
    ) -> None:
        self.urls = list(urls)
        self.render = render
        self._client = Engram(api_key=api_key, base_url=base_url)

    def lazy_load(self) -> Iterator:
        Document = _import_document()
        for url in self.urls:
            result = self._client.parse(url, render=self.render)
            yield Document(
                page_content=result.markdown,
                metadata={
                    "source": url,
                    "title": result.page_title,
                    "tokens_saved": result.stats.tokens_saved,
                    "noise_ratio": result.stats.noise_ratio,
                },
            )

    def load(self) -> list:
        return list(self.lazy_load())

class EngramPDFLoader:
    """Load a PDF as one LangChain Document per original PDF page."""
    def __init__(self, source: Source, *, api_key: Optional[str] = None, base_url: Optional[str] = None, pages: Optional[str] = None) -> None:
        from engramly.client import _resolve
        key, url = _resolve(api_key, base_url)
        self.source = source
        self.pages = pages
        self._client = PdfClient(key, url)

    def lazy_load(self) -> Iterator:
        Document = _import_document()
        result = self._client.parse(self.source, pages=self.pages)
        for page in result.page_markdown:
            yield Document(page_content=page.markdown, metadata={"source": str(self.source), "document_id": result.document_id, "page": page.page, "pages": result.pages})

    def load(self) -> list:
        return list(self.lazy_load())
