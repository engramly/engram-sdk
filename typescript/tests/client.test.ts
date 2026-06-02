import { describe, expect, test } from "bun:test"
import { AuthError, Engram, EngramError, RateLimitError } from "../src"

const SAMPLE = {
  markdown: "# Hello\n\nWorld.",
  primary: [3, 4],
  secondary: [2, 6],
  annotations: { "5": "table" },
  stats: { noise_ratio: 0.4, tokens_saved: 1200, node_count: 12, latency_ms: 800 },
  page_title: "Hello",
  url: "https://example.com",
}

function mockFetch(response: { status?: number; json?: unknown; headers?: Record<string, string> }) {
  return async () =>
    new Response(JSON.stringify(response.json ?? {}), {
      status: response.status ?? 200,
      headers: { "content-type": "application/json", ...response.headers },
    })
}

describe("Engram", () => {
  test("requires api key", () => {
    delete process.env.ENGRAM_API_KEY
    expect(() => new Engram()).toThrow(EngramError)
  })

  test("parse url", async () => {
    const engram = new Engram({ apiKey: "sk-test", fetch: mockFetch({ json: SAMPLE }) })
    const result = await engram.parse("https://example.com")
    expect(result.markdown).toStartWith("# Hello")
    expect(result.stats.tokensSaved).toBe(1200)
    expect(result.stats.noiseRatio).toBe(0.4)
    expect(result.primary).toEqual([3, 4])
    expect(result.pageTitle).toBe("Hello")
  })

  test("parse html", async () => {
    const engram = new Engram({ apiKey: "sk-test", fetch: mockFetch({ json: SAMPLE }) })
    const result = await engram.parseHtml("<html/>", { url: "https://example.com" })
    expect(result.stats.nodeCount).toBe(12)
  })

  test("auth error", async () => {
    const engram = new Engram({
      apiKey: "sk-bad",
      fetch: mockFetch({ status: 401, json: { error: { code: "auth", message: "bad" } } }),
    })
    await expect(engram.parse("https://example.com")).rejects.toBeInstanceOf(AuthError)
  })

  test("rate limit", async () => {
    const engram = new Engram({
      apiKey: "sk-test",
      fetch: mockFetch({
        status: 429,
        headers: { "retry-after": "5" },
        json: { error: { code: "rate_limited", message: "slow" } },
      }),
    })
    try {
      await engram.parse("https://example.com")
      throw new Error("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError)
      expect((e as RateLimitError).retryAfter).toBe(5)
    }
  })

  test("base url override", async () => {
    let capturedUrl = ""
    const f: typeof fetch = async (input) => {
      capturedUrl = typeof input === "string" ? input : (input as Request).url
      return new Response(JSON.stringify(SAMPLE), { status: 200 })
    }
    const engram = new Engram({ apiKey: "sk-test", baseUrl: "http://localhost:7842", fetch: f })
    await engram.parse("https://example.com")
    expect(capturedUrl).toBe("http://localhost:7842/v1/parse")
  })
})
