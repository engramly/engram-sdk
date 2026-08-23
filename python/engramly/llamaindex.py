"""Optional LlamaIndex reader for Engramly PDF parsing."""
from __future__ import annotations
from typing import Optional
from engramly.client import _resolve
from engramly.pdf import PdfClient, Source

class EngramPDFReader:
    def __init__(self, *, api_key: Optional[str] = None, base_url: Optional[str] = None) -> None:
        try:
            from llama_index.core.schema import Document
        except ImportError as error:
            raise ImportError("llama-index-core is required. Install with: pip install 'engramly[llamaindex]'") from error
        key, url = _resolve(api_key, base_url)
        self._document = Document
        self._client = PdfClient(key, url)

    def load_data(self, source: Source, *, pages: Optional[str] = None) -> list:
        result = self._client.parse(source, pages=pages)
        return [self._document(text=page.markdown, metadata={"source": str(source), "document_id": result.document_id, "page": page.page, "pages": result.pages}) for page in result.page_markdown]
