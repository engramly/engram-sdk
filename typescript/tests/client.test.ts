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
    delete process.env.ENGRAMLY_API_KEY
    expect(() => new Engram()).toThrow(EngramError)
  })

  test("fails fast for unsupported hosted web parsing", async () => {
    const engram = new Engram({ apiKey: "key", fetch: mockFetch({ json: SAMPLE }) })
    await expect(engram.parse("https://example.com")).rejects.toMatchObject({
      code: "unsupported_hosted_operation",
    })
    await expect(engram.parseHtml("<p>x</p>")).rejects.toMatchObject({
      code: "unsupported_hosted_operation",
    })
  })

  test("parse url", async () => {
    const engram = new Engram({ apiKey: "sk-test", baseUrl: "http://localhost:7842", fetch: mockFetch({ json: SAMPLE }) })
    const result = await engram.parse("https://example.com")
    expect(result.markdown).toStartWith("# Hello")
    expect(result.stats.tokensSaved).toBe(1200)
    expect(result.stats.noiseRatio).toBe(0.4)
    expect(result.primary).toEqual([3, 4])
    expect(result.pageTitle).toBe("Hello")
  })

  test("parse html", async () => {
    const engram = new Engram({ apiKey: "sk-test", baseUrl: "http://localhost:7842", fetch: mockFetch({ json: SAMPLE }) })
    const result = await engram.parseHtml("<html/>", { url: "https://example.com" })
    expect(result.stats.nodeCount).toBe(12)
  })

  test("auth error", async () => {
    const engram = new Engram({
      apiKey: "sk-bad",
      baseUrl: "http://localhost:7842",
      fetch: mockFetch({ status: 401, json: { error: { code: "auth", message: "bad" } } }),
    })
    await expect(engram.parse("https://example.com")).rejects.toBeInstanceOf(AuthError)
  })

  test("rate limit", async () => {
    const engram = new Engram({
      apiKey: "sk-test",
      baseUrl: "http://localhost:7842",
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

  test("inspect pdf uses multipart PDF endpoint", async () => {
    let request: RequestInit | undefined
    const f: typeof fetch = async (_input, init) => { request = init; return new Response(JSON.stringify({ document_id: "abc", filename: "x.pdf", pages: 2, title: null, author: null, encrypted: false, outline_source: "none", outline: [] }), { headers: { "server-timing": "form;dur=2.5, modal;dur=10", "x-engram-origin": "modal", "x-engram-request-id": "req-1" } }) }
    const engram = new Engram({ apiKey: "key", fetch: f })
    const result = await engram.pdf.inspect(new Uint8Array([1, 2]))
    expect(result.documentId).toBe("abc"); expect(request?.body).toBeInstanceOf(FormData)
    expect(result.request.origin).toBe("modal"); expect(result.request.timings.modal).toBe(10)
  })

  test("prepared PDF flow supplies inspected pages to preflight", async () => {
    const calls: Array<{ path: string; body?: string; form?: FormData }> = []
    const f: typeof fetch = async (input, init) => {
      const path = new URL(typeof input === "string" ? input : input.url).pathname
      calls.push({ path, body: typeof init?.body === "string" ? init.body : undefined, form: init?.body instanceof FormData ? init.body : undefined })
      if (path.endsWith("inspect")) return Response.json({ document_id: "abc", pages: 42, outline_source: "none", outline: [] })
      if (path.endsWith("preflight")) return Response.json({ cache: "miss", workers: 2, target: 3 })
      return Response.json({ markdown: "ok", pages: 42, page_markdown: [] }, { headers: { "x-engram-origin": "vast", "x-engram-workers": "2" } })
    }
    const engram = new Engram({ apiKey: "key", fetch: f })
    const prepared = await engram.pdf.parsePrepared(new Uint8Array([1, 2]))
    expect(JSON.parse(calls[1].body ?? "{}").pages).toBe(42)
    expect(calls[2].form?.get("prewarmed")).toBe("true")
    expect(calls[2].form?.get("prepared_origin")).toBe("vast")
    expect(calls[2].form?.get("page_count")).toBe("42")
    expect(prepared.preflight.workers).toBe(2)
    expect(prepared.preflight.target).toBe(3)
    expect(prepared.result.request.origin).toBe("vast")
  })

  test("prepared PDF flow uses one preparation request on a capable gateway", async () => {
    const calls: Array<{ path: string; form?: FormData }> = []
    const f: typeof fetch = async (input, init) => {
      const path = new URL(typeof input === "string" ? input : input.url).pathname
      calls.push({ path, form: init?.body instanceof FormData ? init.body : undefined })
      if (path.endsWith("inspect")) return Response.json(
        { document_id: "abc", pages: 42, outline_source: "none", outline: [] },
        { headers: { "x-engram-prepared": "1", "x-engram-workers": "2", "x-engram-worker-target": "3", "x-engram-cache": "miss", "x-engram-inspect-cache": "hit", "x-engram-origin": "edge" } },
      )
      return Response.json({ markdown: "ok", pages: 42, page_markdown: [] }, { headers: { "x-engram-origin": "vast" } })
    }
    const engram = new Engram({ apiKey: "key", fetch: f })
    const prepared = await engram.pdf.parsePrepared(new Uint8Array([1, 2]))
    expect(calls.map(call => call.path)).toEqual(["/v1/pdf/inspect", "/v1/pdf/parse"])
    expect(calls[1].form?.get("prepared_origin")).toBe("vast")
    expect(prepared.inspect.prepared).toBe(true)
    expect(prepared.inspect.request.inspectCache).toBe("hit")
    expect(prepared.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(prepared.preflight.workers).toBe(2)
    expect(prepared.preflight.target).toBe(3)
    expect(prepared.preflight.request.requestId).toBe(prepared.inspect.request.requestId)
  })

  test("polls asynchronous preparation before submitting the parse", async () => {
    const calls: Array<{ path: string; form?: FormData }> = []
    const f: typeof fetch = async (input, init) => {
      const path = new URL(typeof input === "string" ? input : input.url).pathname
      calls.push({ path, form: init?.body instanceof FormData ? init.body : undefined })
      if (path.endsWith("inspect")) {
        expect(new Headers(init?.headers).get("x-engram-async-prepare")).toBe("1")
        return Response.json(
          { document_id: "abc", pages: 2, outline_source: "none", outline: [] },
          { headers: { "x-engram-prepared": "0", "x-engram-prepare-token": "opaque-token" } },
        )
      }
      if (path.endsWith("status")) {
        expect(JSON.parse(String(init?.body))).toEqual({ token: "opaque-token" })
        return Response.json({ state: "ready" })
      }
      return Response.json({ markdown: "ok", pages: 2, page_markdown: [] })
    }
    const engram = new Engram({ apiKey: "key", fetch: f })
    const prepared = await engram.pdf.parsePrepared(new Uint8Array([1]))
    expect(calls.map(call => call.path)).toEqual(["/v1/pdf/inspect", "/v1/pdf/prepare/status", "/v1/pdf/parse"])
    expect(calls[2].form?.get("prewarmed")).toBe("true")
    expect(calls[2].form?.get("prepared_origin")).toBe("modal")
    expect(prepared.preflight.workers).toBe(0)
    expect(prepared.inspect.prepared).toBe(true)
    expect(prepared.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  test("uses Vast when it wins asynchronous preparation", async () => {
    const calls: Array<{ path: string; form?: FormData }> = []
    const f: typeof fetch = async (input, init) => {
      const path = new URL(typeof input === "string" ? input : input.url).pathname
      calls.push({ path, form: init?.body instanceof FormData ? init.body : undefined })
      if (path.endsWith("inspect")) return Response.json(
        { document_id: "abc", pages: 12, outline_source: "none", outline: [] },
        { headers: { "x-engram-prepared": "0", "x-engram-prepare-token": "opaque-token", "x-engram-workers": "0", "x-engram-worker-target": "2" } },
      )
      if (path.endsWith("status")) return Response.json(
        { state: "ready", origin: "vast", workers: 2 },
        { headers: { "x-engram-origin": "vast", "x-engram-workers": "2", "x-engram-worker-target": "2" } },
      )
      return Response.json({ markdown: "ok", pages: 12, page_markdown: [] }, { headers: { "x-engram-origin": "vast" } })
    }
    const engram = new Engram({ apiKey: "key", fetch: f })
    const prepared = await engram.pdf.parsePrepared(new Uint8Array([1]))

    expect(calls[2].form?.get("prepared_origin")).toBe("vast")
    expect(calls[2].form?.get("prewarmed")).toBe("true")
    expect(prepared.preflight.workers).toBe(2)
    expect(prepared.preflight.target).toBe(2)
    expect(prepared.preflight.request.origin).toBe("vast")
  })

  test("polls pending preparation promptly and retains status telemetry", async () => {
    const calls: string[] = []
    const events: string[] = []
    let polls = 0
    const f: typeof fetch = async (input) => {
      const path = new URL(typeof input === "string" ? input : input.url).pathname
      calls.push(path)
      if (path.endsWith("inspect")) return Response.json(
        { document_id: "abc", pages: 2, outline_source: "none", outline: [] },
        { headers: { "x-engram-prepared": "0", "x-engram-prepare-token": "opaque-token", "x-engram-worker-target": "1" } },
      )
      if (path.endsWith("status")) {
        polls += 1
        return Response.json(
          { state: polls === 1 ? "pending" : "ready" },
          { status: polls === 1 ? 202 : 200, headers: { "x-engram-origin": "modal", "server-timing": "total;dur=3" } },
        )
      }
      return Response.json({ markdown: "ok", pages: 2, page_markdown: [] })
    }
    const engram = new Engram({ apiKey: "key", fetch: f })
    const prepared = await engram.pdf.parsePrepared(new Uint8Array([1]), {
      onProgress: event => { events.push(`${event.phase}:${event.state}`) },
    })
    expect(calls).toEqual(["/v1/pdf/inspect", "/v1/pdf/prepare/status", "/v1/pdf/prepare/status", "/v1/pdf/parse"])
    expect(events).toContain("prepare:waiting")
    expect(prepared.preflight.request.origin).toBe("modal")
    expect(prepared.preflight.request.timings.total).toBe(3)
    expect(prepared.preflight.target).toBe(1)
  })

  test("reports preparation status failure without submitting parse", async () => {
    const calls: string[] = []
    const f: typeof fetch = async (input) => {
      const path = new URL(typeof input === "string" ? input : input.url).pathname
      calls.push(path)
      if (path.endsWith("inspect")) return Response.json(
        { document_id: "abc", pages: 2, outline_source: "none", outline: [] },
        { headers: { "x-engram-prepared": "0", "x-engram-prepare-token": "opaque-token" } },
      )
      return Response.json({ state: "failed" }, { status: 502, headers: { "x-engram-origin": "modal" } })
    }
    const engram = new Engram({ apiKey: "key", fetch: f })
    await expect(engram.pdf.parsePrepared(new Uint8Array([1]))).rejects.toMatchObject({
      status: 502, phase: "preflight", request: { origin: "modal" },
    })
    expect(calls).toEqual(["/v1/pdf/inspect", "/v1/pdf/prepare/status"])
  })

  test("cancels between preparation polls without submitting parse", async () => {
    const calls: string[] = []
    const controller = new AbortController()
    const f: typeof fetch = async (input) => {
      const path = new URL(typeof input === "string" ? input : input.url).pathname
      calls.push(path)
      if (path.endsWith("inspect")) return Response.json(
        { document_id: "abc", pages: 2, outline_source: "none", outline: [] },
        { headers: { "x-engram-prepared": "0", "x-engram-prepare-token": "opaque-token" } },
      )
      return Response.json({ state: "pending" }, { status: 202 })
    }
    const engram = new Engram({ apiKey: "key", fetch: f })
    const pending = engram.pdf.parsePrepared(new Uint8Array([1]), { signal: controller.signal })
    setTimeout(() => controller.abort(new DOMException("Stopped", "AbortError")), 10)
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(calls).toEqual(["/v1/pdf/inspect", "/v1/pdf/prepare/status"])
  })

  test("prepared PDF flow degrades safely when legacy gateway lacks preflight", async () => {
    const calls: Array<{ path: string; form?: FormData }> = []
    const f: typeof fetch = async (input, init) => {
      const path = new URL(typeof input === "string" ? input : input.url).pathname
      calls.push({ path, form: init?.body instanceof FormData ? init.body : undefined })
      if (path.endsWith("inspect")) return Response.json({ document_id: "abc", pages: 2, outline_source: "none", outline: [] })
      if (path.endsWith("preflight")) return Response.json({ error: "not_found" }, { status: 404 })
      return Response.json({ markdown: "ok", pages: 2, page_markdown: [] })
    }
    const engram = new Engram({ apiKey: "key", fetch: f })
    const prepared = await engram.pdf.parsePrepared(new Uint8Array([1, 2]))
    expect(calls.map(call => call.path)).toEqual(["/v1/pdf/inspect", "/v1/pdf/preflight", "/v1/pdf/parse"])
    expect(calls[2].form?.get("prewarmed")).toBeNull()
    expect(calls[2].form?.get("prepared_origin")).toBeNull()
    expect(prepared.preflight).toMatchObject({ cache: "miss", workers: 0 })
    expect(prepared.preflight.supported).toBe(false)
    expect(prepared.result.markdown).toBe("ok")
  })

  test("does not prewarm Vast for selected-page parsing", async () => {
    const engram = new Engram({ apiKey: "key", fetch: mockFetch({ json: {} }) })
    await expect(engram.pdf.parsePrepared(new Uint8Array([1]), { pages: "1" })).rejects.toThrow("complete documents only")
  })

  test("understands the gateway's flat error contract", async () => {
    const engram = new Engram({ apiKey: "key", fetch: mockFetch({ status: 402, json: { error: "quota_exceeded", detail: "upgrade" } }) })
    await expect(engram.pdf.parse(new Uint8Array([1]))).rejects.toMatchObject({ code: "quota_exceeded", message: "upgrade" })
  })

  test("explains origin timeout without retrying a billable parse", async () => {
    let calls = 0
    const engram = new Engram({ apiKey: "key", fetch: async () => {
      calls += 1
      return new Response(null, { status: 524 })
    } })
    await expect(engram.pdf.parse(new Uint8Array([1]))).rejects.toMatchObject({
      status: 524,
      message: expect.stringContaining("not retried"),
    })
    expect(calls).toBe(1)
  })

  test("retains preparation and failed-response telemetry after a parse timeout", async () => {
    const f: typeof fetch = async input => {
      const path = String(input)
      if (path.endsWith("inspect")) return Response.json(
        { document_id: "abc", pages: 3, outline_source: "none", outline: [] },
        { headers: { "x-engram-prepared": "1", "x-engram-workers": "0", "x-engram-worker-target": "1", "x-engram-request-id": "prepare-1" } },
      )
      return new Response(null, { status: 524, headers: { "x-engram-origin": "modal", "x-engram-request-id": "parse-1", "server-timing": "modal;dur=140000, total;dur=144000" } })
    }
    const engram = new Engram({ apiKey: "key", fetch: f })
    await expect(engram.pdf.parsePrepared(new Uint8Array([1]))).rejects.toMatchObject({
      phase: "parse", prepared: { inspect: { pages: 3 }, preflight: { target: 1 } },
      request: { origin: "modal", requestId: "parse-1", timings: { modal: 140000 } },
    })
  })

  test("reports prepared-parse lifecycle without letting callbacks change the request", async () => {
    const events: string[] = []
    const f: typeof fetch = async input => {
      const path = String(input)
      if (path.endsWith("inspect")) return Response.json(
        { document_id: "abc", pages: 3, outline_source: "none", outline: [] },
        { headers: { "x-engram-prepared": "1", "x-engram-workers": "0", "x-engram-worker-target": "1" } },
      )
      return Response.json({ markdown: "ok", pages: 3, page_markdown: [] }, { headers: { "x-engram-origin": "modal" } })
    }
    const engram = new Engram({ apiKey: "key", fetch: f })
    const result = await engram.pdf.parsePrepared(new Uint8Array([1]), { onProgress: event => {
      events.push(`${event.phase}:${event.state}:${event.pages ?? ""}`)
      if (event.state === "started") throw new Error("observer failure")
    } })
    expect(result.result.markdown).toBe("ok")
    expect(events).toEqual(["prepare:started:", "prepare:completed:3", "parse:started:3", "parse:completed:3"])
  })

  test("reports parse failure with failed response telemetry", async () => {
    const events: Array<{ phase: string; state: string; origin?: string }> = []
    const f: typeof fetch = async input => String(input).endsWith("inspect")
      ? Response.json({ document_id: "abc", pages: 1, outline_source: "none", outline: [] }, { headers: { "x-engram-prepared": "1" } })
      : new Response(null, { status: 524, headers: { "x-engram-origin": "modal" } })
    const engram = new Engram({ apiKey: "key", fetch: f })
    await engram.pdf.parsePrepared(new Uint8Array([1]), { onProgress: event => events.push({ phase: event.phase, state: event.state, origin: event.request?.origin }) }).catch(() => null)
    expect(events.at(-1)).toEqual({ phase: "parse", state: "failed", origin: "modal" })
  })

  test("ignores rejected async progress observers", async () => {
    const engram = new Engram({ apiKey: "key", fetch: mockFetch({ json: { markdown: "ok", pages: 1 } }) })
    const result = await engram.pdf.parse(new Uint8Array([1]), { onProgress: async () => { throw new Error("observer failure") } })
    expect(result.markdown).toBe("ok")
  })

  test("keeps the timeout active while consuming the response body", async () => {
    const f: typeof fetch = async (_input, init) => new Response(new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true })
      },
    }), { headers: { "content-type": "application/json" } })
    const engram = new Engram({ apiKey: "key", pdfTimeout: 10, fetch: f })
    await expect(engram.pdf.parse(new Uint8Array([1]))).rejects.toMatchObject({ name: "TimeoutError" })
  })

  test("combines caller abort with timeout and removes the caller listener", async () => {
    const controller = new AbortController()
    const originalAdd = controller.signal.addEventListener.bind(controller.signal)
    const originalRemove = controller.signal.removeEventListener.bind(controller.signal)
    let adds = 0; let removes = 0
    controller.signal.addEventListener = ((...args: Parameters<AbortSignal["addEventListener"]>) => { adds += 1; return originalAdd(...args) }) as AbortSignal["addEventListener"]
    controller.signal.removeEventListener = ((...args: Parameters<AbortSignal["removeEventListener"]>) => { removes += 1; return originalRemove(...args) }) as AbortSignal["removeEventListener"]
    const engram = new Engram({ apiKey: "key", fetch: mockFetch({ json: { markdown: "ok", pages: 1 } }) })
    await engram.pdf.parse(new Uint8Array([1]), { signal: controller.signal })
    expect(adds).toBe(1); expect(removes).toBe(1)
  })
})
