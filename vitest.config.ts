import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // web は React Router 構成のため app/ 配下（ADR-0013）。テスト対象は純粋ロジックのみ。
    include: ['packages/*/src/**/*.{test,spec}.ts', 'packages/web/app/**/*.{test,spec}.ts'],
    passWithNoTests: true,
  },
})
