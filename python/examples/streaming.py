"""Streaming: print markdown as it arrives."""

import sys
from engramly import Engram


def main() -> None:
    engram = Engram()
    for event in engram.parse_stream("https://en.wikipedia.org/wiki/Memory"):
        if event.type == "markdown_chunk":
            sys.stdout.write(str(event.data))
            sys.stdout.flush()
        elif event.type == "done":
            print()
            break


if __name__ == "__main__":
    main()
