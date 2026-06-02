/** Streaming markdown to stdout. */

import { Engram } from "../src"

const engram = new Engram()
for await (const event of engram.parseStream("https://en.wikipedia.org/wiki/Memory")) {
  if (event.type === "markdown_chunk") process.stdout.write(String(event.data))
  if (event.type === "done") {
    console.log()
    break
  }
}
