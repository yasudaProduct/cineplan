import { describe, expect, it } from 'vitest'
import app from '../index'

// web（別オリジン）からのブラウザ fetch を許可する CORS（docs/spec/04 設計メモ6）。

describe('CORS on /v1/*', () => {
  it('preflight (OPTIONS) に Access-Control-Allow-Origin: * を返す', async () => {
    const res = await app.request('/v1/plan', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
  })

  it('/healthz は CORS 対象外（/v1/* のみ）', async () => {
    const res = await app.request('/healthz', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
