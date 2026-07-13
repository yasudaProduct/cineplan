# Architecture Decision Records (ADR)

重要な設計判断とその理由を記録する。**一度記録した決定は、理由ごと覆す価値があると判断したときだけ変更し、その際は新しい ADR（Supersedes 付き）を追加する。** 既存 ADR は消さない。

Claude Code は、ここに記録された決定（特に内部利用限定・事前計算行列）を安易に「最適化」で覆さないこと。

## 一覧

| ADR | タイトル | ステータス |
|---|---|---|
| 0001 | Cloudflare をプラットフォームに採用 | Accepted |
| 0002 | 上映スケジュールは内部利用限定とする | Accepted |
| 0003 | 上映抽出を LLM ベース（構造非依存）で行う | Accepted |
| 0004 | 抽出モデルに Claude Haiku を採用 | Superseded by 0011 |
| 0005 | 劇場間移動時間を事前計算行列で持つ | Accepted |
| 0006 | ルート算出をビットマスク DP で解く | Accepted |
| 0007 | 取込サービスを公開サービスから分離する | Accepted |
| 0008 | カレンダー連携を URL テンプレート方式で行う | Accepted |
| 0009 | 開発DBはD1のまま、Docker Composeは周辺サービス用 | Accepted |
| 0010 | 3環境(local/st/prod)と GitHub Actions デプロイ | Accepted |
| 0011 | 抽出 LLM を Gemini Flash（無料枠）に変更（0004 を Supersede） | Accepted |
| 0012 | 画像スケジュールをマルチモーダルLLMで抽出（0003 を拡張） | Accepted |
| 0013 | Web を React Router v8（旧 Remix）+ Workers で実装（Next.js/Pages 想定を変更） | Accepted |
| 0014 | 移動時間の解決に ls8h Transit API（無料・非公式）を採用（0005 の行列生成手段を確定） | Accepted |

## テンプレート（新規追加時にコピー）

```
# ADR-XXXX: タイトル
- Status: Proposed | Accepted | Superseded by ADR-YYYY
- Date: YYYY-MM-DD

## Context
（どんな問題・制約があったか）

## Decision
（何を決めたか）

## Consequences
（結果・トレードオフ・受け入れたリスク）

## Alternatives considered
（検討して不採用にした案と理由）
```
