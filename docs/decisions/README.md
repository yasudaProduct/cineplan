# Architecture Decision Records (ADR)

重要な設計判断とその理由を記録する。**一度記録した決定は、理由ごと覆す価値があると判断したときだけ変更し、その際は新しい ADR（Supersedes 付き）を追加する。** 既存 ADR は消さない。

Claude Code は、ここに記録された決定（特に内部利用限定・事前計算行列）を安易に「最適化」で覆さないこと。

spec との線引き（詳細は `docs/README.md` の分類ルール）: 「今こうである」（現行の規範・制約）は `spec/` 側に、「なぜそうしたか・何を捨てたか」（経緯・非採用案）はここに記録する。1 判断 = 1 ファイル（`00NN-slug.md`）。

**旧番号引用について**: ADR は追記専用のため、本文中の `docs/NN §M` 形式の引用は記録時点の旧通し番号（2026-07-29 再番前）のまま残している。旧→新の対応表は `docs/README.md` の採番ルールを参照。

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
| 0015 | 管理サイトに抽出検証用の上映データ表示を追加（0002 のスコープ明確化） | Accepted |
| 0016 | ST 自動デプロイ契機を `main` push から `develop` push に変更（0010 の訂正） | Accepted |
| 0017 | text 抽出を日単位分割呼出に変更（タイムアウト根治。vision は 0012 のまま） | Accepted |
| 0018 | ST/prod の抽出モデルを `gemini-flash-lite-latest` に変更（0011 の更新） | Accepted |
| 0019 | 劇場ごとの複数日取得（日付タブ / URLテンプレート）と取得マナーの単位改定（0003 の構造非依存は維持） | Accepted |
| 0020 | 抽出モデルを vision / text で分離し日付誤りの検証を追加（0018 の適用範囲を text に限定） | Accepted |
| 0021 | ST を個人利用の常用環境とし prod 構築を一般公開時まで保留（0010 の運用変更） | Accepted |

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
