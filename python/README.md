# engramly

Official Python SDK for [Engram](https://github.com/engramly/engram) — flawless memory engrams from any web page.

## Install

```bash
pip install engramly
```

With LangChain support:

```bash
pip install "engramly[langchain]"
```

## Quickstart

```python
from engramly import Engram

engram = Engram(api_key="sk-...")  # or set ENGRAM_API_KEY
result = engram.parse("https://example.com/article")

print(result.markdown)
print(result.stats.tokens_saved)
```

## Async

```python
import asyncio
from engramly import AsyncEngram

async def main():
    async with AsyncEngram(api_key="sk-...") as engram:
        result = await engram.parse("https://example.com/article")
        print(result.markdown)

asyncio.run(main())
```

## Streaming

```python
for event in engram.parse_stream("https://example.com/article"):
    if event.type == "markdown_chunk":
        print(event.data, end="", flush=True)
    elif event.type == "done":
        print()
```

## Parse HTML you already have

```python
html = "<html>...</html>"
result = engram.parse_html(html, url="https://example.com")
```

## LangChain loader

```python
from engramly.langchain import EngramLoader

loader = EngramLoader(["https://a.com", "https://b.com"], api_key="sk-...")
docs = loader.load()  # List[Document] with clean markdown
```

## Config

| Arg            | Env                   | Default                      |
|----------------|-----------------------|------------------------------|
| `api_key`      | `ENGRAM_API_KEY`      | —                            |
| `base_url`     | `ENGRAM_BASE_URL`     | `https://api.engramly.com`   |
| `timeout`      | —                     | `60.0`                       |
| `max_retries`  | —                     | `2`                          |

## Errors

```python
from engramly import EngramError, AuthError, RateLimitError

try:
    engram.parse(url)
except AuthError:
    ...
except RateLimitError as e:
    print(e.retry_after)
except EngramError as e:
    print(e.code, e.message)
```

## Development

```bash
pip install -e ".[dev,langchain]"
pytest
ruff check .
```

## License

MIT
