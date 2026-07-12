import type { Config } from '@react-router/dev/config'

export default {
  // SSR 有効（P5-2 の共有ページ OGP に必要。ADR-0013）
  ssr: true,
} satisfies Config
