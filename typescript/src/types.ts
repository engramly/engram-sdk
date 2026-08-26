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
  fetch?: typeof fetch
}

export type PdfSource = string | Uint8Array | Blob
export interface PdfPreflightResult { cache: "hit" | "miss" }
export interface PdfOutlineItem { level: number; title: string; page: number }
export interface PdfInspectResult {
  documentId: string; filename: string | null; pages: number; title: string | null
  author: string | null; encrypted: boolean; outlineSource: "pdf" | "none"
  outline: PdfOutlineItem[]
}
export interface PdfPage { page: number; markdown: string }
export interface PdfParseResult {
  documentId?: string; markdown: string; pageMarkdown: PdfPage[]; pages: number
  crops?: number; elapsed: number; metadata: Record<string, unknown>
}
export interface PdfOptions { pages?: string; figures?: boolean; dpi?: number; signal?: AbortSignal }

export interface ParseOptions {
  render?: boolean
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ParseHtmlOptions {
  url?: string
  signal?: AbortSignal
}
