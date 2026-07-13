# リポジトリフォルダ構成

- Version: 0.1
- 関連: `CLAUDE.md`（コマンド・制約）/ `09_roadmap.md`（P0-1 で実際に作る）/ `14_environments-deploy.md`（Compose / Actions）
- **本ドキュメントが構成の正とする。** 実装時に追加が必要なファイルは追加してよいが、削除・移動・命名変更は本書を先に更新してから行う。
- 実リポジトリのディレクトリ名は `cineplan`（GitHub: `yasudaProduct/cineplan`）。ツリー先頭の `cinema-hashigo/` は論理名であり、ルートディレクトリ名の変更は不要。

## ツリー

```
cinema-hashigo/                          # リポジトリルート
│
├── CLAUDE.md                            # Claude Code エントリポイント（全制約・コマンド）
├── compose.yaml                         # ローカル補助サービス（MinIO / transit-stub / slack-stub）
├── .dev.vars                            # ローカル秘密（gitignore 対象。コミットしない）
├── .gitignore
├── package.json                         # pnpm workspace ルート
├── pnpm-workspace.yaml
├── tsconfig.base.json                   # 全パッケージ共通 TS 設定（strict: true）
│
├── packages/
│   │
│   ├── shared/                          # 全パッケージ共有: zod スキーマ・型・ユーティリティ
│   │   ├── package.json                 # name: @cinema/shared
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                 # 全 export の re-export
│   │       ├── schemas/
│   │       │   ├── theater.ts           # Theater（zod）
│   │       │   ├── movie.ts             # Movie
│   │       │   ├── screening.ts         # Screening / CandidateScreening
│   │       │   ├── plan.ts              # PlanRequest / Plan / Leg（ScreeningLeg / TravelLeg / WaitLeg）/ Score / PlanLabel
│   │       │   ├── extraction.ts        # ExtractionResult / ExtractedScreening
│   │       │   ├── ingest.ts            # ExtractMethod / IngestRunStatus / TheaterRecord / NormalizedScreening 等
│   │       │   └── kv.ts                # TravelMatrix / StationGeo（KV 値の契約。ingest が書き api が読む。03 §5）
│   │       └── utils/
│   │           ├── id.ts                # newId()（nanoid ベース、プレフィックス付き短ID）
│   │           ├── time.ts              # normalizeStart() / toBusinessDate() / titleKey()
│   │           └── compare.ts           # compareScore() / isBetter()（DP 比較関数の唯一の実装）
│   │
│   ├── api/                             # コア API（Cloudflare Workers + Hono）
│   │   ├── package.json                 # name: @cinema/api
│   │   ├── tsconfig.json
│   │   ├── wrangler.toml                # バインディング定義（local / [env.st] / [env.prod]）
│   │   └── src/
│   │       ├── index.ts                 # Hono アプリ生成・ルート登録・レート制限
│   │       ├── routes/
│   │       │   ├── theaters.ts          # GET /v1/theaters
│   │       │   ├── movies.ts            # GET /v1/movies?date=（上映時刻を返さない: 原則1）
│   │       │   ├── plan.ts              # POST /v1/plan（infeasible も 200 で返す）
│   │       │   └── plans.ts             # POST /v1/plans / GET /v1/plans/:id / GET /v1/plans/:id/ics
│   │       ├── planner/                 # ルート算出コア（12_dp-implementation.md）
│   │       │   ├── types.ts             # Candidate / Score / Entry / PlanContext
│   │       │   ├── travel.ts            # TravelResolver（KV 行列参照 + origin/dest 動的解決）
│   │       │   ├── dp.ts                # runDp()（ビットマスク DP 本体）
│   │       │   ├── kbest.ts             # selectPlans()（k-best 列挙 + ラベリング）
│   │       │   ├── build.ts             # Entry → API Plan（legs 配列）変換
│   │       │   ├── index.ts             # plan() エントリ・infeasible 判定
│   │       │   └── __tests__/
│   │       │       ├── dp.spec.ts       # 12 §7 検算済み期待値テスト ← 最重要・値を変えない
│   │       │       ├── travel.spec.ts
│   │       │       └── build.spec.ts
│   │       └── db/                      # D1 読取専用アクセス層（11 §5）
│   │           ├── screenings.ts        # loadCandidates()
│   │           ├── theaters.ts          # listTheaters()
│   │           ├── movies.ts            # listMovies()（時刻なし）
│   │           └── shared-plans.ts      # sharePlan() / getPlan() / getIcs()
│   │
│   ├── ingest/                          # 取込サービス + 管理サイト（Workers + Hono+JSX）
│   │   ├── package.json                 # name: @cinema/ingest
│   │   ├── tsconfig.json
│   │   ├── wrangler.toml                # Cron / Queues 含む（local / [env.st] / [env.prod]）
│   │   └── src/
│   │       ├── index.ts                 # Worker エントリ（Cron / Queue consumer / /admin fetch ハンドラ振分）
│   │       ├── cron/
│   │       │   ├── dispatch.ts          # 劇場リストを Queues に投入（劇場単位にジョブ分割）
│   │       │   └── travel-matrix.ts     # 劇場間移動時間行列の週次計算 → KV 保存（ls8h Transit API。ADR-0014）
│   │       ├── llm/                     # 抽出クライアント抽象化（provider×方式。ADR-0011/0012）
│   │       │   ├── types.ts             # ExtractInput{ text? | images? } / LlmResult（tokens 含む）
│   │       │   ├── gemini.ts            # Gemini generateContent（responseSchema・inline_data 画像）
│   │       │   ├── ollama.ts            # Ollama /api/chat（format=JSON・images[]）
│   │       │   └── index.ts             # LLM_PROVIDER 分岐・トークン記録
│   │       ├── worker/                  # 取込パイプライン各ステップ
│   │       │   ├── fetch.ts             # HTML/画像 取得（static / rendered・UA・間隔遵守）
│   │       │   ├── preprocess.ts        # text: HTML→テキスト / vision: 画像→base64（06 §2）
│   │       │   ├── extract.ts           # llm 呼出 + リトライ extractVisionWithRetries（06 §3-4・§7）
│   │       │   ├── validate.ts          # zod 検証 + 妥当性検証 V1〜V6（06 §5）
│   │       │   ├── normalize.ts         # 24時超え正規化・endTime 補完・titleKey 名寄せ（06 §6）
│   │       │   ├── write.ts             # 正規化→movie解決→洗い替えの通常書込パス（承認/再抽出も同一関数）
│   │       │   ├── reextract.ts         # R2 スナップショットからの再抽出（F-21。先方再取得なし）
│   │       │   ├── compliance-guard.ts  # robots/terms/status の多層防御（08 §0・§2）
│   │       │   ├── errors.ts            # TheaterNotFoundError / ComplianceGateError
│   │       │   ├── notify.ts            # Slack 通知
│   │       │   └── pipeline.ts          # ingestTheater（統合オーケストレーター）
│   │       ├── extraction/prompts/
│   │       │   ├── text_v1.ts           # HTML 抽出プロンプト v1（バージョン固定・既存版変更禁止）
│   │       │   └── vision_v1.ts         # 画像抽出プロンプト v1（ADR-0012）
│   │       ├── db/                      # D1 書込アクセス層（11 §4）
│   │       │   ├── ingest-runs.ts       # IngestRun ライフサイクル + 一覧/詳細/直近streak（管理用読取）
│   │       │   ├── movies.ts            # resolveMovieId()（UPSERT + 名寄せ）
│   │       │   ├── screenings.ts        # replaceScreeningsByDate()（洗い替え・batch）
│   │       │   ├── theaters.ts          # 劇場マスタ読取/CRUD（active のみ・全件・作成/更新）
│   │       │   ├── reviews.ts           # レビューキュー登録・一覧・approveReview()/reject（11 §6）
│   │       │   └── admin-queries.ts     # ダッシュボード集計（本日状況・鮮度・トークン日次・規約期限）
│   │       └── admin/                   # 管理サイト（Cloudflare Access 配下・07 §2）
│   │           ├── index.tsx            # /admin ルート登録（Hono）+ 手動取込/再抽出/承認 POST
│   │           ├── guard.ts             # コード側ガード（token or Access JWT ヘッダ。14 §4）
│   │           ├── pages/
│   │           │   ├── dashboard.tsx    # ダッシュボード: 取込状況・鮮度・LLM コスト・規約期限警告
│   │           │   ├── theaters.tsx     # 劇場マスタ CRUD + 手動取込・robots 確認
│   │           │   ├── runs.tsx         # 取込履歴一覧・詳細・R2 再抽出
│   │           │   └── reviews.tsx      # レビューキュー: 目視確認（画像突合）・承認・破棄
│   │           └── components.tsx       # 共通 Hono JSX コンポーネント（レイアウト・チップ等）
│   │
│   └── web/                             # LP + Web アプリ（React Router v8 + Workers。ADR-0013）
│       ├── package.json                 # name: @cinema/web
│       ├── wrangler.jsonc               # Worker 設定（cinema-web / [env.st] / [env.prod]）
│       ├── vite.config.ts               # @cloudflare/vite-plugin + reactRouter + tailwindcss
│       ├── react-router.config.ts       # ssr: true（P5-2 の OGP に必要）
│       ├── tsconfig*.json               # テンプレート準拠（project references・typegen 都合で base 非継承）
│       ├── workers/
│       │   └── app.ts                   # Worker エントリ（createRequestHandler）
│       └── app/
│           ├── root.tsx                 # ドキュメント殻・共通レイアウト・免責フッター（08 §5）
│           ├── routes.ts                # ルート定義
│           ├── entry.server.tsx         # SSR エントリ（bot は全描画待ち）
│           ├── app.css                  # Tailwind v4 エントリ
│           ├── routes/
│           │   ├── home.tsx             # LP (/)（07 §1.2。P3 は簡易版・本実装は P5-3）
│           │   ├── plan.tsx             # プラン作成・結果一覧 (/plan)（07 §1.3-1.4）
│           │   └── p.$planId.tsx        # 共有ページ /p/{id}（07 §1.5、SSR+OGP。P5-2）
│           ├── components/
│           │   ├── PlanForm.tsx         # 条件入力フォーム（日付/時間帯/地点/映画選択）
│           │   └── PlanResult.tsx       # タイムライン表示・タブ切替・集計・終電バッジ・カレンダー導線
│           └── lib/
│               ├── api.ts               # コア API クライアント（@cinema/shared の型を使用）
│               ├── calendar.ts          # Google カレンダー render URL 生成（OAuth 不使用）
│               ├── ics.ts               # .ics 生成（結果画面はクライアント生成。04 設計メモ3）
│               ├── relax.ts             # relaxSuggestions のフォーム適用（07 §1.3）
│               ├── time.ts              # JST 表示ユーティリティ
│               └── storage.ts           # 入力値の localStorage 保存/復元
│
├── mocks/                               # Docker Compose スタブ設定（ローカル開発専用）
│   ├── transit/
│   │   └── transit-expectations.json   # 経路探索 API（ls8h・ADR-0014）モックレスポンス定義
│   └── slack/
│       └── slack-expectations.json     # Slack Webhook モックレスポンス定義
│
├── migrations/                          # D1 マイグレーション（local/st/prod 共通・スキーマのみ）
│   └── 0001_init.sql                    # 全テーブル定義・インデックス（11 §1）
│
├── seeds/                               # 開発 seed（マイグレーション外。ローカルのみ execute で投入）
│   └── dev_seed.sql                     # 開発ダミー劇場（本番・ST に適用しない。11 §1）
│
├── docs/                                # 設計ドキュメント（本ファイル群）
│   ├── README.md                        # 索引・優先順位・不変条件
│   ├── 01_requirements.md              ─┐
│   ├── 02_glossary.md                   │
│   ├── 03_data-model.md                 │
│   ├── 04_api-spec.md                   │ 設計ドキュメント群
│   ├── 05_routing-algorithm.md          │
│   ├── 06_extraction-spec.md            │
│   ├── 07_screens.md                    │
│   ├── 08_compliance-policy.md          │ ← Claude Code への制約（最重要）
│   ├── 09_roadmap.md                    │
│   ├── 10_adr/                          │
│   │   ├── README.md                    │
│   │   └── 0001-0014.md               ─┘
│   ├── 11_d1-implementation.md         ─┐ 実装詳細
│   ├── 12_dp-implementation.md          │ （期待値テスト含む）
│   ├── 13_claude-code-kickoff.md        │ Claude Code 起動プロンプト
│   ├── 14_environments-deploy.md        │ 環境・Compose・Actions
│   ├── 15_folder-structure.md           │ 本ドキュメント
│   └── 16_human-setup-guide.md        ─┘ 人間（オーナー）作業手順
│
└── .github/
    └── workflows/
        ├── ci.yml                       # PR & push: typecheck / lint / test（DP 期待値含む）
        ├── deploy-st.yml                # main push → ST migrate + deploy（自動）
        └── deploy-prod.yml              # v* タグ + 承認 → PROD migrate + deploy

```

## パッケージ名と依存関係

```
@cinema/shared   ← 依存なし（他 3 パッケージが参照）
@cinema/api      → @cinema/shared
@cinema/ingest   → @cinema/shared
@cinema/web      → @cinema/shared
```

- `shared` は Workers / Node / ブラウザのどの環境でも動く純 TypeScript（Cloudflare 固有の型に依存しない）。
- パッケージ間の import は `@cinema/shared` 経由のみ。`api` が `ingest` を、または `ingest` が `api` を import することはない（疎結合）。

## 設計上の注意点

- `migrations/` はパッケージ内ではなくリポジトリルートに置く。全環境（local/st/prod）に同一 DDL を適用するため、どのパッケージにも属さない。
- `compose.yaml` は D1（DB 本体）を含まない。ローカル D1 は wrangler が SQLite で管理する（14 §1・ADR-0009）。
- `.dev.vars` は gitignore 対象。コミット禁止。GitHub Secrets にも置かず、ローカル専用。
- `admin/` は `ingest/` パッケージ内に同居（Cloudflare Access で /admin を保護。別デプロイ不要）。
- `web/` の共有ページ（/p/[planId]）は SSR 必須（OGP 動的生成のため）。他ページは CSR 可。
