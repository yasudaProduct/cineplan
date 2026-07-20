import type { ContentfulStatusCode } from 'hono/utils/http-status'

// API エラー（docs/04 のエラーコード体系: VALIDATION_ERROR / DATA_NOT_READY / RATE_LIMITED / INTERNAL）
export class ApiHttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'ApiHttpError'
  }
}
