import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Engram, PdfInspectResult, PdfParseResult } from "@engramly/engram"
import { pages, PdfAgent } from "../src"

const roots: string[] = []
afterEach(async () => {
  delete process.env.ENGRAMLY_CACHE_DIR
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function result(): PdfParseResult {
  return { markdown: "ok", pageMarkdown: [], pages: 7, elapsed: 1, metadata: {}, request: { elapsedMs: 1, timings: {} } }
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "engram-agent-"))
  roots.push(root)
  process.env.ENGRAMLY_CACHE_DIR = join(root, "cache")
  const path = join(root, "sample.pdf")
  await writeFile(path, "%PDF-test")
  return path
}

describe("page ranges", () => {
  test("normalizes, sorts, and deduplicates", () => expect(pages("8,1-3,2", 10)).toEqual([1, 2, 3, 8]))
  test("rejects invalid and out-of-bounds ranges", () => { expect(() => pages("3-1", 10)).toThrow(); expect(() => pages("11", 10)).toThrow() })
})

describe("scheduler-aware PDF parsing", () => {
  test("keeps cached-inspection parses in the atomic prepared flow", async () => {
    const path = await fixture()
    const calls: Array<[string, unknown]> = []
    const inspect = { documentId: "doc", filename: null, pages: 7, title: null, author: null, encrypted: false, outlineSource: "none", outline: [], prepared: true, request: { elapsedMs: 1, timings: {} } } satisfies PdfInspectResult
    const api = { pdf: {
      inspect: async () => { calls.push(["inspect", null]); return inspect },
      parsePrepared: async (_source: unknown, options?: unknown) => { calls.push(["prepared", options]); return { inspect, preflight: { cache: "miss" as const, workers: 1, target: 1, supported: true, request: { elapsedMs: 1, timings: {} } }, result: result() } },
    } } as unknown as Engram
    const agent = new PdfAgent(api)
    await agent.inspect(path)
    calls.length = 0
    await agent.parse(path)
    expect(calls).toEqual([["prepared", {}]])
  })

  test("forwards progress observers to the SDK", async () => {
    const path = await fixture()
    const observer = () => {}
    const calls: unknown[] = []
    const inspect = { documentId: "doc", filename: null, pages: 1, title: null, author: null, encrypted: false, outlineSource: "none", outline: [], prepared: true, request: { elapsedMs: 1, timings: {} } } satisfies PdfInspectResult
    const api = { pdf: {
      parsePrepared: async (_source: unknown, options?: unknown) => { calls.push(options); return { inspect, preflight: { cache: "miss" as const, workers: 0, target: 0, supported: true, request: inspect.request }, result: result() } },
    } } as unknown as Engram
    await new PdfAgent(api).parse(path, undefined, { onProgress: observer })
    expect(calls).toEqual([{ onProgress: observer }])
  })

  test("keeps selected-page parsing on the direct route", async () => {
    const path = await fixture()
    const calls: string[] = []
    const api = { pdf: {
      parse: async (_source: unknown, options?: unknown) => { calls.push(JSON.stringify(options)); return result() },
      parsePrepared: async () => { throw new Error("should not prepare") },
    } } as unknown as Engram
    await new PdfAgent(api).parse(path, "2-3")
    expect(calls).toEqual(['{"pages":"2-3"}'])
  })

  test("keeps remote PDFs on the direct route because preflight needs bytes", async () => {
    const calls: unknown[] = []
    const api = { pdf: {
      parse: async (value: unknown) => { calls.push(value); return result() },
      parsePrepared: async () => { throw new Error("should not prepare") },
    } } as unknown as Engram
    await new PdfAgent(api).parse("https://example.com/document.pdf")
    expect(calls).toEqual(["https://example.com/document.pdf"])
  })
})
