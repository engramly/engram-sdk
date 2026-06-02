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

export interface ParseOptions {
  render?: boolean
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ParseHtmlOptions {
  url?: string
  signal?: AbortSignal
}
