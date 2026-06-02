"""Basic usage: parse a URL, print clean markdown.

Run:
    ENGRAM_API_KEY=sk-... python examples/basic.py
"""

from engramly import Engram


def main() -> None:
    engram = Engram()
    result = engram.parse("https://en.wikipedia.org/wiki/Engram_(neuropsychology)")
    print(result.markdown)
    print()
    print(f"--- saved {result.stats.tokens_saved} tokens "
          f"({result.stats.noise_ratio:.0%} noise) ---")


if __name__ == "__main__":
    main()
