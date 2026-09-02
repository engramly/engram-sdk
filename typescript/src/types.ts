/**
 * Typed responses. Mirrors openapi.yaml ParseResult schema.
 * Field names use camelCase; the wire format uses snake_case and is
 * normalized in client.ts.
 */

export type Annotation = "table" | "math" | "code" | "image"

export interface Stats {
  noiseRatio: number
  tokensSaved: number
  nodeCount: number
  latencyMs: number
}

export interface ParseResult {
  markdown: string
  primary: number[]
  secondary: number[]
  annotations: Record<string, Annotation>
  stats: Stats
  pageTitle: string | null
  url: string | null
}

export type StreamEventType =
  | "heuristic"
  | "annotation"
  | "markdown_chunk"
  | "done"
  | "error"

export interface StreamEvent {
  type: StreamEventType
  data?: unknown
}

export interface EngramConfig {
  apiKey?: string
  baseUrl?: string
  timeout?: number
  /** PDF parsing can include GPU cold-start; defaults to 15 minutes. */
  pdfTimeout?: number
  fetch?: typeof fetch
}

export type PdfSource = string | Uint8Array | Blob
export interface PdfRequestInfo {
  elapsedMs: number
  requestId?: string
  origin?: "edge" | "modal" | "vast"
  cache?: string
  /** Metadata/outline cache state for PDF inspection requests. */
  inspectCache?: "hit" | "miss"
  workers?: number
  /** Desired Vast replicas; `workers` is the currently idle/routable subset. */
  workerTarget?: number
  cfRay?: string
  timings: Record<string, number>
}
export interface PdfPreflightResult {
  cache: "hit" | "miss"
  workers: number
  target: number
  /** False only when a legacy gateway has no preflight route. */
  supported: boolean
  request: PdfRequestInfo
}
export interface PdfOutlineItem { level: number; title: string; page: number }
export interface PdfInspectResult {
  documentId: string; filename: string | null; pages: number; title: string | null
  author: string | null; encrypted: boolean; outlineSource: "pdf" | "none"
  outline: PdfOutlineItem[]
  /** True when inspect also completed cache lookup and provider prewarm. */
  prepared: boolean
  /** Opaque asynchronous preparation handle; consumed by `prepare()`. */
  prepareToken?: string
  request: PdfRequestInfo
}
export interface PdfPage { page: number; markdown: string }
export interface PdfParseResult {
  documentId?: string; markdown: string; pageMarkdown: PdfPage[]; pages: number
  crops?: number; elapsed: number; metadata: Record<string, unknown>
  request: PdfRequestInfo
}
export interface PdfProgress {
  phase: "prepare" | "parse"
  state: "started" | "waiting" | "completed" | "failed"
  elapsedMs: number
  pages?: number
  workers?: number
  target?: number
  supported?: boolean
  request?: PdfRequestInfo
}
export interface PdfOptions {
  pages?: string
  /** Exact source document page count supplied to predictive prewarm. */
  pageCount?: number
  figures?: boolean
  dpi?: number
  signal?: AbortSignal
  /** Lifecycle updates for user-visible preparation and parse waits. */
  onProgress?: (event: PdfProgress) => void | Promise<void>
}
export interface PdfPrepared {
  inspect: PdfInspectResult
  preflight: PdfPreflightResult
  /** Total client-observed preparation wall time, including inspection and polling. */
  elapsedMs: number
}
export interface PdfPreparedResult extends PdfPrepared { result: PdfParseResult }

export interface ParseOptions {
  render?: boolean
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ParseHtmlOptions {
  url?: string
  signal?: AbortSignal
}
