# 開発ロードマップ / タスク分解

- Version: 0.1
- 目的: Claude Code が1つずつ着手できる粒度にタスクを分解する。**フェーズ順に進め、フェーズ内は上から着手する。フェーズをまたいだ先食い実装をしない。**
- 各タスクは「完了条件（Done）」を満たしたら次へ進む。

## マイルストーン全体像

| Phase | ゴール | 完了の目安 |
|---|---|---|
| P0 | 基盤セットアップ | モノレポ・共有スキーマ・D1 が動く |
| P1 | 取込最小版（1劇場） | 1劇場の翌日分が D1 に入る |
| P2 | ルート算出コア | `/plan` が実データで動く |
| P3 | Web 最小版 | 自分用ツールとして完結 |
| P4 | 管理サイト + 劇場拡充 | 5劇場が安定運用 |
| P5 | 共有・LP・仕上げ | 他人に使ってもらえる |
| P6 | モバイルアプリ | 後続（本ドキュメントでは概要のみ） |

**意図**: P2（ルート算出）を早い段階に置く。サービスの価値はここにあるので、取込基盤を作り込む前にコアの手応えを確認して手戻りを防ぐ。

---

## P0. 基盤セットアップ

- [x] **P0-1 モノレポ初期化**
  - 構成: `packages/{shared,ingest,api,web}`。pnpm workspace。
  - Done: `pnpm install` が通り、各パッケージが空ビルドできる。
- [x] **P0-2 shared パッケージ: zod スキーマ**
  - `02_glossary.md` の命名、`04_api-spec.md` のスキーマ、`06_extraction-spec.md` の抽出スキーマを zod で定義。
  - Done: Theater/Movie/Screening/PlanRequest/Plan/ExtractionResult 等が型として export される。
- [x] **P0-3 D1 セットアップ + マイグレーション**
  - `11_d1-implementation.md` §1 のマイグレーション（0001_init.sql）をそのまま使用。論理設計は `03_data-model.md` §3。
  - Done: ローカル D1 にテーブルが作成され、seed で theaters 1件を投入できる。
- [x] **P0-4 Cloudflare リソース定義（3環境）**
  - `14_environments-deploy.md` §3 に従い、wrangler.toml に既定(local)/`[env.st]`/`[env.prod]` を定義。D1/R2/KV/Queues を環境ごとに分離し命名規約（§3.1）に従う。
  - Done: `wrangler dev` が local バインディングを認識。`--env st` / `--env prod` の deploy 構成が揃う（実デプロイはまだしない）。
- [x] **P0-5 ローカル補助サービス（Docker Compose）**
  - `14_environments-deploy.md` §2 の `compose.yaml`（minio / transit-stub / slack-stub）と `mocks/` 定義。DB本体は含めない（D1はwrangler管理）。
  - Done: `docker compose up -d` でスタブが起動し、`.dev.vars` の向き先でローカル Worker から到達できる。
- [x] **P0-6 GitHub Actions（CI + デプロイ土台）**
  - `14_environments-deploy.md` §5 の `ci.yml` / `deploy-st.yml` / `deploy-prod.yml` を配置。ST=main push自動、本番=v*タグ＋承認ゲート。
  - Done: PR で ci（typecheck/lint/test）が走る。deploy ワークフローは構文上有効（Secrets 未設定なら実デプロイはスキップ/失敗でよい。人間が §5.6 の設定を行う前提）。

## P1. 取込最小版（1劇場）

対象は **シネ・ヌーヴォ**（robots.txt 無し=許容・規約OK・アグリゲーター非経由。ADR-0012 で画像 vision 抽出）。当初の eiga.com は採用不可（robots/規約/アグリゲーター）。実装ブランチ `feat/p1-ingest-cinenouveau`（develop 派生）。

- [x] **P1-1 Fetch + R2 保存**
  - schedule ページ HTML + スケジュール画像を取得（正直UA・同一ホスト5秒間隔・30sタイムアウト。`08` §3）→ R2 保存。
  - Done ✓: 実 cinenouveau を取得し `raw/{theaterId}/{businessDate}/{fetchedAt}.html`/`.gif` に保存を E2E 確認。
- [x] **P1-2 前処理**
  - vision: 画像→base64（`imagesToParts`）。text: タグ簡約（`htmlToText`・将来の rendered 用）。
  - Done ✓: E2E で画像 → LLM 入力に変換。
- [x] **P1-3 LLM 抽出**
  - 抽出クライアント（provider 抽象化 gemini/ollama・text/vision。ADR-0011/0012）+ `vision_v1` プロンプト。
  - Done ✓: 実 Gemini で cinenouveau を抽出し、時刻/作品/日付（06-27〜07-31 の35日）が実画像と一致・screen_name クリーンを D1 で確認。qwen2.5vl:7b は同画像を抽出不可のため品質基準は Gemini（ADR-0011）。実データ起因の修正: 多スクリーン対応（screen_name・migration 0003）、Gemini の欠落フィールド（.nullish()）、プロンプト堅牢化（date/screenName 取り違え防止）。
- [x] **P1-4 検証**
  - `06` §5 の V1〜V6（正規化前 V1/2/5/6・正規化後 V3/4）。
  - Done ✓: 単体テスト 18 件で正常通過・各 NG コード検出を固定。
- [x] **P1-5 正規化 + D1 洗い替え書込**
  - 24時超え・endTime 補完・title_key 名寄せ・businessDate 別 DELETE→INSERT（月間画像対応）。
  - Done ✓: E2E で screenings が入り（UTC 正規化・名寄せ 3上映→2作品）、再実行で重複しない（3件のまま）。
- [ ] **P1-6 Cron + Queues 配線**
  - dispatch（active→Queue）+ consumer + 手動取込（`POST /admin/ingest`）を実装。Cron は prod のみ。
  - 手動トリガー経路は E2E 確認済み。**実 Queues/Cron 挙動（リトライ等）は ST で確認**（`14` §1）。
- [x] **P1-7 失敗ハンドリング + Slack 通知**
  - `06` §7 のリトライ方針・status 分岐・Slack。再抽出は R2 から（先方再取得は fetch_failed のみ）。
  - Done ✓: 抽出到達不可で `extraction_failed`+error 記録を E2E 確認。Slack は配線済み（未設定時は no-op）。

## P2. ルート算出コア

実装ブランチ `feat/p2-planner`（develop 派生）。`packages/api/src/planner/`。

- [x] **P2-1 planner: 前処理**
  - `05_routing-algorithm.md` §2。D1 ロード（11 §5.1）、wish/must フィルタ、時間帯フィルタ、決定的ソート。
  - Done ✓: 実データ E2E で wish 指定が候補限定として効くことを確認。
- [x] **P2-2 移動時間の解決（暫定）**
  - TravelResolver: KV `travel-matrix:v1` があれば参照、欠損は直線距離フォールバック（05 §5）。origin/destination は P2 暫定解決（station=最寄駅一致で walk_min / geo=フォールバック推定。本解決は P4-6）。
  - Done ✓: 行列参照・同一劇場0分・フォールバック・endpoint 解決をテストで固定。
- [x] **P2-3 DP コア（most_movies のみ）**
  - `12_dp-implementation.md` §5 の参照実装どおり（M_IN=10・K_KEEP=9・compareScore が唯一の基準）。
  - Done ✓: **12 §7 の検算済み期待値テスト全緑**（s1>s3>s5・タイブレーク45<65・windowStart=13:00→最大1本・12:30→s3>s5）。
- [x] **P2-4 infeasible 判定**
  - Done ✓: no_screenings は**フィルタ前**の対象日件数で判定（05 §7 の区別。12 §8 を明確化）。must 不在/組込不能・時間帯狭すぎ・dest 超過を単体+E2E で確認。
- [x] **P2-5 k-best + ラベリング**
  - Done ✓: most_movies / less_travel(s1>s2) / relaxed(s1>s3) / must_priority(must時) / alt。重複 Plan なし・作品重複解の棄却をテストで固定。
- [x] **P2-6 `/plan` エンドポイント**
  - Hono + shared zod（PlanRequest が単一の真実。OpenAPI 生成は将来検討）。`04_api-spec.md` 準拠。IP レート制限 60/min（isolate 内・MVP）。
  - Done ✓: 実データ E2E で 200（3案）/ 400（zod・未知origin）/ 422（未取込）/ infeasible 200 を確認。
- [x] **P2-7 `/theaters` `/movies`**
  - Done ✓: 両エンドポイント動作・`/movies` は作品名のみで上映時刻を返さない（原則1）・Cache-Control 付与。

## P3. Web 最小版

実装ブランチ `feat/p3-web`（develop 派生）。**React Router v8（旧 Remix）+ Workers に確定**（ADR-0013。Next.js/Pages 想定を変更）。Node は v22.23+ が必要（RR v8 要件。16 §1）。

- [x] **P3-1 プロジェクト初期化（React Router v8 + Workers）**
  - create-cloudflare 公式テンプレート準拠（wrangler.jsonc・workers/app.ts・Tailwind v4）。shared の型・API クライアント（app/lib/api.ts）。api に CORS 追加（docs/04 設計メモ6）。
  - Done ✓: 実ブラウザで /plan が表示され、/v1/movies・/v1/plan を fetch できることを確認。SSR で免責フッター（08 §5）も配信。
- [x] **P3-2 プラン作成フォーム**
  - `07_screens.md` §1.3 のとおり（今日/明日/日付・時間帯・駅名/📍現在地・ゴール指定しない・詳細設定に到着マージン+作品チップ★must最大3）。
  - Done ✓: 実ブラウザで送信・作品チップの実 API ロード・リロード後の localStorage 復元を確認。
- [x] **P3-3 結果表示（タイムライン）**
  - Done ✓: 3案タブ（🏆最多鑑賞4本/🚃移動少なめ/☕余裕あり）のクライアント内切替、travel/screening/wait の縦タイムライン、各上映に公式リンク、集計行を実データで確認。終電バッジは unit テストで固定（23:00 以降）。
- [x] **P3-4 infeasible UI**
  - Done ✓: time_window_too_narrow の理由表示 + 緩和チップのワンタップで時間帯 ±1h 適用 → 自動再算出を実ブラウザで確認。
- [x] **P3-5 カレンダー連携**
  - Google render URL（クライアント生成・ADR-0008）+ **.ics も結果画面はクライアント生成**（共有前の Plan に ID が無いため。docs/04 設計メモ3 更新。`GET /plans/{id}/ics` は P5-1 の共有ページ用）。
  - Done ✓: カレンダーリンクの URL パラメータを実ブラウザで検証、.ics 生成（VEVENT・エスケープ・CRLF）を unit テストで固定。
  - ※ この時点で「自分用のはしごツール」として完成。ここまでを最初の到達点にする。

## P4. 管理サイト + 劇場拡充

- [x] **P4-0 ST 環境有効化**（実装ブランチ `feat/p4-0-st-setup`）
  - 人間作業（`16_human-setup-guide.md` §3: Workers Paid・ST リソース・API トークン・GitHub Environments）の完了後に着手。wrangler.toml へ実 ID を反映 → 初回 ST デプロイ + migrate + seed → ST シークレット投入（人間、16 §3.6。**`ADMIN_TOKEN` を含む**）→ 手動取込で疎通確認。
  - **`/admin/ingest` は Access（P4-1）が入るまで `ADMIN_TOKEN` のみが ST 公開時の防御**（local は不要）。ADMIN_TOKEN 未設定のまま ST へデプロイした場合は 401 で fail closed（docs/16 §3.6）。
  - Done ✓: ST リソース4件作成・ID 反映、api/ingest/web を ST デプロイ（healthz ok）、D1 に 0001-0003 migrate + `seeds/st_seed.sql`（シネ・ヌーヴォ paused）投入。手動取込が **succeeded（145件・実 Gemini）**、D1/R2 検証済み。`/admin/ingest` の 401 fail closed を実機確認。`/plan` は active 劇場0件（cinenouveau paused）のため 422 DATA_NOT_READY を返す＝原則1どおり。**実ルート表示は cinenouveau の active 昇格（採用ゲート・16 §2.2）後**。副次修正: ready.ts を active 限定に（paused-only の 400→422）、ingest ST/prod に LLM_PROVIDER=gemini 明示。
  - 残（P1-6 由来・ST で確認予定）: 実 Queues のネイティブ再試行/Cron 挙動は、active 劇場ができ Cron 経路が回る段階で確認する（consumer は登録済み・retry ロジックは単体テスト済み）。
- [x] **P4-1 Cloudflare Access 設定**（オーナー作業）
  - Done ✓: ST の `/admin` が未認証で 302（Access ログインへ）・`/healthz` は開放のままを実機確認。Access 有効化後は curl+ADMIN_TOKEN の手動取込も Access に遮られるため、手動取込は管理サイト UI（またはAccess Service Token）経由に（16 §4.1 追記）。コード側ガードは token or `Cf-Access-Jwt-Assertion` 存在（14 §4。JWT 署名検証は P5 検討）。
- [x] **P4-2 ダッシュボード**（`07_screens.md` §2.2。実装ブランチ `feat/p4-admin`）
  - Done ✓: 5ウィジェット（本日の取込状況/明日分の鮮度%（N-02）/レビュー待ちバッジ/LLMトークン7日スパークライン/規約90日期限警告）を実データでブラウザ E2E。ingest を Hono 化し `/admin` を Hono JSX SSR（client JS なし・docs/07 §3）で実装。
- [x] **P4-3 劇場マスタ CRUD + 手動取込 + 新規は paused 起票**（§2.3）
  - Done ✓: ブラウザ E2E で 新規登録（**paused 強制**）→ active 昇格が robots/terms 不備で**サーバ拒否** → 記入後に active 成功 → retired、を実機確認。手動取込ボタンは 1日1回ガード（当日取得済みなら明示チェック要求。retry は数えない）+ prod 無効。robots.txt 確認リンク。入力は shared の `TheaterUpsert`（zod）で検証。
  - **2026-07-15 追記（不具合修正）**: ST で手動取込ボタンが `extracting` のまま孤児化する不具合を発見（ブラウザ接続断で Workers 実行がキャンセルされるため。`ctx.waitUntil()` は送信後最大30秒しか延長できず不十分と判明）。**手動取込を Queue 投入方式（`trigger='manual'`）に変更し cron と同じ consumer 経路で処理**するよう修正（`fix/p4-manual-ingest-orphan`）。保険として `reapStaleRuns()`（15分以上停止した run を `extraction_failed` に確定）を追加。06 §7・07 §2.3 更新。
- [x] **P4-4 取込履歴 + R2 再抽出**（§2.4）
  - Done ✓: 一覧（劇場/status フィルタ・50件ページング）・詳細（全項目+スナップショットリンク）。**R2 再抽出をブラウザ E2E**: trigger=`retry` の新 run が succeeded（136件・実 Gemini・**先方サイトへアクセスなし**）。coverageFloor はスナップショット取得日（today だと月跨ぎで新データを消すため。write.ts）。
- [x] **P4-5 レビューキュー**（§2.5、承認は通常書込パスで反映）
  - Done ✓: 一覧（pending 既定/all）・詳細は抽出結果テーブルと **R2 画像のインライン突合表示**。承認 E2E: `approveReview` が pipeline と同一の `normalizeResolveWrite` で D1 反映（2件書込・元 run を succeeded 化・D1 で確認）。破棄はメモ必須（サーバ側検証を実機確認・migration 0004 で `review_note` 追加）。プロンプト再実行=同スナップショット再抽出。
- [x] **P4-6 TravelMatrix 事前計算バッチ**（実装ブランチ `feat/p4-6-travel-matrix`）
  - 駅すぱあとは法人向けのため不採用 → **ls8h Transit API（無料・非公式）を採用**（ADR-0014。ToS はオーナーが 2026-07-13 実査）。KV 契約は shared の `TravelMatrix`/`StationGeo`（ハードルール7）。
  - Done ✓: 週次 cron（prod 月曜 18:00 UTC）+ 管理ダッシュボードの手動再生成。実 API E2E で 2劇場2ペア生成（九条⇄梅田 27/23分・非対称・路線名 summary）→ planner が KV 参照。失敗ペアは前回値温存・全滅時は未書込・retired 除外・直列 1 秒間隔（ユニット12件）。
  - 副次（P2-2 の「本解決は P4-6」）: **origin/destination の未知駅名を station-geo（ls8h ジオコーディング・KV 30日）で座標化** → 直線距離推定に接続。E2E で「梅田」発が 400→200（3案）・KV キャッシュ・不明駅 400 を確認。
- [x] **P4-7 rendered 劇場対応（Browser Rendering）+ text 抽出経路**（実装ブランチ `feat/p4-7-rendered`）
  - Done ✓（機構実証）: `fetch_method=rendered` を Browser Rendering（`BROWSER` binding + @cloudflare/puppeteer・正直UA・30s）で実装し、**ローカル実 Chromium で E2E**（自前の JS 描画テストページ → 描画後 DOM を R2 保存 → `htmlToText` → `text_v1` 抽出 → zod → D1。site/estimated 終了時刻・screenName・detailPath(href) まで正確）。text run の R2 再抽出（.html から）も E2E 済み。P1 から未対応だった `extract_method=text` 経路がこれで開通（リトライ予算は vision と共有実装）。
  - 副次修正: wrangler 4.108 の「ローカル BR 使用後の外部 fetch ハング」を 4.110 更新で解消。gemini/ollama クライアントにタイムアウト追加（ハングをリトライ可能エラー化）。Ollama に構造化出力（format=JSONスキーマ）。Gemini 503 時に extraction_failed が正しく即時記録されることを実機で確認（docs/06 §7 の実証）。
  - **実 rendered 劇場の追加は P4-8 の採用プロセス経由**（robots/規約の人間確認 → paused 起票 → 手動取込 → 3日連続 → active）。
- [ ] **P4-8 劇場を5館まで拡充**
  - 各館とも採用プロセス（§2 of 08）を経て、3日連続成功で active。**採用判断・規約最終確認はオーナー作業**（docs/16 §2.2）。
  - 候補下調べ（2026-07-15 実施。1サイト1〜2リクエストの通常閲覧相当）:
    - **◎ シアターセブン**（十三）: robots.txt 無し(404)=許容。**週間スケジュール画像を自社サイト掲載** → cinenouveau と同型の vision 抽出で対応可。規約明示禁止は見当たらず（オーナー最終確認要）。
    - **◎ テアトル梅田／シネ・リーブル梅田（ttcg.jp）**: robots.txt に Disallow 無し（sitemap のみ）。「ご利用に関して」にスクレイピング明示禁止なし（著作権の一般条項のみ＝事実データ抽出は対象外の従来判断枠）。スケジュールは JS 描画 → **P4-7 の rendered+text がそのまま適用**。正確な劇場名・スケジュール URL は採用時に確定。
      - **2026-07-19 追記**: `schedule_url=https://ttcg.jp/ttcg_umeda/` は劇場の通常トップページで、ヘッダー/ナビ/「上映中作品」等を含むフルページ（元HTML 1.2MB・前処理後も約9万文字≒4〜5万トークン）。スケジュール本体（HH:MM表記239件）はこのページ内にのみ存在し、ヘッダー内の別リンク（`/week/...`）はスケジュールテキストを含まないため**現行 URL が唯一の正しい選択**（他候補なし）。ヘッダー/ナビ/フッター除去による軽量化は削減率7%と効果薄（コンテンツがページ全体に分散）のため見送り、**Gemini タイムアウトを60秒→120秒に延長**して対応（`llm/gemini.ts`）。同型サイト（テアトルシネマグループの他劇場等）は同様の巨大ページになりうる点に留意。
      - **2026-07-19 追記②**: active 昇格後、テアトル梅田を含む `/plan` が web で `officialUrl` の zod検証エラーになる不具合を発見。原因は `normalize.ts` が docs/06 §6.4 の「detailPath の相対URLは scheduleUrl 基準で絶対化」を実装しておらず、LLM抽出した相対パス（例 `/ttcg_umeda/movie/123.html`）がそのまま D1 に保存されていたこと（`build.ts` が screening の detailUrl を officialUrl より優先するため、Plan の `ScreeningLeg.officialUrl`（`z.string().url()` 必須）で invalid_string が発生）。cinenouveau・シアターセブンは detailPath が null か既に絶対URLだったため顕在化していなかった（実装以来のドキュメント未実装の潜在バグ）。`normalize()` に scheduleUrl 引数を追加し絶対化を実装、http(s) 以外のスキームや解決不能な文字列は null（officialUrl へフォールバック）にして修正。次回の取込・再抽出・レビュー承認で screenings が洗い替えられ自動的に直る（データ移行不要）。
      - **2026-07-19 追記③**: 上記②の修正データを反映させるため R2 再抽出を実行したところ `extracting` のまま孤児化する不具合を発見。原因は P4-3（追記・行125）と同一で、`POST /admin/runs/:id/reextract` が「先方サイトへのアクセスが無く比較的短時間で終わる」という前提で唯一 Queue 経由化を見送っていたが、テアトル梅田のような巨大 rendered ページでは抽出（Gemini 呼出のリトライ）自体が数分かかりブラウザ接続断で同じ孤児化が起きることが実機で判明。**再抽出も Queue 投入方式（`{reextractRunId}`）に変更**し、取込（`{theaterId, trigger}`）と同じ consumer 経路で処理するよう修正（`fix/reextract-orphan`）。合わせて `reapStaleRuns()` の猶予を15分→20分に拡大（120s×最大4回リトライの最悪ケースを考慮）。06 §7・07 §2.4 更新。
    - **大阪ステーションシネマ（SMT系。2026-07-19 オーナー起票・検証中）**: スケジュールは JS 描画（day.js が `#Day_schedule` へ挿入）のため `static` では凡例のみの実質空ページとなり、**extracted 0件のまま succeeded** になった（0件+notes は休館日対応の仕様どおり V1 を通過するため。原因調査は R2 スナップショット目視で確定）。`schedule_url` を週間表 `week.html` に変更 + `fetch_method=rendered` で取得は成功（前処理後 約4,900字に上映データあり）が、抽出が Gemini 120秒タイムアウト×3回で extraction_failed（入力は小さくレート制限/API側不調の疑い・継続調査）。robots/規約の最終確認はオーナー作業。
      - **2026-07-19 追記（可観測性導入）**: 上記の調査で「デプロイ環境の実行ログが一切保存されず、D1 の error_message 1行しか手掛かりがない」可観測性不足が判明。**ingest 全体に Workers Logs（`[observability]` 3環境有効化）+ 構造化ログ（`src/log.ts`）を導入**（`feat/ingest-observability`。イベント台帳は packages/ingest/README.md）。LLM 失敗を timeout / http（status付き）/ network に分類し、リトライ経緯を error_message に前置（429=レート制限とハングを管理画面だけで判別可能に）。`reapStaleRuns` は掃除した runId 一覧を返しログ（reap.done）へ記録。14 §3.2/§8・16 §6.1・06 §7 更新。
      - **2026-07-19〜20 追記④（Gemini課金の誤リンク＋タイムアウト調査）**: 新しく分類されたログで再抽出したところ `gemini 429: Your prepayment credits are depleted` が判明——**Gemini APIキーの課金アカウントが意図せずPrepay（プリペイ課金）にリンクされ残高0円になっていた**（ADR-0011のFree tier前提と食い違い。オーナー作業でFree tierへ復帰）。Free tier復帰後に再度実行すると今度は素の `gemini timeout: 120000ms 経過`（3回とも）で失敗。R2スナップショットを実際の`htmlToText()`で再現したところ入力27,862字・タグ1,504個（うち`<img>`104個・`<meta>`15個は完全に無内容、お知らせカルーセルの`<section>`33個等はテアトル梅田同様ページ全体に分散）で、テアトル梅田（約4.5万トークン）より明らかに小さいにもかかわらず同じ壁に当たっており、**サイズだけでは説明がつかない**（Free tierのサービング優先度がPaid tierより低い可能性が濃厚だが未確定）。安全に確認できた範囲でノイズ除去を実装（`preprocess.ts`の`stripNoise`。06 §2 項目6）: header/footer/nav/meta/link/imgの無条件除去＋空のfigure/iframeのみ除去（実データで24%減・時刻347件/detailPath一意性30件とも完全一致を確認、タイトル欠損なし）。単独では120秒タイムアウトの解消を保証しないため、次回実行結果を要観察。
    - **△ 第七藝術劇場**（十三）: 自社サイトに時刻表なし。スケジュールは外部チケットシステム（sboticket.net）内のみ → チケット販売システムへの bot アクセスは規約・原則2 の観点でリスク高、当面見送り推奨。
    - **✕ TOHOシネマズ**: 「ご利用に際して」に**スクレイピング等の明示禁止** → 不採用（eiga.com と同じ判断）。
    - **✕ シネマート心斎橋**: 2024年10月閉館。

## P5. 共有・LP・仕上げ

- [ ] **P5-1 共有プラン（POST /plans, GET /plans/{id}）** + 期限切れ処理
- [ ] **P5-2 共有ページ /p/{id}（SSR + OGP 動的画像）**
- [ ] **P5-3 LP**（`07_screens.md` §1.2）
- [ ] **P5-4 法務ページ**（利用規約・プライバシー・/bot・免責表示）← `08_compliance-policy.md` §3, §5
- [ ] **P5-5 データ保持 Cron**（03_data-model.md §4 の各種期限削除）
- [ ] **P5-6 コスト監視ダッシュボード仕上げ**（LLM トークン日次・アラート）
- [ ] **P5-7 本番昇格**（`14_environments-deploy.md`）
  - prod 用 D1/R2/KV/Queues 作成、`wrangler secret` で prod シークレット投入、Cron を prod で有効化、初回 `v0.1.0` タグで承認デプロイ。ST で一通り検証済みを前提とする。
  - Done: prod で取込→算出→Web が動作し、管理サイトに Access がかかっている。

## P6. モバイルアプリ（後続・概要のみ）

- Expo（React Native）。shared の型・API クライアント・zod を流用。
- Web で固まった結果表示 UI・状態管理を移植。
- ストア公開に伴い、プライバシー・データ取扱いの記載を再点検。
- 詳細タスクは P5 完了時点で別途分解する。

---

## 人間（オーナー）作業との依存関係

アカウント作成・課金・シークレット発行・規約/法務の判断・本番デプロイ承認は Claude Code が代行しない。手順は `16_human-setup-guide.md` にまとめた。各フェーズ着手前に対応する人間作業が完了していること。

| タイミング | 人間作業（16 の節） | 完了しないとブロックされるタスク |
|---|---|---|
| P0 開始前 | 開発ツール・GitHub リポジトリ（§1）→ 確認済み | なし（P0 は着手可能） |
| P1 開始前 | 劇場1館目の採用確認（§2.2）。開発 LLM は Ollama（ローカル・人間作業なし）で先行可 | P1-1（実サイト取得） |
| P1 品質確定/ST 前 | Gemini API キー（§2.1・無料） | P1-3 の品質確定 / P4-0 |
| ST 有効化まで | Slack Webhook（§2.3。ローカルは slack-stub で可） | P4-0（ST の実通知） |
| P3 完了後（推奨） | ST 有効化一式（§3） | P4-0 以降すべて |
| P4 中 | Access 設定（§4.1）/ 駅すぱあとキー（§4.2）/ 劇場2〜5館の採用確認（§4.3） | P4-1 / P4-6 / P4-8 |
| P5 終盤 | ドメイン・prod リソース・prod シークレット・法務文面確認・タグ承認（§5） | P5-7 |
| リリース後 | 日次/週次/90日の運用（§6） | — |

---

## 進行ルール（Claude Code 向け）

1. 着手前に、そのタスクが参照する docs を読む（各タスクにファイル番号を明記済み）。
2. フェーズ内の順序を守る。特に P2-3（DP コア）は期待値テストが緑になるまで次へ進まない。
3. `08_compliance-policy.md` §0 の禁止事項に触れる実装はしない。判断に迷ったら実装せず確認を求める。
4. スキーマ変更が必要になったら、まず `packages/shared` と該当 docs を直し、その後に実装へ反映する（実装だけ先に変えない）。
5. 環境は local / st / prod の3つ（`14_environments-deploy.md`）。シークレットはコードに直書きせず、local は `.dev.vars`、st/prod は `wrangler secret`。ST と本番の Cloudflare リソースIDを取り違えない。
6. st の Cron（取込定期実行）は原則 OFF。開発中に先方サイトを不必要に叩かない（`08` の取得マナー）。
7. 人間作業（`16_human-setup-guide.md`）が前提のタスクに当たったら、実装を止めて依頼する。アカウント作成・課金・規約判断・本番承認を Claude Code が代行しない。
