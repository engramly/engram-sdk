/** Error hierarchy for the Engram SDK. */

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

  constructor(message: string, options: { status: number; code?: string }) {
    super(message, { code: options.code })
    this.name = "APIError"
    this.status = options.status
  }
}
