/** Error hierarchy for the Engram SDK. */

import type { PdfPrepared, PdfRequestInfo } from "./types.js"

export class EngramError extends Error {
  code?: string

  constructor(message: string, options?: { code?: string }) {
    super(message)
    this.name = "EngramError"
    this.code = options?.code
  }
}

export class AuthError extends EngramError {
  constructor(message: string) {
    super(message, { code: "auth" })
    this.name = "AuthError"
  }
}

export class RateLimitError extends EngramError {
  retryAfter?: number

  constructor(message: string, options?: { retryAfter?: number }) {
    super(message, { code: "rate_limited" })
    this.name = "RateLimitError"
    this.retryAfter = options?.retryAfter
  }
}

export class APIError extends EngramError {
  status: number
  /** PDF phase that returned the error, when applicable. */
  phase?: "inspect" | "preflight" | "parse"
  /** Sanitized gateway telemetry from the failed response. */
  request?: PdfRequestInfo
  /** Successful preparation retained when the subsequent parse fails. */
  prepared?: PdfPrepared

  constructor(message: string, options: { status: number; code?: string; phase?: APIError["phase"]; request?: PdfRequestInfo }) {
    super(message, { code: options.code })
    this.name = "APIError"
    this.status = options.status
    this.phase = options.phase
    this.request = options.request
  }
}
