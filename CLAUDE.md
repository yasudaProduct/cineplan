# CLAUDE.md

Claude Code はこのプロジェクトで作業する前に本ファイルを必ず読むこと。

## プロジェクト概要

複数の映画館の上映スケジュールから、1日で効率よく映画をはしご鑑賞するルートを提案するサービス。詳細は `docs/spec/01_requirements.md`。

## 絶対に守る制約（ハードルール）

以下は `docs/spec/08_compliance-policy.md` §0 の再掲。パフォーマンスや利便性を理由に自己判断で破らない。破りたくなったら実装せず人間に確認する。

1. 取得した上映スケジュールは**ルート算出の入力にのみ使う**。劇場×日付の上映一覧を返す API・画面を作らない（利用者向け・公開面が対象。管理サイト内の抽出検証表示のみ ADR-0015 の条件で許容）。
2. 予約・決済機能を作らない。予約は各劇場の公式ページへ誘導する。
3. 同一サイトへのアクセスは**5秒以上間隔**・**1劇場1日1セッション**（Cron 1回分の取込）。1セッション内で複数日分のページを取得できるのは `fetch_day_mode` が `tabs` / `url_template` の劇場のみで、**最大10ページ・ページ間5秒以上・直列**（ADR-0019）。並列化で実質頻度を上げない。
4. 抽出の再処理は R2 スナップショットから行う（複数日取得は日ごとの `_d{date}.html` も保存する）。先方サイトへの再取得は fetch 失敗時のみ。
5. robots.txt 未確認・規約未確認（`terms_checked_at` が null）の劇場を `active` にしない。
6. User-Agent を偽装しない。正直に名乗る。
7. `packages/shared` の zod スキーマが型の唯一の真実。API/DB/フロントで型を別定義しない。

## ドキュメント（docs/）

作業前に、着手するタスクが参照する docs を読む。索引と分類ルールは `docs/README.md`。フォルダは更新のライフサイクルで分かれる: `spec/`=設計マスタ（実装と食い違ったら文書を先に直す）/ `plan/`=計画（完了後は凍結）/ `decisions/`=ADR（追記専用）/ `guides/`=人間向け手順書。文書番号はフォルダ内の連番のため、引用は必ずフォルダ付き（`docs/spec/08 §3` 形式）。ADR 本文・過去のコミットに残る `docs/NN` 形式は再番前の旧通し番号（対応表は `docs/README.md`）。

| 文書 | 内容 |
|---|---|
| spec/01 | 要件定義（F-xx / N-xx） |
| spec/02 | 用語集・命名規則（**命名はこれが最優先**） |
| spec/03 | データモデル（D1/R2/KV） |
| spec/04 | API 仕様（OpenAPI） |
| spec/05 | ルート算出アルゴリズム |
| spec/06 | LLM 抽出仕様 |
| spec/07 | 画面設計 |
| spec/08 | **コンプライアンスポリシー（最重要制約）** |
| spec/09 | D1 実装詳細（マイグレーション・クエリ） |
| spec/10 | DP 実装詳細（参照実装・検算済み期待値） |
| spec/11 | 環境構成（local/st/prod）・Docker Compose・GitHub Actions |
| spec/12 | リポジトリフォルダ構成（ツリー・パッケージ依存） |
| plan/01 | 開発ロードマップ・タスク分解 |
| plan/02 | Claude Code 起動プロンプト |
| guides/01 | 人間セットアップ・運用ガイド（オーナー作業手順。**人間作業が前提のタスクは代行せず依頼する**） |

設計判断の記録（ADR-0001〜）は `docs/decisions/`（追記専用・`ADR-00NN` で引用）。

## 作業の進め方

1. `docs/plan/01_roadmap.md` のフェーズ順・タスク順に進める。先食い実装をしない。
2. 特に `P2-3`（ルート算出 DP コア）は `docs/spec/10_dp-implementation.md` §7 の期待値テスト（検算済み）が緑になるまで次に進まない。
3. スキーマ・仕様の変更が必要なら、先に `packages/shared` と該当 docs を直し、その後に実装へ反映する。実装だけ先に変えない。
4. 仕様と実装が食い違ったら docs を正とし、docs を先に直す。

## モノレポ構成

詳細は `docs/spec/12_folder-structure.md` を参照。主要パスのみ示す。

```
packages/{shared, api, ingest, web}/
mocks/{transit, slack}/
migrations/
docs/
compose.yaml
.github/workflows/{ci, deploy-st, deploy-prod}.yml
```

パッケージ依存: `@cinema/shared` ← `@cinema/{api, ingest, web}` の一方向のみ。

## 環境（3つ・詳細は docs/spec/11）

- **local**: wrangler dev（D1=SQLite）+ Docker Compose の補助スタブ。`.dev.vars` で秘密。
- **st**: クラウド動作確認 **＋ 個人利用の常用環境**（ADR-0021）。`develop` push で Actions が自動デプロイ（ADR-0016）。**Cron は ON**（取込 05:00 JST・TravelMatrix 週次・保持削除 02:00 JST）。
- **prod**: 本番。`v*` タグ + 承認ゲートでデプロイ。**一般公開時まで構築を保留**（ADR-0021。定義・手順は残置）。取込 Cron を有効にする環境は常に1つだけ（環境をまたいで1劇場1日1セッション。prod 構築時は st の取込 Cron を先に停止する）。
- st/prod の Cloudflare リソースは完全分離。IDを取り違えない。

## コマンド（P0 セットアップ時点で確定。以降タスクに応じて追記）

```
pnpm install

# ローカル補助サービス（必要分のみ選択起動）
docker compose up -d transit-stub slack-stub   # minio は任意

# 開発サーバ
pnpm -F @cinema/api dev        # :8788（wrangler dev。--persist-to で local D1/R2/KV を全パッケージ共有）
pnpm -F @cinema/ingest dev     # :8787（同上）
pnpm -F @cinema/web dev        # :5173（React Router v8 + Vite。ADR-0013。ブラウザから :8788 の API に fetch）

# 検証（CI と同一）
pnpm typecheck
pnpm lint            # Biome。自動修正は pnpm lint:fix
pnpm test            # vitest。DP 期待値（P2-3）含む

# D1 マイグレーション + seed（ローカル。api パッケージから実行）
pnpm -F @cinema/api exec wrangler d1 migrations apply cinema_hashigo --local --persist-to ../../.wrangler-state
pnpm -F @cinema/api exec wrangler d1 execute cinema_hashigo --local --persist-to ../../.wrangler-state --file ../../seeds/dev_seed.sql

# 手動取込（P1。ingest dev 起動中に。prod は cron のみ）
#   事前に packages/ingest/.dev.vars を用意（LLM_PROVIDER 等。vision は Ollama ビジョンモデル or Gemini）
curl -X POST "http://localhost:8787/admin/ingest?theaterId=thr_cnv01"
# 管理サイト（P4-2〜5。ダッシュボード/劇場マスタ/取込履歴/レビュー）はブラウザで http://localhost:8787/admin
# TravelMatrix 再生成（P4-6。ls8h Transit API・ADR-0014。ダッシュボードのボタン or ↓）
curl -X POST http://localhost:8787/admin/travel-matrix/rebuild

# ルート算出の手動確認（P2。api dev 起動中に。データは取込済みの日付で）
curl -X POST http://localhost:8788/v1/plan -H 'content-type: application/json' \
  -d '{"date":"2026-07-15","timeWindow":{"start":"09:00","end":"22:00"},"origin":{"type":"station","value":"九条"}}'

# デプロイ（通常は GitHub Actions。ST=develop push / prod=v* タグ+承認。手動時のみ↓）
pnpm -F @cinema/api exec wrangler deploy --env st
```

- リンタは Biome（`biome.json`）、テストは Vitest（`vitest.config.ts`）、型は各パッケージ `tsc --noEmit`。
- シークレット/vars は各 Worker 直下の `.dev.vars`（`packages/{api,ingest}/.dev.vars`。gitignore）。ingest は LLM/Slack を使うため要設定。
- ST/prod の実 D1/KV/R2/Queue ID は未採番（`wrangler.toml` は `REPLACE_WITH_*` プレースホルダ）。採番と反映は P4-0（ST）/ P5-7（prod）。手順は `docs/guides/01_human-setup-guide.md` §3・§5。

## コーディング方針（軽量）

- TypeScript strict。型は shared から。
- 命名は `docs/spec/02_glossary.md` に従う（Screening / Plan / Leg / Theater 等。Showtime・Route〈計画全体の意味では〉は使わない）。
- 日時は内部 UTC・表示層で JST 変換。対象日のみ JST の `YYYY-MM-DD`。
- 抽出プロンプトはバージョン付きファイル（`prompts/v{N}.ts`）。既存版は変更せず新版追加。
- シークレット（LLM APIキー・駅すぱあとキー・Slack Webhook）は local=`.dev.vars` / st・prod=`wrangler secret`。コードに直書きしない。
```
