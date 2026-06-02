/**
 * Basic usage.
 *
 * Run with:
 *   ENGRAM_API_KEY=sk-... bun run examples/basic.ts
 */

import { Engram } from "../src"

const engram = new Engram()
const result = await engram.parse(
  "https://en.wikipedia.org/wiki/Engram_(neuropsychology)",
)

console.log(result.markdown)
console.log()
console.log(
  `--- saved ${result.stats.tokensSaved} tokens ` +
    `(${Math.round(result.stats.noiseRatio * 100)}% noise) ---`,
)
