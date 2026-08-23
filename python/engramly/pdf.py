from __future__ import annotations

from pathlib import Path
from typing import Optional, Union
import httpx
from engramly.types import PdfInspectResult, PdfParseResult

Source = Union[str, Path, bytes]

class PdfClient:
    def __init__(self, api_key: str, base_url: str, timeout: float = 120.0) -> None:
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._client = httpx.Client(base_url=base_url, headers=self._headers, timeout=timeout)

    def _form(self, source: Source) -> tuple[dict, Optional[dict]]:
        if isinstance(source, bytes): return {}, {"file": ("document.pdf", source, "application/pdf")}
        value = str(source)
        if value.startswith("https://"): return {"url": value}, None
        path = Path(value)
        return {}, {"file": (path.name, path.read_bytes(), "application/pdf")}

    def inspect(self, source: Source) -> PdfInspectResult:
        data, files = self._form(source)
        response = self._client.post("/v1/pdf/inspect", data=data, files=files)
        response.raise_for_status()
        return PdfInspectResult.model_validate(response.json())

    def parse(self, source: Source, *, pages: Optional[str] = None, figures: bool = False, dpi: int = 200) -> PdfParseResult:
        data, files = self._form(source)
        data.update({"figures": str(figures).lower(), "dpi": str(dpi)})
        if pages: data["pages"] = pages
        response = self._client.post("/v1/pdf/parse", data=data, files=files)
        response.raise_for_status()
        return PdfParseResult.model_validate(response.json())
