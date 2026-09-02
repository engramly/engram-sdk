/**
 * HTTP client for the Engram API. Zero deps, native fetch.
 */

import { APIError, AuthError, EngramError, RateLimitError } from "./errors.js"
import type {
  EngramConfig,
  ParseHtmlOptions,
  ParseOptions,
  ParseResult,
  StreamEvent,
  PdfSource, PdfInspectResult, PdfOptions, PdfParseResult, PdfPreflightResult,
  PdfPrepared, PdfPreparedResult, PdfProgress, PdfRequestInfo,
} from "./types.js"

const DEFAULT_BASE_URL = "https://api.engramly.net"
const DEFAULT_TIMEOUT = 60_000
const DEFAULT_PDF_TIMEOUT = 15 * 60_000
const USER_AGENT = "engramly-ts/0.1.0"
const PREPARE_FAST_POLL_MS = 500
const PREPARE_NORMAL_POLL_MS = 1_000
const PREPARE_SLOW_POLL_MS = 2_000
type PdfInternalOptions = PdfOptions & { prewarmed?: boolean; preparedOrigin?: "edge" | "modal" | "vast" }

function progress(callback: PdfOptions["onProgress"], event: PdfProgress): void {
  try { Promise.resolve(callback?.(event)).catch(() => {}) } catch { /* Observability must not change request behavior. */ }
}

// Allow Node.js process.env without pulling @types/node into hot path.
declare const process: { env?: Record<string, string | undefined> } | undefined

function resolveApiKey(provided?: string): string {
  const key = provided ?? process?.env?.ENGRAMLY_API_KEY ?? process?.env?.ENGRAM_API_KEY
  if (!key) {
    throw new EngramError(
      "apiKey is required. Pass { apiKey } or set ENGRAMLY_API_KEY.",
    )
  }
  return key
}

function resolveBaseUrl(provided?: string): string {
  const url = provided ?? process?.env?.ENGRAMLY_BASE_URL ?? process?.env?.ENGRAM_BASE_URL ?? DEFAULT_BASE_URL
  return url.replace(/\/$/, "")
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

function snakeToCamelResult(value: unknown): ParseResult {
  const raw = record(value)
  const s = record(raw.stats)
  return {
    markdown: String(raw.markdown ?? ""),
    primary: Array.isArray(raw.primary) ? raw.primary as number[] : [],
    secondary: Array.isArray(raw.secondary) ? raw.secondary as number[] : [],
    annotations: record(raw.annotations) as ParseResult["annotations"],
    stats: {
      noiseRatio: Number(s.noise_ratio ?? 0),
      tokensSaved: Number(s.tokens_saved ?? 0),
      nodeCount: Number(s.node_count ?? 0),
      latencyMs: Number(s.latency_ms ?? 0),
    },
    pageTitle: typeof raw.page_title === "string" ? raw.page_title : null,
    url: typeof raw.url === "string" ? raw.url : null,
  }
}

async function throwForStatus(response: Response, options: { started?: number; phase?: APIError["phase"] } = {}): Promise<void> {
  if (response.ok) return
  const body = await response.json().catch(() => null)
  const err = body?.error
  const code: string | undefined = typeof err === "string" ? err : err?.code
  const fallback = response.status === 524
    ? "PDF origin timed out while waiting for inference capacity; the request is not retried because it may already be running"
    : response.statusText || "request failed"
  const message: string = (typeof err === "object" ? err?.message ?? err?.detail : undefined) ?? body?.detail ?? code ?? fallback

  if (response.status === 401) throw new AuthError(message)
  if (response.status === 429) {
    const retryHeader = response.headers.get("retry-after")
    const retryAfter = retryHeader ? Number(retryHeader) : undefined
    throw new RateLimitError(message, { retryAfter })
  }
  throw new APIError(message, {
    status: response.status, code, phase: options.phase,
    request: options.started === undefined ? undefined : requestInfo(response, options.started),
  })
}

function timing(value: string | null): Record<string, number> {
  if (!value) return {}
  return Object.fromEntries(value.split(",").flatMap(part => {
    const match = part.trim().match(/^([^;]+)(?:;[^,]*?dur=([0-9.]+))?/)
    return match?.[1] && match[2] ? [[match[1], Number(match[2])]] : []
  }))
}

function requestInfo(response: Response, started: number): PdfRequestInfo {
  const rawWorkers = response.headers.get("x-engram-workers")
  const workers = rawWorkers === null ? NaN : Number(rawWorkers)
  const rawTarget = response.headers.get("x-engram-worker-target")
  const workerTarget = rawTarget === null ? NaN : Number(rawTarget)
  const origin = response.headers.get("x-engram-origin")
  return {
    elapsedMs: Math.round((performance.now() - started) * 10) / 10,
    requestId: response.headers.get("x-engram-request-id") ?? undefined,
    origin: origin === "edge" || origin === "modal" || origin === "vast" ? origin : undefined,
    cache: response.headers.get("x-engram-cache") ?? undefined,
    inspectCache: response.headers.get("x-engram-inspect-cache") === "hit"
      ? "hit"
      : response.headers.get("x-engram-inspect-cache") === "miss" ? "miss" : undefined,
    workers: Number.isFinite(workers) ? workers : undefined,
    workerTarget: Number.isFinite(workerTarget) ? workerTarget : undefined,
    cfRay: response.headers.get("cf-ray") ?? undefined,
    timings: timing(response.headers.get("server-timing")),
  }
}

export class Engram {
  private apiKey: string
  private baseUrl: string
  private timeout: number
  private pdfTimeout: number
  private fetchImpl: typeof fetch
  readonly pdf: {
    preflight: (source: PdfSource, options?: PdfOptions) => Promise<PdfPreflightResult>
    inspect: (source: PdfSource, signal?: AbortSignal) => Promise<PdfInspectResult>
    parse: (source: PdfSource, options?: PdfOptions) => Promise<PdfParseResult>
    prepare: (source: PdfSource, options?: PdfOptions) => Promise<PdfPrepared>
    parsePrepared: (source: PdfSource, options?: PdfOptions) => Promise<PdfPreparedResult>
  }

  constructor(config: EngramConfig = {}) {
    this.apiKey = resolveApiKey(config.apiKey)
    this.baseUrl = resolveBaseUrl(config.baseUrl)
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
    this.pdfTimeout = config.pdfTimeout ?? DEFAULT_PDF_TIMEOUT
    this.fetchImpl = config.fetch ?? fetch
    this.pdf = {
      preflight: (source, options) => this.preflightPdf(source, options),
      inspect: (source, signal) => this.inspectPdf(source, signal),
      parse: (source, options) => this.parsePdf(source, options),
      prepare: (source, options) => this.preparePdf(source, options),
      parsePrepared: (source, options) => this.parsePreparedPdf(source, options),
    }
  }

  private pdfForm(source: PdfSource, options: PdfInternalOptions = {}): FormData {
    const form = new FormData()
    if (typeof source === "string" && /^https:\/\//i.test(source)) form.set("url", source)
    else if (typeof source === "string") throw new EngramError("Pass local PDF bytes; paths are resolved by the CLI and MCP server.")
    else form.set("file", source instanceof Blob ? source : new Blob([buffer(source)], { type: "application/pdf" }), "document.pdf")
    if (options.pages) form.set("pages", options.pages)
    if (options.figures !== undefined) form.set("figures", String(options.figures))
    if (options.dpi !== undefined) form.set("dpi", String(options.dpi))
    if (options.prewarmed) form.set("prewarmed", "true")
    if (options.preparedOrigin) form.set("prepared_origin", options.preparedOrigin)
    if (options.pageCount !== undefined) form.set("page_count", String(options.pageCount))
    return form
  }

  private pdfHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, "User-Agent": USER_AGENT }
  }

  private async inspectPdf(source: PdfSource, signal?: AbortSignal, options: PdfOptions = {}, asyncPrepare = false): Promise<PdfInspectResult> {
    const started = performance.now()
    const headers = { ...this.pdfHeaders(), ...(asyncPrepare ? { "X-Engram-Async-Prepare": "1" } : {}) }
    const output = await this.json(`${this.baseUrl}/v1/pdf/inspect`, { method: "POST", headers, body: this.pdfForm(source, options) }, signal, this.pdfTimeout, { started, phase: "inspect" })
    const response = output.response
    const raw = output.body as Record<string, unknown>
    return { documentId: String(raw.document_id), filename: raw.filename as string | null, pages: Number(raw.pages), title: raw.title as string | null, author: raw.author as string | null, encrypted: Boolean(raw.encrypted), outlineSource: raw.outline_source as "pdf" | "none", outline: raw.outline as PdfInspectResult["outline"], prepared: response.headers.get("x-engram-prepared") === "1", prepareToken: response.headers.get("x-engram-prepare-token") ?? undefined, request: requestInfo(response, started) }
  }

  private async preflightPdf(source: PdfSource, options: PdfOptions = {}): Promise<PdfPreflightResult> {
    if (typeof source === "string") throw new EngramError("Preflight requires local PDF bytes.")
    const bytes = source instanceof Blob ? await source.arrayBuffer() : buffer(source)
    const digest = await crypto.subtle.digest("SHA-256", bytes)
    const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("")
    const started = performance.now()
    const output = await this.json(`${this.baseUrl}/v1/pdf/preflight`, { method: "POST", headers: { ...this.pdfHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ sha256, dpi: options.dpi ?? 200, figures: options.figures ?? false, pages: options.pageCount }) }, options.signal, this.pdfTimeout, { started, phase: "preflight" })
    const response = output.response
    const raw = output.body as { cache: "hit" | "miss"; workers?: number; target?: number }
    return { cache: raw.cache, workers: raw.workers ?? 0, target: raw.target ?? 0, supported: true, request: requestInfo(response, started) }
  }

  private async parsePdf(source: PdfSource, options: PdfInternalOptions = {}): Promise<PdfParseResult> {
    const started = performance.now()
    progress(options.onProgress, { phase: "parse", state: "started", elapsedMs: 0, pages: options.pageCount })
    const output = await this.json(`${this.baseUrl}/v1/pdf/parse`, { method: "POST", headers: this.pdfHeaders(), body: this.pdfForm(source, options) }, options.signal, this.pdfTimeout, { started, phase: "parse" }).catch(error => {
      progress(options.onProgress, { phase: "parse", state: "failed", elapsedMs: Math.round((performance.now() - started) * 10) / 10, pages: options.pageCount, request: error instanceof APIError ? error.request : undefined })
      throw error
    })
    const response = output.response
    const raw = output.body as Record<string, unknown>
    const result = { documentId: raw.document_id as string | undefined, markdown: String(raw.markdown ?? ""), pageMarkdown: (raw.page_markdown ?? []) as PdfParseResult["pageMarkdown"], pages: Number(raw.pages), crops: raw.crops as number | undefined, elapsed: Number(raw.elapsed ?? 0), metadata: (raw.metadata ?? {}) as Record<string, unknown>, request: requestInfo(response, started) }
    progress(options.onProgress, { phase: "parse", state: "completed", elapsedMs: result.request.elapsedMs, pages: result.pages, request: result.request })
    return result
  }

  private async preparePdf(source: PdfSource, options: PdfOptions = {}): Promise<PdfPrepared> {
    if (typeof source === "string") throw new EngramError("Prepared parsing requires local PDF bytes.")
    const started = performance.now()
    const elapsed = () => Math.round((performance.now() - started) * 10) / 10
    progress(options.onProgress, { phase: "prepare", state: "started", elapsedMs: 0 })
    const inspect = await this.inspectPdf(source, options.signal, options, true).catch(error => {
      progress(options.onProgress, { phase: "prepare", state: "failed", elapsedMs: Math.round((performance.now() - started) * 10) / 10, request: error instanceof APIError ? error.request : undefined })
      throw error
    })
    if (inspect.prepared) {
      const preflight = {
        cache: inspect.request.cache === "edge" ? "hit" as const : "miss" as const,
        workers: inspect.request.workers ?? 0,
        target: inspect.request.workerTarget ?? 0,
        supported: true,
        request: inspect.request,
      }
      const elapsedMs = elapsed()
      progress(options.onProgress, { phase: "prepare", state: "completed", elapsedMs, pages: inspect.pages, workers: preflight.workers, target: preflight.target, supported: true, request: inspect.request })
      return { inspect, preflight, elapsedMs }
    }
    if (inspect.prepareToken) {
      const ready = await this.waitForPreparation(inspect, started, options).catch(error => {
        progress(options.onProgress, { phase: "prepare", state: "failed", elapsedMs: Math.round((performance.now() - started) * 10) / 10, pages: inspect.pages, request: error instanceof APIError ? error.request : undefined })
        throw error
      })
      const request = {
        ...ready,
        workers: ready.workers ?? inspect.request.workers,
        workerTarget: ready.workerTarget ?? inspect.request.workerTarget,
      }
      const preflight = { cache: inspect.request.cache === "edge" ? "hit" as const : "miss" as const, workers: request.workers ?? 0, target: request.workerTarget ?? 0, supported: true, request }
      const elapsedMs = elapsed()
      progress(options.onProgress, { phase: "prepare", state: "completed", elapsedMs, pages: inspect.pages, workers: preflight.workers, target: preflight.target, supported: true, request })
      return { inspect: { ...inspect, prepared: true }, preflight, elapsedMs }
    }
    const preflight = await this.preflightPdf(
      source, { ...options, pageCount: inspect.pages },
    ).catch(error => {
      if (!(error instanceof APIError) || error.status !== 404) {
        progress(options.onProgress, { phase: "prepare", state: "failed", elapsedMs: Math.round((performance.now() - started) * 10) / 10, pages: inspect.pages, request: error instanceof APIError ? error.request : undefined })
        throw error
      }
      return { cache: "miss" as const, workers: 0, target: 0, supported: false, request: inspect.request }
    })
    const elapsedMs = elapsed()
    progress(options.onProgress, { phase: "prepare", state: "completed", elapsedMs, pages: inspect.pages, workers: preflight.workers, target: preflight.target, supported: preflight.supported, request: preflight.request })
    return { inspect, preflight, elapsedMs }
  }

  private async waitForPreparation(inspect: PdfInspectResult, started: number, options: PdfOptions): Promise<PdfRequestInfo> {
    const deadline = started + this.pdfTimeout
    while (performance.now() < deadline) {
      const output = await this.json(`${this.baseUrl}/v1/pdf/prepare/status`, { method: "POST", headers: { ...this.pdfHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ token: inspect.prepareToken }) }, options.signal, Math.min(this.pdfTimeout, 30_000), { started, phase: "preflight" })
      const state = record(output.body).state
      if (state === "ready") return requestInfo(output.response, started)
      if (state !== "pending") throw new APIError("PDF inference preparation failed", { status: output.response.status, phase: "preflight", request: requestInfo(output.response, started) })
      const elapsed = performance.now() - started
      const interval = elapsed < 30_000
        ? PREPARE_FAST_POLL_MS
        : elapsed < 120_000 ? PREPARE_NORMAL_POLL_MS : PREPARE_SLOW_POLL_MS
      const wait = Math.min(interval, Math.max(0, deadline - performance.now()))
      if (wait === 0) break
      await pause(wait, options.signal)
      progress(options.onProgress, { phase: "prepare", state: "waiting", elapsedMs: Math.round((performance.now() - started) * 10) / 10, pages: inspect.pages, workers: inspect.request.workers, target: inspect.request.workerTarget, supported: true, request: inspect.request })
    }
    throw new APIError("PDF inference preparation timed out", { status: 408, phase: "preflight", request: inspect.request })
  }

  private async parsePreparedPdf(source: PdfSource, options: PdfOptions = {}): Promise<PdfPreparedResult> {
    if (typeof source === "string") throw new EngramError("Prepared parsing requires local PDF bytes.")
    if (options.pages) throw new EngramError("Prepared parsing supports complete documents only; use pdf.parse() for selected pages.")
    const local = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : source
    const prepared = await this.preparePdf(local, options)
    const result = await this.parsePdf(local, {
      ...options,
      pageCount: prepared.inspect.pages,
      prewarmed: prepared.preflight.supported,
      preparedOrigin: prepared.preflight.supported
        ? prepared.preflight.cache === "hit" ? "edge"
          : prepared.preflight.workers > 0 ? "vast" : "modal"
        : undefined,
    }).catch(error => {
      if (error instanceof APIError) error.prepared = prepared
      throw error
    })
    return { ...prepared, result }
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      ...extra,
    }
  }

  private async request(url: string, init: RequestInit, signal: AbortSignal | undefined, timeout: number): Promise<{ response: Response; close: () => void }> {
    const ac = new AbortController()
    const abort = () => ac.abort(signal?.reason)
    if (signal?.aborted) abort()
    signal?.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(() => ac.abort(new DOMException("Request timed out", "TimeoutError")), timeout)
    try {
      const response = await this.fetchImpl(url, { ...init, signal: ac.signal })
      return { response, close: () => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
      } }
    } catch (error) {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      throw error
    }
  }

  private async json(url: string, init: RequestInit, signal: AbortSignal | undefined, timeout: number, error: { started?: number; phase?: APIError["phase"] } = {}): Promise<{ response: Response; body: unknown }> {
    const pending = await this.request(url, init, signal, timeout)
    try {
      await throwForStatus(pending.response, error)
      return { response: pending.response, body: await pending.response.json() }
    } finally {
      pending.close()
    }
  }

  async parse(url: string, options: ParseOptions = {}): Promise<ParseResult> {
    if (this.baseUrl === DEFAULT_BASE_URL) {
      throw new EngramError(
        "Hosted URL parsing is not available; use pdf.parsePrepared() with PDF bytes.",
        { code: "unsupported_hosted_operation" },
      )
    }
    const body = {
      url,
      render: options.render ?? true,
      ...(options.timeoutMs !== undefined ? { timeout_ms: options.timeoutMs } : {}),
    }
    const output = await this.json(`${this.baseUrl}/v1/parse`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    }, options.signal, this.timeout)
    return snakeToCamelResult(output.body)
  }

  async parseHtml(
    html: string,
    options: ParseHtmlOptions = {},
  ): Promise<ParseResult> {
    if (this.baseUrl === DEFAULT_BASE_URL) {
      throw new EngramError(
        "Hosted HTML parsing is not available; use pdf.parsePrepared() with PDF bytes.",
        { code: "unsupported_hosted_operation" },
      )
    }
    const body: Record<string, unknown> = { html }
    if (options.url) body.url = options.url
    const output = await this.json(`${this.baseUrl}/v1/parse-html`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    }, options.signal, this.timeout)
    return snakeToCamelResult(output.body)
  }

  async *parseStream(
    url: string,
    options: ParseOptions = {},
  ): AsyncIterable<StreamEvent> {
    if (this.baseUrl === DEFAULT_BASE_URL) {
      throw new EngramError(
        "Hosted URL streaming is not available; use pdf.parsePrepared() with PDF bytes.",
        { code: "unsupported_hosted_operation" },
      )
    }
    const body = {
      url,
      render: options.render ?? true,
      stream: true,
    }
    const pending = await this.request(`${this.baseUrl}/v1/parse`, {
      method: "POST",
      headers: this.headers({ Accept: "text/event-stream" }),
      body: JSON.stringify(body),
    }, options.signal, this.timeout)
    const response = pending.response
    await throwForStatus(response).catch(error => { pending.close(); throw error })
    if (!response.body) { pending.close(); return }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          const event = parseSseLine(line)
          if (event) yield event
        }
      }
    } finally {
      pending.close()
    }
  }
}

function buffer(value: Uint8Array): ArrayBuffer {
  if (value.buffer instanceof ArrayBuffer && value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) return value.buffer
  return value.slice().buffer as ArrayBuffer
}

function pause(duration: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error?: unknown) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = () => done(signal?.reason ?? new DOMException("Aborted", "AbortError"))
    const timer = setTimeout(done, duration)
    if (signal?.aborted) abort()
    else signal?.addEventListener("abort", abort, { once: true })
  })
}

function parseSseLine(line: string): StreamEvent | null {
  if (!line.startsWith("data:")) return null
  const payload = line.slice(5).trim()
  if (!payload || payload === "[DONE]") return null
  try {
    return JSON.parse(payload) as StreamEvent
  } catch {
    return null
  }
}
