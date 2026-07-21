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
               text は日単位分割（日付発見コール→日別抽出コール→マージ。text_v2・ADR-0017）
  → Validate   zod 検証 + 妥当性検証 V1〜V6（docs/06 §5）
  → Normalize  24時超え時刻の UTC 化・endTime 補完・title_key 名寄せ
  → Write      D1 洗い替え（today〜抽出結果の最大日付を範囲に、businessDate 別 DELETE→INSERT）
  → ingest_runs に status / provider・model / トークン / 件数を記録
```

- **洗い替え範囲（stale データ防止）**: 抽出に現れた日付だけでなく `today〜抽出結果中の最大日付` を丸ごと洗い替える。休館日や上映が無くなった日、抽出が完全に空だった回も含めて古い screenings を消す（`replaceScreeningsByDate`。docs/03 §7）。

- 失敗は `fetch_failed` / `extraction_failed` / `validation_failed` に分岐。**再抽出は R2 スナップショットから**行い、先方サイトへの再取得は `fetch_failed` 時のみ（docs/06 §7）。検証NGはレビューキュー（`extraction_reviews`）へ。
- **リトライ（docs/06 §7）**: `fetch_failed` は Queue 標準リトライ（`max_retries=3`・指数バックオフ5分〜）に委ね、consumer が最終試行(3回目)でのみ Slack 通知する。`extraction_failed`（LLM APIエラー最大2回・JSONパース不能/zod NG 合算1回。**text 日分割では LLM 呼出ごとに独立適用**）は同一 Worker 呼出内で `extractVisionWithRetries` / `extractTextDaySplit` がフェッチ済み入力を使い回してリトライし、予算超過で確定・通知する（再取得はしない）。text 日分割はさらに run 内の抽出合計10分デッドラインを持つ（ADR-0017）。`validation_failed` はリトライなし（即レビューキュー）。
- **多層防御（docs/08）**: cron 対象は `status='active' AND robots_status='allowed' AND terms_checked_at IS NOT NULL` のみ。`ingestTheater` 冒頭でも同条件を再検証し（`assertComplianceGate`）、cron 実行時は Queue 消費時点で `status` が変わっていないか（停止依頼等）も確認する。
- 詳細仕様: `docs/06_extraction-spec.md`、書込アクセス層: `docs/11_d1-implementation.md` §4、コンプラ: `docs/08_compliance-policy.md` §2。

## ログ・観測性（Workers Logs）

全ステージが構造化ログ（`src/log.ts`: `console.log/error` に `{event, ...fields}` の単一オブジェクトを渡す）を出力し、**Workers Logs**（`wrangler.toml` の `[observability]`。3環境とも有効・サンプリング100%・保持は Workers Paid で7日）でフィールド検索できる。ログの見方・調査手順は `docs/16` §6。

**イベント台帳（正本）**:

| event | 発火箇所 | 主フィールド |
|---|---|---|
| `queue.ingest.start` / `.done` / `.retry` | queue consumer（index.ts） | theaterId, runId, trigger, attempt, status, delaySeconds |
| `queue.reextract.start` / `.done` | 〃 | sourceRunId, runId, status |
| `queue.invalid_message` / `queue.error` | 〃 | keys / error（恒久的失敗の ack 打ち切り） |
| `cron.dispatch.done` | scheduled（index.ts） | theaters |
| `run.start` | pipeline / reextract | runId, theaterId, trigger, businessDate, fetchMethod, extractMethod, sourceRunId・inputChars・images（再抽出） |
| `run.fetch.ok` / `.fail` | pipeline | runId, ms, htmlChars, images |
| `run.snapshot.saved` | pipeline | runId, prefix, images |
| `run.extract.ok` / `.fail` | pipeline / reextract | runId, ms, model, inTokens, outTokens, screenings |
| `run.validate.ng` | 〃 | runId, code, detail |
| `run.done` | 〃（**全終端で必ず1回**） | runId, theaterId, status, extracted, written, error |
| `llm.call.ok` / `.fail` | llm/gemini.ts・ollama.ts | provider, model, ms, **kind（timeout / http / network）**, status, inTokens, outTokens, rawChars |
| `llm.retry` / `llm.giveup` | worker/extract.ts | kind（api / parse / schema）, 残リトライ数, apiFailures, malformedFailures |
| `extract.dates.ok` | worker/extract.ts（text 日分割の日付発見。ADR-0017） | dates, ms, inTokens, outTokens |
| `extract.dates.truncated` | 〃（発見日付が上限超過） | found, cap |
| `extract.day.ok` | 〃（日別抽出の1日分完了） | date, screenings, droppedOffDate, ms, inTokens, outTokens |
| `extract.deadline.exceeded` | 〃（抽出デッドライン超過で打ち切り） | elapsedMs, deadlineMs, doneDays, totalDays |
| `admin.enqueue.ingest` / `.reextract`・`admin.ingest.sync`・`admin.theater.status`・`admin.review.approve` / `.reject`・`admin.matrix.rebuild` | admin/index.tsx（書込み系アクションのみ。閲覧はログしない） | theaterId, sourceRunId, force, from/to, reviewId, written |
| `reap.done` | /admin ダッシュボード読込時 | count, runIds（孤児 run 掃除の記録） |
| `matrix.pair.fail` / `.empty`・`matrix.done` | cron/travel-matrix.ts | pair, kind, status / theaters, pairs, updated, carried, missing, ms |
| `slack.fail` | worker/notify.ts | status（通知失敗の可視化。本処理は止めない） |
| `http.error` | Hono onError（index.ts） | method, path, error |

- 調査の起点: `event="run.done"` で結果一覧 → 気になる `runId` でフィルタ → 1回の取込の全行程を時系列で読む。
- LLM 失敗は分類済み（`llm.call.fail` の kind と、D1 `error_message` の分類済み文言）。**429=レート制限・timeout=応答なしハング** を error_message 単体で判別できる。
- **ガードレール**: シークレット・HTML/プロンプト/LLM生出力の本文はログに載せない（サイズのみ。本文は R2 スナップショットと reviews.payload_json が正）。エラー断片は500字上限。

## ディレクトリ構成

```
src/
├── index.ts              # Worker エントリ（Hono）: /healthz・/admin 配下 / scheduled(cron dispatch) / queue consumer
├── env.ts                # Env（bindings + vars/secret。ADMIN_TOKEN 含む）
├── log.ts                # 構造化ログ（logInfo/logError。イベント台帳は本 README 上記）
├── llm/                  # 抽出クライアント抽象化（provider × 方式。ADR-0011/0012）
│   ├── types.ts          #   ExtractInput{text?|images?} / LlmResult / LlmClient
│   ├── gemini.ts         #   Gemini generateContent（responseSchema・inline 画像）
│   ├── ollama.ts         #   Ollama /api/chat（format=json・images[]）※開発専用
│   └── index.ts          #   createLlmClient(LLM_PROVIDER 分岐) / stripJsonFence
├── extraction/prompts/   # プロンプト（バージョン固定・既存版変更禁止）
│   ├── vision_v1.ts      #   画像抽出
│   ├── text_v1.ts        #   HTML 全日付一括抽出（本番経路からは引退。履歴・再現用に残置）
│   └── text_v2.ts        #   HTML 日単位分割（日付発見 + 日別抽出。ADR-0017）
├── worker/               # 取込パイプライン各ステップ
│   ├── fetch.ts          #   HTTP 取得（取得マナー）+ schedule 画像URL抽出
│   ├── preprocess.ts     #   imagesToParts(画像→base64) / htmlToText
│   ├── extract.ts        #   extractVisionWithRetries / extractTextDaySplit（LLM 呼出＋リトライ＋日分割）
│   ├── validate.ts       #   parseExtraction(zod) / validateExtracted(V1/2/5/6) / validateNormalized(V3/4)
│   ├── normalize.ts      #   normalize / inBusinessWindow
│   ├── write.ts          #   normalizeResolveWrite（通常書込パス。取込/承認/再抽出が共用）
│   ├── reextract.ts      #   reextractFromSnapshot（R2 から再抽出。F-21・先方再取得なし）
│   ├── notify.ts         #   sendSlack
│   ├── compliance-guard.ts #   assertComplianceGate（robots/terms/status の多層防御。docs/08）
│   ├── errors.ts         #   TheaterNotFoundError / ComplianceGateError（恒久的失敗＝リトライ対象外）
│   └── pipeline.ts       #   ingestTheater（統合オーケストレーター）
├── admin/                # 管理サイト（P4-2〜P4-5。docs/07 §2。Hono JSX・SSRのみ・client JSなし）
│   ├── index.tsx         #   ルート集約（dashboard/theaters/runs/reviews + POST アクション + /admin/r2/*）
│   ├── guard.ts          #   adminGuard（local スキップ / token or Access JWT ヘッダ。docs/14 §4）
│   ├── components.tsx    #   Layout・StatusChip・Flash・sparkline 等
│   └── pages/            #   dashboard.tsx / theaters.tsx / runs.tsx / reviews.tsx
└── db/                   # D1 アクセス層（docs/11 §4）
    ├── ingest-runs.ts    #   IngestRun ライフサイクル + 一覧/詳細/直近streak/本日取得数
    ├── movies.ts         #   resolveMovieId（名寄せ UPSERT）
    ├── screenings.ts     #   replaceScreeningsByDate（洗い替え）
    ├── theaters.ts       #   読取 + CRUD（新規は必ず paused・status変更は昇格ゲート経由）
    ├── reviews.ts        #   createReview / 一覧 / approveReview（通常書込パス）/ reject（メモ必須）
    └── admin-queries.ts  #   ダッシュボード集計（本日状況・鮮度・トークン日次・規約期限）
```

## LLM プロバイダ抽象化（ADR-0011 / 0012）

`LLM_PROVIDER` と `model` を設定値で切替える。`provider`（`gemini` | `ollama` | `workers-ai` | `anthropic`）× 方式（`text` | `vision`）。

| 用途 | provider | 備考 |
|---|---|---|
| **本番 / ST** | `gemini`（`GEMINI_MODEL=gemini-flash-lite-latest`・無料枠。ADR-0018） | 品質の基準（`GEMINI_API_KEY`）。最上位 Flash は無料枠の容量逼迫で不安定なため Lite 系エイリアスを使用 |
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
| GET | `/admin` | 管理サイト（ダッシュボード。P4-2） |
| GET/POST | `/admin/theaters...` | 劇場マスタ CRUD・status変更（active昇格ゲート）・手動取込（P4-3） |
| GET/POST | `/admin/runs...` | 取込履歴・詳細・R2 再抽出（P4-4） |
| GET/POST | `/admin/reviews...` | レビューキュー（承認=通常書込パス/破棄=メモ必須。P4-5） |
| GET | `/admin/r2/raw/...` | R2 スナップショット配信（レビュー突合用。保存 HTML は text/plain で返す） |
| POST | `/admin/ingest?theaterId=` | 手動取込 API（curl 用に温存。dev/st のみ。prod は 403） |

- **/admin の認証**: 一次防御はエッジの Cloudflare Access（P4-1）。コード側 `adminGuard` は local スキップ / `x-admin-token` 一致 or `Cf-Access-Jwt-Assertion` ヘッダ存在で通す（どちらも無ければ 401 = fail closed。docs/14 §4）。**Access 有効化後の ST では curl 手動取込も Access に遮られる**ため、手動取込はブラウザの管理 UI から行う（docs/16 §4.1）。
- **手動取込の 1日1回ガード（docs/08 §3）**: 当日すでに先方サイトへ取得済み（trigger=cron/manual の run が存在）の場合、UI は明示チェックボックスによる人間判断を要求する。retry（R2 再抽出）はサイトアクセスが無いためカウントしない。
- **手動取込（UI）は Queue 経由**（`trigger='manual'`）: ブラウザ接続に処理を同期させると、rendered＋LLM抽出の途中で接続が切れた際に Workers が実行をキャンセルし `extracting` のまま孤児化する不具合があったため、cron と同じ consumer 経路に統一（06 §7）。押下直後は投入確認のみ表示し、結果は直近取込一覧で確認する。保険として `reapStaleRuns()` が 30分以上停止した run を `/admin` 読込時に打ち切る（text 日分割の正常上限より上。ADR-0017）。`POST /admin/ingest`（curl 用）のみ同期実行のまま。

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
