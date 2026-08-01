# ADR-0001: Cloudflare をプラットフォームに採用
- Status: Accepted
- Date: 2026-07-07

## Context
個人・スモールスタートでランニングコストを最小化したい（N-04: 月3,000円以内）。取込・API・管理・Web の4コンポーネントを同一基盤で完結させたい。開発者の希望も Cloudflare。

## Decision
Workers / D1 / R2 / KV / Queues / Cron / Browser Rendering / Pages / Access を全面採用する。

## Consequences
- VPS・RDS を持たず、固定費は Workers Paid $5/月 が実質下限。R2 はエグレス無料でスナップショット保存に好適。
- Access で管理サイト認証を自前実装せず済む。
- 制約: Workers の CPU 時間上限があるため、DP の計算量に上限設計が必要（ADR-0006 で対応）。Node 専用ライブラリは使えない。

## Alternatives considered
- AWS（Lambda + RDS + S3）: 既存知見はあるが固定費と運用が重い。スモールスタートに不向き。
- Vercel + 外部DB: エッジ実行は良いが、Queues/Cron/オブジェクトストレージまで一体で揃う Cloudflare が本件では有利。
