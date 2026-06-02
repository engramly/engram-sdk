/**
 * HTTP client for the Engram API. Zero deps, native fetch.
 */

import { APIError, AuthError, EngramError, RateLimitError } from "./errors"
import type {
  EngramConfig,
  ParseHtmlOptions,
  ParseOptions,
  ParseResult,
  StreamEvent,
} from "./types"

const DEFAULT_BASE_URL = "https://api.engramly.com"
const DEFAULT_TIMEOUT = 60_000
const USER_AGENT = "engramly-ts/0.1.0"

// Allow Node.js process.env without pulling @types/node into hot path.
declare const process: { env?: Record<string, string | undefined> } | undefined

function resolveApiKey(provided?: string): string {
  const key = provided ?? process?.env?.ENGRAM_API_KEY
  if (!key) {
    throw new EngramError(
      "apiKey is required. Pass { apiKey } or set ENGRAM_API_KEY.",
    )
  }
  return key
}

function resolveBaseUrl(provided?: string): string {
  const url = provided ?? process?.env?.ENGRAM_BASE_URL ?? DEFAULT_BASE_URL
  return url.replace(/\/$/, "")
}

function snakeToCamelResult(raw: any): ParseResult {
  const s = raw.stats ?? {}
  return {
    markdown: raw.markdown ?? "",
    primary: raw.primary ?? [],
    secondary: raw.secondary ?? [],
    annotations: raw.annotations ?? {},
    stats: {
      noiseRatio: s.noise_ratio ?? 0,
      tokensSaved: s.tokens_saved ?? 0,
      nodeCount: s.node_count ?? 0,
      latencyMs: s.latency_ms ?? 0,
    },
    pageTitle: raw.page_title ?? null,
    url: raw.url ?? null,
  }
}

async function throwForStatus(response: Response): Promise<void> {
  if (response.ok) return
  const body = await response.json().catch(() => null)
  const err = body?.error ?? {}
  const message: string = err.message ?? response.statusText ?? "request failed"
  const code: string | undefined = err.code

  if (response.status === 401) throw new AuthError(message)
  if (response.status === 429) {
    const retryHeader = response.headers.get("retry-after")
    const retryAfter = retryHeader ? Number(retryHeader) : undefined
    throw new RateLimitError(message, { retryAfter })
  }
  throw new APIError(message, { status: response.status, code })
}

export class Engram {
  private apiKey: string
  private baseUrl: string
  private timeout: number
  private fetchImpl: typeof fetch

  constructor(config: EngramConfig = {}) {
    this.apiKey = resolveApiKey(config.apiKey)
    this.baseUrl = resolveBaseUrl(config.baseUrl)
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT
    this.fetchImpl = config.fetch ?? fetch
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      ...extra,
    }
  }

  private withTimeout(signal?: AbortSignal): AbortSignal {
    if (signal) return signal
    const ac = new AbortController()
    setTimeout(() => ac.abort(), this.timeout)
    return ac.signal
  }

  async parse(url: string, options: ParseOptions = {}): Promise<ParseResult> {
    const body = {
      url,
      render: options.render ?? true,
      ...(options.timeoutMs !== undefined ? { timeout_ms: options.timeoutMs } : {}),
    }
    const response = await this.fetchImpl(`${this.baseUrl}/v1/parse`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: this.withTimeout(options.signal),
    })
    await throwForStatus(response)
    return snakeToCamelResult(await response.json())
  }

  async parseHtml(
    html: string,
    options: ParseHtmlOptions = {},
  ): Promise<ParseResult> {
    const body: Record<string, unknown> = { html }
    if (options.url) body.url = options.url
    const response = await this.fetchImpl(`${this.baseUrl}/v1/parse-html`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: this.withTimeout(options.signal),
    })
    await throwForStatus(response)
    return snakeToCamelResult(await response.json())
  }

  async *parseStream(
    url: string,
    options: ParseOptions = {},
  ): AsyncIterable<StreamEvent> {
    const body = {
      url,
      render: options.render ?? true,
      stream: true,
    }
    const response = await this.fetchImpl(`${this.baseUrl}/v1/parse`, {
      method: "POST",
      headers: this.headers({ Accept: "text/event-stream" }),
      body: JSON.stringify(body),
      signal: this.withTimeout(options.signal),
    })
    await throwForStatus(response)
    if (!response.body) return

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

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
  }
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
