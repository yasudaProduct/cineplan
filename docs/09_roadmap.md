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
  - **2026-07-20 追記（ST自動デプロイ契機の訂正・ADR-0016）**: P1以降、全 feature/fix ブランチは一貫して `develop` にPRマージされ運用されてきたが、ST自動デプロイの契機は当初設計どおり `main` push のままだった。`develop → main` の同期は2026-07-16のPR #11を最後に行われておらず、それ以降 `develop` にマージされた変更（PR #12〜#19。可観測性導入・Geminiタイムアウト対応等）はGitHub Actions経由でSTに一切反映されず、都度手動 `wrangler deploy --env st` で埋め合わせていたことが判明。`ci.yml`/`deploy-st.yml` のpushトリガーを `develop` に変更（`fix/st-deploy-trigger-develop`）。

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
- [x] **P1-6 Cron + Queues 配線**
  - dispatch（active→Queue）+ consumer + 手動取込（`POST /admin/ingest`）を実装。Cron は prod のみ。
  - 手動トリガー経路は E2E 確認済み。**実 Queues/Cron 挙動（リトライ等）は ST で確認**（`14` §1）。
  - **2026-07-26 追記（P4-8 の5館 active 昇格後に着手）**: ST の検証機会は N-06（1劇場1日1セッション）により1日1回しか無いため、実機を撃つ前にエミュレーションでも検証できる判定ロジックを先にユニットテストで固定した（`packages/ingest/src/__tests__/index.spec.ts` に12件追加。`queue()` の fetch_failed 指数バックオフ 300→600 秒と3回目の打ち切り／`fetch_failed` 以外は即 ack／`scheduled()` の cron 文字列リテラル分岐）。残る実機確認の手順は `16` §4.4 — **Step A**: 到達不能ダミー劇場（`.invalid`・paused）で**先方アクセスゼロ**のまま Queues 再配信と Slack 抑止を観測 / **Step B**: 日付固定の one-shot cron を ST に一時追加して実発火を観測（実施日は手動取込を行わない） / **Step C**: ディスパッチ〜最終 `run.done` の所要時間を実測し **N-02（前日 06:00 JST 完了）と突合**する。最悪ケース 5館×12分≒60分 に対し prod cron は 06:00 JST 開始のため、実測次第で cron 前倒しを P5-7 前に判断する。TravelMatrix 分岐は cron 文字列の完全一致で選ばれるため ST の one-shot 式では検証できず、prod 初回月曜のログ確認とする。
  - **Step A 完了 ✓（2026-07-26・ST。実 Queues 再配信）**: 到達不能ダミー劇場（`thr_verify_retry`・paused・`https://unreachable.invalid/schedule`）で**先方サイトへのアクセスゼロ**のまま観測。3 run すべて `fetch_failed`（`trigger=manual`）で、再配信間隔は **301.2秒 / 601.5秒**（設計値 300/600・誤差1秒未満）、**3回目で打ち切り**（4回目が来ないことを +14分で確認）、**Slack は3回目のみ1通**（attempt 1・2 の `silent` 抑止が実機で機能）。全体所要 15分3秒。手動取込も Queue 経由化により cron と同じ再配信対象になることを実機で確認。検証後ダミーは retired。副次発見: `.invalid` への fetch は DNS エラーの throw ではなく **Cloudflare が HTTP 530 を返す**ため `fetchWithUA()` の `!res.ok` 側で throw する（`log.ts` の分類は network ではなく http/530）。`fetch_failed` への確定は同じ。また再配信間隔は Workers Logs より D1 の `started_at` 差で見るほうが確実（ログの時間窓を外して取りこぼしかけた）。
  - **Step B / Step C 完了 ✓（2026-07-26 17:00 JST・ST。実 Cron 発火とサイクル時間）**: 日付固定 one-shot cron（`0 8 26 7 *`）を `[env.st.triggers]` に一時追加して発火させ、検証後に削除（`chore/p1-6-st-cron-verify` → `chore/p1-6-st-cron-revert`）。**Done 条件はすべて満たした**。
    - **ディスパッチ**: 08:00:00 UTC の発火から 8.4秒後に1館目が開始。active 5館すべてが `trigger='cron'` で処理された（＝`scheduled()` が5件 enqueue した証拠）。
    - **直列性**: 前の run の `finished_at` から次の `started_at` まで **0.39〜0.65秒**。`max_batch_size=1` / `max_concurrency=1` の完全直列が実機で確認できた。run 行は consumer 内の `ingestTheater` で作られるため、5件同時ではなく1件ずつ現れる。
    - **サイクル時間（Step C）= 340秒（5分40秒）**。内訳: T・ジョイ梅田 110.8秒（`tabs`・5日分）/ シネ・ヌーヴォ 22.8秒 / テアトル梅田 54.7秒 / 大阪ステーションシネマ 97.8秒 / シアターセブン 52.1秒。事前見積りの最悪ケース（5館×`RUN_BUDGET_MS`12分≒60分）に対し**実測は 1/10 以下**。
    - **N-02 突合**: prod cron は 21:00 UTC = 06:00 JST 開始のため完了は約 06:06 JST となり、「対象日の前日 06:00 JST までに取込完了」を**額面上6分超過する**。加えて `fetch_failed` の再配信1本で +15分（5分+10分）が乗るため、06:00 開始では容易に超える。**prod cron を 20:00 UTC（05:00 JST）へ前倒しすることを推奨**（54分の余裕。N-05 の 30館想定でも平均68秒/館なら約34分で収まる）。実施は P5-7 の prod 昇格時（オーナー判断）。
    - **副次観察（P4-8 側の要対応）**: 5館のうち2館が V2 `COUNT_ANOMALY` で `validation_failed` → レビューキュー入り（T・ジョイ梅田 186件 vs 平均74.6 / 大阪ステーションシネマ 355件 vs 平均115.7）。いずれも**取込・抽出は正常で、過去平均が汚れているだけ**。`recentAvgCount` は直近7件の succeeded の `written_count` 平均で、T・ジョイは ADR-0019 以前の単日 run（27/62/51件）が、大阪ステーションシネマは 2026-07-19 の静的取得バグ由来の `written_count=0` 2件が平均を押し下げている。承認すれば `written_count` が記録され以降の平均が追従する（ADR-0019 の想定どおり）。**大阪ステーションシネマは対象日以降の screenings が D1 に0件**なので、承認しないと `/plan` に出ない。
    - ST では検証できない項目（既知・設計どおり）: `scheduled()` の TravelMatrix 分岐は cron 文字列の完全一致で選ばれるため one-shot 式では通らない。ユニットテストで固定済み・手動再生成は P4-6 で E2E 済みのため、prod 初回月曜のログ確認とする。
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
      - **2026-07-21 追記⑤（タイムアウト原因確定＋日単位分割 ADR-0017）**: Free tier 復帰後の再実行（`run_RYyMTKyPoDdg` 等3回）も全て120秒×3タイムアウトで失敗。ST の succeeded run 実測から原因を確定——律速は入力サイズでもサービング優先度でもなく**出力生成時間**。週間ページには30作品×7日=時刻347件が載っており、一括抽出の出力は推定3.5万トークン。実測スループット（96〜190 tok/s。シアターセブン155件=15,728 tok で既に120〜121秒）では最速でも約185秒かかり、120秒では物理的に完了不能（追記④のノイズ除去=入力削減が効かなかった理由もこれ）。対策として **text 抽出を日単位分割（日付発見コール→日別抽出コール）に変更**（`text_v2`・`extractTextDaySplit`・ADR-0017・06 §1/§4/§7/§8）。1呼出の出力を1日分（≒5千トークン=30〜60秒）に抑える。合わせて抽出デッドライン10分・`reapStaleRuns` 20分→30分。検証は 7/19 06:12 スナップショットの R2 再抽出（先方アクセスなし）で行う。
      - **2026-07-21 追記⑥（第2の障害＝モデル容量逼迫。ADR-0018）**: 日分割デプロイ後の再抽出検証で、出力極小の日付発見コールまで120秒×3タイムアウトになり、ローカル直接実測で切り分け——`gemini-flash-latest`（=3.5-flash）の**無料枠が容量逼迫（503 UNAVAILABLE「high demand」/応答保留）**しており、7/20の無料枠復帰以降の全取込失敗はこれが原因（出力律速と重なった第2の障害）。旧世代 `gemini-2.5-flash`/`-lite` は404（新規利用不可）で退避先にならず。`gemini-3.1-flash-lite`（=`gemini-flash-lite-latest`）は正常で、実データ検証も良好（日付発見1.5秒・「7/24-25は未定のため除外」と正しく判断／日別抽出18.4秒・69件=347セル÷5日と一致・対象日外混入ゼロ）。ST/prod の `GEMINI_MODEL` を `gemini-flash-lite-latest` に設定（ADR-0018）。
    - **T・ジョイ梅田（tjoy.jp/KINEZO系。2026-07-22 オーナー起票・5館目）**: `fetch_method=static`/`extract_method=text`。静的HTMLに当日分の全上映＋2日後以降の先行販売分が含まれる。robots/規約はオーナー確認済み（allowed・terms設定済み）。
      - **2026-07-25 追記⑧（複数日取得 ADR-0019）**: 追記⑦後、当日分は取れるが翌日以降が入らない件をオーナーが指摘。調査の結果、**静的HTMLには当日分しか含まれず**、将来日は `data-date` 属性を持つ日付タブ（href無し・10日分）のクリックで AJAX（`POST /theaterTop/scheduleGetHtmlApi`・CSRFトークン付き）が内容を差し替える方式と判明（ブラウザ上では7〜10日先まで表示されている）。当初「サイトが将来分を未公開」と誤結論したが、実際は**取得方式（static・1ページロード）の限界**だった（追記⑦の「先行販売の部分掲載」という原因記述も誤りのため本追記で訂正）。対策として**劇場ごとの複数日取得**を実装（`fetch_day_mode`=`single`/`tabs`/`url_template` + `fetch_days`・migration 0005・ADR-0019・06 §2.2）。内部AJAX API直叩きは構造非依存（ADR-0003）に反するため不採用とし、Browser Rendering + 汎用タブ検出（値が `YYYY-MM-DD` の属性を属性名非依存で収集）を採用。`docs/08` §0 の「1劇場1日1回」は §6 の手続きを経て**単位をセッションに改定**（5秒間隔・直列・並列化禁止は不変）。
      - **2026-07-22 追記⑦（text_v3＝日付見出し無し当日ブロック対策）**: 5館目の初回取込が succeeded だが**本日分（43件）を丸ごと取りこぼし**、先行販売の27件（7/24〜26）のみ抽出される不具合を発見。R2スナップショット解析で原因確定——当日分のスケジュールが**日付見出し無し**でページ先頭に並び（日付はタブの `<small>7/</small>22` のみ）、先行販売の将来日だけ `<p>7/24（金）</p>` の見出し付き。日付発見コール（ADR-0017 でリスク明記済み）が見出し付きの3日しか返さず、当日を落としていた。対策として **基準日 `businessDate`（当日）を発見・日別の両コールに渡し「日付見出し無しの先頭ブロックは当日分」と明示する `text_v3` を追加**（`text_v2` は版管理規則どおり残置。06 §4）。修正版を両館の実スナップショットで実証（T・ジョイ 27→70件・当日43件回収／大阪ステーションシネマ 348件で回帰なし・対象日外混入ゼロ）。**先行販売の将来日は部分的な上映のみ掲載される点は既知の性質**（当日到来時にフル取込で洗い替え。ルート算出の扱いは要検討事項として残す）。
    - **△ 第七藝術劇場**（十三）: 自社サイトに時刻表なし。スケジュールは外部チケットシステム（sboticket.net）内のみ → チケット販売システムへの bot アクセスは規約・原則2 の観点でリスク高、当面見送り推奨。
    - **✕ TOHOシネマズ**: 「ご利用に際して」に**スクレイピング等の明示禁止** → 不採用（eiga.com と同じ判断）。
    - **✕ シネマート心斎橋**: 2024年10月閉館。
- [x] **P4-9 上映データ（抽出検証）画面**（オーナー依頼 2026-07-20・ADR-0015。07 §2.6）
  - `/admin/screenings`: 劇場×日付で取込済み screenings を閲覧し公式サイトと目視突合する内部 QA 画面。08 §0 の「一覧画面禁止」は利用者向け・公開面が対象であることを ADR-0015 で明確化し、08 §0/§1・CLAUDE.md に注記追記のうえ実装。

## P5. 共有・LP・仕上げ

- [x] **P5-1 共有プラン（POST /plans, GET /plans/{id}）** + 期限切れ処理（実装ブランチ `feat/p5-1-shared-plans`）
  - Done ✓（2026-07-26）: `POST /v1/plans`（201・`pln_` id・`{WEB_BASE_URL}/p/{id}`・expiresAt=+30日）/ `GET /v1/plans/{id}`（スナップショットをそのまま返す・F-13）/ `GET /v1/plans/{id}/ics`（サーバ生成・興行日ファイル名）。**期限切れは読み取り時判定で不存在と同じ 404 NOT_FOUND**（存在の痕跡を返さない。物理削除は P5-5 の Cron。docs/04 設計メモ9）。運用防御: ボディ64KB(413)・legs≤50・screening≥1・zod strip 後を永続化（設計メモ8）。`.ics` 生成は web のクライアント生成（P3-5）と共通化するため `buildIcs`/`toCalendarUtc` を `@cinema/shared` へ移動（二重実装排除）。`WEB_BASE_URL` var を api の3環境に追加（prod は P5-7 で置換）。route ユニット13件 + ローカル実機 E2E（POST→GET→ics→404）確認済み。**web の共有ボタン配線と共有ページ本体は P5-2**。
- [x] **P5-2 共有ページ /p/{id}（SSR + OGP 動的画像）**（実装ブランチ `feat/p5-2-share-page`）
  - Done ✓（2026-07-27）: `/p/{planId}`（SSR・読み取り専用タイムライン・`GET /v1/plans/{id}/ics` リンク・「自分でもプランを作る」CTA=日付プリセット `?date=` 付き）/ 期限切れ・不存在は 404 ページ（「新しくプランを作る」導線）/ OGP メタ（og:title/description/image・twitter:card）。**OGP 動的画像 `/p/{planId}/og.png`**: 手書き SVG テンプレート + `@resvg/resvg-wasm`（wasm 2.4MB・gzip 965KB）+ **Noto Sans JP サブセットフォント**（99グリフ・65KB・`scripts/make-og-font.mjs` で再生成・OFL 同梱）。satori 不使用（固定レイアウトに flexbox エンジンは過剰）。結果画面に共有ボタン配線（`POST /v1/plans` → コピー / **Web Share API は「共有…」ボタンに分離**（発行の await 後は user activation が切れ Safari が拒否・デスクトップで OS シートが勝手に開いて発行フローが止まるのを実機で確認したため）/ X / LINE。発行直後の自動遷移はしない=ST で観測した書込直後読取の過渡 404 を踏まない）。タイムライン描画は `PlanTimeline` に切り出し結果画面と共用。ユニット7件（summary/og SVG）+ ローカル実機 E2E（ブラウザで算出→発行→共有ページ→CTA プリセット、curl で SSR メタ・og.png・404）確認済み。**OGP 画像の SNS クローラ実確認（X/LINE の実キャッシュ）は ST デプロイ後**。
- [x] **P5-3 LP**（`07_screens.md` §1.2）（実装ブランチ `feat/p5-3-lp`）
  - Done ✓（2026-07-27）: §1.2 の6セクション（ヒーロー+CTA / 価値説明3カード / 使い方3ステップ / 対応劇場 / アプリ版準備中 / フッター）を `routes/home.tsx` に実装。対応劇場は SSR loader で `GET /v1/theaters` から劇場名チップを表示（**名前のみ・上映情報は一切出さない**=原則1。「上映スケジュールは一覧表示しません」の注記付き）。API 到達不能でも LP は表示（劇場一覧のみ省略）。**フッターの法務リンク（利用規約・プライバシー・お問い合わせ）は P5-4 でページと同時に追加**（先にリンクだけ置かない）。免責は root.tsx の全ページ共通フッターが担う（08 §5）。実ブラウザで全セクション表示を確認。
- [x] **P5-4 法務ページ**（利用規約・プライバシー・/bot・免責表示）← `08_compliance-policy.md` §3, §5（実装ブランチ `feat/p5-4-legal-pages`）
  - Done ✓（2026-07-27・**文面はドラフト**）: `/terms`（無保証・予約決済は劇場公式・禁止事項）/ `/privacy`（個人情報を取得・保存しない=実装と一致: 会員登録なし・localStorage は端末内のみ・現在地は算出のみで非保存・共有プランは内容のみ30日・独自 Cookie 不使用・LLM 送信は劇場公開ページのみ 08 §4）/ `/bot`（UA `CinemaHashigoBot/0.1`・1日1セッション/最大10ページ/5秒間隔/直列/30秒タイムアウト/スナップショット再処理/robots 尊重・停止依頼→即時停止。08 §3 の実装事実と一致）。全ページ共通フッター（root.tsx）に法務リンクを追加（P5-3 で保留した分）。免責掲示は従来どおり（08 §5）。
  - **オーナー確認待ち（docs/16 §5.4）**: ①文面の最終確認 ②**連絡先メールアドレスの決定**（`app/lib/site.ts` の `CONTACT_EMAIL`。null の間は「準備中」表示で mailto を出さない）。/bot と UA のドメイン部分（`example.com`）は P5-7 のドメイン確定時に ingest 側 `USER_AGENT` と同時更新。
- [x] **P5-5 データ保持 Cron**（03_data-model.md §4 の各種期限削除）（実装ブランチ `feat/p5-5-retention-cron`）
  - Done ✓（2026-07-28）: `runRetention()`（`cron/retention.ts`）を prod 日次 Cron `0 17 * * *`（02:00 JST）に配線（`scheduled()` の3本目の分岐）。1つの `db.batch`＝1トランザクションで screenings(30日) → reviews(解決後90日・pending 除外) → runs(180日) → shared_plans(期限切れ) を削除。**docs/11 §7 の SQL を2点正確化**（docs 先行）: ①日時列は `datetime()` ラップ（ISO `T` 形式と `datetime('now')` のスペース形式は文字列比較非互換＝P5-1 で発見した問題の再発防止）②runs は `NOT IN (SELECT ingest_run_id FROM extraction_reviews)` ガード（D1 は FK を既定で強制し batch 全体が rollback するため。pending 長期残存時は当該 run をスキップし解決後の Cron で自然に消える）。管理ダッシュボードに手動実行ボタン（`POST /admin/retention/run`。Cron の無い ST での検証・随時実行用）。**R2 スナップショット90日は ST バケットにライフサイクルルール適用済み**（`expire-snapshots-90d`・prefix `raw/`。prod は P5-7 = 16 §5.2 に手順追記）。ユニット7件 + ローカル D1 E2E（境界データ9行: 期限超が消え期限内と pending・FK ガード対象が残ることを実 SQL で確認）。prod 実 cron の初回実行はデプロイ後にログで確認する運用（TravelMatrix と同じ）。
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
