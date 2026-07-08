# CLAUDE.md

Claude Code はこのプロジェクトで作業する前に本ファイルを必ず読むこと。

## プロジェクト概要

複数の映画館の上映スケジュールから、1日で効率よく映画をはしご鑑賞するルートを提案するサービス。詳細は `docs/01_requirements.md`。

## 絶対に守る制約（ハードルール）

以下は `docs/08_compliance-policy.md` §0 の再掲。パフォーマンスや利便性を理由に自己判断で破らない。破りたくなったら実装せず人間に確認する。

1. 取得した上映スケジュールは**ルート算出の入力にのみ使う**。劇場×日付の上映一覧を返す API・画面を作らない。
2. 予約・決済機能を作らない。予約は各劇場の公式ページへ誘導する。
3. 同一サイトへのアクセスは**5秒以上間隔・1劇場1日1回**。並列化で実質頻度を上げない。
4. 抽出の再処理は R2 スナップショットから行う。先方サイトへの再取得は fetch 失敗時のみ。
5. robots.txt 未確認・規約未確認（`terms_checked_at` が null）の劇場を `active` にしない。
6. User-Agent を偽装しない。正直に名乗る。
7. `packages/shared` の zod スキーマが型の唯一の真実。API/DB/フロントで型を別定義しない。

## ドキュメント（docs/）

作業前に、着手するタスクが参照する docs を読む。索引は `docs/README.md`。

| 番号 | 内容 |
|---|---|
| 01 | 要件定義（F-xx / N-xx） |
| 02 | 用語集・命名規則（**命名はこれが最優先**） |
| 03 | データモデル（D1/R2/KV） |
| 04 | API 仕様（OpenAPI） |
| 05 | ルート算出アルゴリズム |
| 06 | LLM 抽出仕様 |
| 07 | 画面設計 |
| 08 | **コンプライアンスポリシー（最重要制約）** |
| 09 | 開発ロードマップ・タスク分解 |
| 10 | ADR（決定と理由） |
| 11 | D1 実装詳細（マイグレーション・クエリ） |
| 12 | DP 実装詳細（参照実装・検算済み期待値） |
| 13 | Claude Code 起動プロンプト |
| 14 | 環境構成（local/st/prod）・Docker Compose・GitHub Actions |

## 作業の進め方

1. `docs/09_roadmap.md` のフェーズ順・タスク順に進める。先食い実装をしない。
2. 特に `P2-3`（ルート算出 DP コア）は `docs/12_dp-implementation.md` §7 の期待値テスト（検算済み）が緑になるまで次に進まない。
3. スキーマ・仕様の変更が必要なら、先に `packages/shared` と該当 docs を直し、その後に実装へ反映する。実装だけ先に変えない。
4. 仕様と実装が食い違ったら docs を正とし、docs を先に直す。

## モノレポ構成

詳細は `docs/15_folder-structure.md` を参照。主要パスのみ示す。

```
packages/{shared, api, ingest, web}/
mocks/{transit, slack}/
migrations/
docs/
compose.yaml
.github/workflows/{ci, deploy-st, deploy-prod}.yml
```

パッケージ依存: `@cinema/shared` ← `@cinema/{api, ingest, web}` の一方向のみ。

## 環境（3つ・詳細は docs/14）

- **local**: wrangler dev（D1=SQLite）+ Docker Compose の補助スタブ。`.dev.vars` で秘密。
- **st**: クラウド動作確認。`main` push で Actions が自動デプロイ。Cron は原則OFF。
- **prod**: 本番。`v*` タグ + 承認ゲートでデプロイ。
- st/prod の Cloudflare リソースは完全分離。IDを取り違えない。

## コマンド（実装が進んだら確定・更新）

```
pnpm install
docker compose up -d minio transit-stub slack-stub   # ローカル補助（必要分のみ）
pnpm -F @app/api dev          # コアAPI ローカル起動 (wrangler dev)
pnpm -F @app/ingest dev
pnpm -F @app/web dev
pnpm test                     # 全パッケージのテスト（DP期待値含む）
pnpm typecheck && pnpm lint
wrangler d1 migrations apply cinema_hashigo --local          # local
wrangler d1 migrations apply cinema_hashigo_st --env st --remote     # ST（通常はActions経由）
wrangler deploy --env st      # 手動デプロイ時（通常はActions経由）
```

（コマンド名は P0 セットアップ時に確定させ、本節を更新すること。）

## コーディング方針（軽量）

- TypeScript strict。型は shared から。
- 命名は `docs/02_glossary.md` に従う（Screening / Plan / Leg / Theater 等。Showtime・Route〈計画全体の意味では〉は使わない）。
- 日時は内部 UTC・表示層で JST 変換。対象日のみ JST の `YYYY-MM-DD`。
- 抽出プロンプトはバージョン付きファイル（`prompts/v{N}.ts`）。既存版は変更せず新版追加。
- シークレット（LLM APIキー・駅すぱあとキー・Slack Webhook）は local=`.dev.vars` / st・prod=`wrangler secret`。コードに直書きしない。
```
