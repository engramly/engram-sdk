"""LangChain document loader for Engram.

Lazy import keeps langchain optional.
"""

from __future__ import annotations

from typing import Iterable, Iterator, Optional

from engramly.client import Engram


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
