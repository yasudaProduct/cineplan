# @cinema/ingest

映画館の上映スケジュールを取得し、LLM で抽出・検証して D1 に保存する **取込サービス**（Cloudflare Workers）。将来は管理サイト（`/admin`）も同居する（P4）。

- 公開 API（`@cinema/api`）とは **D1 の screenings データ経由でのみ疎結合**（ADR-0007）。取込が落ちても公開側は最後に成功したデータで応答継続する。
- 型は `@cinema/shared` の zod スキーマが唯一の真実（CLAUDE.md ハードルール7）。
- **最重要制約**: `docs/08_compliance-policy.md`。取得マナー・内部利用限定を破らない。

## パイプライン（1劇場1回分）

```
Cron（prod）/ 手動トリガー（dev・st）
  → Fetch      schedule ページ + スケジュール画像を取得（正直UA・同一ホスト5秒間隔・30sタイムアウト）→ R2 保存
  → Preprocess vision: 画像→base64 / text: HTML→テキスト
  → Extract    LLM 抽出（既定 Gemini / 開発 Ollama。text/vision）→ ExtractionResult(JSON)
  → Validate   zod 検証 + 妥当性検証 V1〜V6（docs/06 §5）
  → Normalize  24時超え時刻の UTC 化・endTime 補完・title_key 名寄せ
  → Write      D1 洗い替え（today〜抽出結果の最大日付を範囲に、businessDate 別 DELETE→INSERT）
  → ingest_runs に status / provider・model / トークン / 件数を記録
```

- **洗い替え範囲（stale データ防止）**: 抽出に現れた日付だけでなく `today〜抽出結果中の最大日付` を丸ごと洗い替える。休館日や上映が無くなった日、抽出が完全に空だった回も含めて古い screenings を消す（`replaceScreeningsByDate`。docs/03 §7）。

- 失敗は `fetch_failed` / `extraction_failed` / `validation_failed` に分岐。**再抽出は R2 スナップショットから**行い、先方サイトへの再取得は `fetch_failed` 時のみ（docs/06 §7）。検証NGはレビューキュー（`extraction_reviews`）へ。
- **リトライ（docs/06 §7）**: `fetch_failed` は Queue 標準リトライ（`max_retries=3`・指数バックオフ5分〜）に委ね、consumer が最終試行(3回目)でのみ Slack 通知する。`extraction_failed`（LLM APIエラー最大2回・JSONパース不能/zod NG 合算1回）は同一 Worker 呼出内で `extractVisionWithRetries` がフェッチ済み画像を使い回してリトライし、予算超過で確定・通知する（再取得はしない）。`validation_failed` はリトライなし（即レビューキュー）。
- **多層防御（docs/08）**: cron 対象は `status='active' AND robots_status='allowed' AND terms_checked_at IS NOT NULL` のみ。`ingestTheater` 冒頭でも同条件を再検証し（`assertComplianceGate`）、cron 実行時は Queue 消費時点で `status` が変わっていないか（停止依頼等）も確認する。
- 詳細仕様: `docs/06_extraction-spec.md`、書込アクセス層: `docs/11_d1-implementation.md` §4、コンプラ: `docs/08_compliance-policy.md` §2。

## ディレクトリ構成

```
src/
├── index.ts              # Worker エントリ: fetch(/healthz, POST /admin/ingest) / scheduled(cron dispatch) / queue consumer
├── env.ts                # Env（bindings + vars/secret。ADMIN_TOKEN 含む）
├── admin-auth.ts         # isAdminAuthorized（/admin/ingest 保護。local 以外は ADMIN_TOKEN 必須・fail closed）
├── llm/                  # 抽出クライアント抽象化（provider × 方式。ADR-0011/0012）
│   ├── types.ts          #   ExtractInput{text?|images?} / LlmResult / LlmClient
│   ├── gemini.ts         #   Gemini generateContent（responseSchema・inline 画像）
│   ├── ollama.ts         #   Ollama /api/chat（format=json・images[]）※開発専用
│   └── index.ts          #   createLlmClient(LLM_PROVIDER 分岐) / stripJsonFence
├── extraction/prompts/
│   └── vision_v1.ts      # 画像抽出プロンプト（バージョン固定・既存版変更禁止）
├── worker/               # 取込パイプライン各ステップ
│   ├── fetch.ts          #   HTTP 取得（取得マナー）+ schedule 画像URL抽出
│   ├── preprocess.ts     #   imagesToParts(画像→base64) / htmlToText
│   ├── extract.ts        #   extractVision / extractVisionWithRetries（LLM 呼出＋リトライ）
│   ├── validate.ts       #   parseExtraction(zod) / validateExtracted(V1/2/5/6) / validateNormalized(V3/4)
│   ├── normalize.ts      #   normalize / inBusinessWindow
│   ├── notify.ts         #   sendSlack
│   ├── compliance-guard.ts #   assertComplianceGate（robots/terms/status の多層防御。docs/08）
│   ├── errors.ts         #   TheaterNotFoundError / ComplianceGateError（恒久的失敗＝リトライ対象外）
│   └── pipeline.ts       #   ingestTheater（統合オーケストレーター）
└── db/                   # D1 アクセス層（docs/11 §4）
    ├── ingest-runs.ts    #   IngestRun ライフサイクル
    ├── movies.ts         #   resolveMovieId（名寄せ UPSERT）
    ├── screenings.ts     #   replaceScreenings / replaceScreeningsByDate（洗い替え）
    ├── theaters.ts       #   getTheater / listActiveTheaters
    └── reviews.ts        #   createReview / recentAvgCount（V2 履歴平均）
```

## LLM プロバイダ抽象化（ADR-0011 / 0012）

`LLM_PROVIDER` と `model` を設定値で切替える。`provider`（`gemini` | `ollama` | `workers-ai` | `anthropic`）× 方式（`text` | `vision`）。

| 用途 | provider | 備考 |
|---|---|---|
| **本番 / ST** | `gemini`（Gemini Flash 無料枠） | 品質の基準（`GEMINI_API_KEY`） |
| **開発** | `ollama`（ローカル・無料・オフライン） | vision はビジョン対応モデル要（例 `qwen2.5vl:7b`） |

- **抽出方式は劇場ごと**（`theaters.extract_method` = `text` | `vision`）。ミニシアターは月間スケジュール画像を **vision** で抽出する（ADR-0012）。
- **品質の確定は必ず Gemini で**行う（「Ollama で通った ≠ Gemini で通る」。ADR-0011）。1館目シネ・ヌーヴォは Gemini 実データで検証済み。

## コンプライアンス（`docs/08` §0・§3）

- 同一ホストへ **最低5秒間隔**・**1劇場1日1回**。並列化で実質頻度を上げない。
- User-Agent は **正直に名乗る**（偽装しない）。`CinemaHashigoBot/0.1 (+https://<domain>/bot)`。
- robots.txt / 規約未確認（`terms_checked_at` が null）の劇場を `active` にしない。新規は **paused 起票 → 手動取込 → レビュー全件目視 → 3日連続成功で active**（`docs/16` §2.2）。
- 取得した画像・生HTMLは再配布しない（R2 保存は内部の再抽出用のみ）。

## ローカル開発

```bash
# 1) シークレット/vars（このディレクトリ直下。gitignore）
cp ../../.dev.vars.example .dev.vars    # LLM_PROVIDER / GEMINI_API_KEY 等を記入
#    vision を開発で試すなら: ollama pull qwen2.5vl:7b（OLLAMA_MODEL=qwen2.5vl:7b）

# 2) D1 マイグレーション + seed（api パッケージから・リポジトリルートで）
pnpm -F @cinema/api exec wrangler d1 migrations apply cinema_hashigo --local --persist-to ../../.wrangler-state
pnpm -F @cinema/api exec wrangler d1 execute  cinema_hashigo --local --persist-to ../../.wrangler-state --file ../../seeds/dev_seed.sql

# 3) 補助サービス（Slack 通知を見る場合）
docker compose up -d slack-stub

# 4) 開発サーバ
pnpm -F @cinema/ingest dev              # → http://localhost:8787

# 5) 手動取込（dev/st のみ。prod は cron）
curl -X POST "http://localhost:8787/admin/ingest?theaterId=thr_cnv01"
#   → {"runId":"...","status":"succeeded","extractedCount":N,"writtenCount":N}

# 結果確認
pnpm -F @cinema/api exec wrangler d1 execute cinema_hashigo --local --persist-to ../../.wrangler-state \
  --command "SELECT business_date, start_at, screen_name FROM screenings ORDER BY start_at LIMIT 10"
```

## テスト・検証

```bash
pnpm -F @cinema/ingest typecheck
pnpm test          # ルートから全パッケージ（vitest）。ingest は normalize/validate/fetch/llm を録画リプレイでテスト
pnpm lint          # Biome
```

- LLM 呼出を含むテストは CI では実 API を叩かない（録画リプレイ。docs/06 §9）。実抽出の品質確認は手動トリガー + Gemini で行う。

## エンドポイント

| Method | Path | 用途 |
|---|---|---|
| GET | `/healthz` | 死活監視 |
| POST | `/admin/ingest?theaterId=` | 手動取込（dev/st のみ。prod は 403）。**local 以外は `x-admin-token` ヘッダが `ADMIN_TOKEN` と一致しないと 401**（Access 投入前の唯一の防御。docs/09 P4-0・docs/16 §3.6） |

Cron（prod のみ・`docs/14`）は `robots_status='allowed'` かつ `terms_checked_at` 設定済みの active 劇場のみ Queue 投入し、consumer が同じパイプラインを実行する（docs/08 の多層防御）。

## 環境変数

| 種別 | 変数 | 備考 |
|---|---|---|
| binding | `DB` / `KV` / `SNAPSHOTS`(R2) / `INGEST_QUEUE` | `wrangler.toml` |
| var | `APP_ENV` / `LLM_PROVIDER` / `GEMINI_MODEL` / `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | 非機密 |
| secret | `GEMINI_API_KEY` / `SLACK_WEBHOOK_URL` / `ADMIN_TOKEN` | local=`.dev.vars` / st・prod=`wrangler secret`。`ADMIN_TOKEN` は local 以外必須 |

## 関連ドキュメント

- `docs/06_extraction-spec.md` — 抽出パイプライン・プロンプト・検証 V1〜V6
- `docs/08_compliance-policy.md` — 取得マナー・内部利用限定（最重要）
- `docs/11_d1-implementation.md` — D1 書込アクセス層・マイグレーション
- `docs/03_data-model.md` — スキーマ（theaters / screenings / ingest_runs 等）
- `docs/10_adr/0001-0012.md` — ADR-0007（取込分離）/ 0011（LLM）/ 0012（画像 vision 抽出）
