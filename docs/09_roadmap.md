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
  - Done ✓（コード）: 抽象化・zod 検証・録画リプレイ相当のスタブ E2E で通過。**実 vision の品質確定は Gemini/Ollama ビジョンモデルで別途**（ユーザー LLM 設定後）。
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

- [ ] **P2-1 planner: 前処理**
  - `05_routing-algorithm.md` §2。D1 ロード、wish/must フィルタ、時間帯フィルタ。
  - Done: 対象日の候補 Screening 配列が得られる。
- [ ] **P2-2 移動時間の解決（暫定）**
  - まず TravelMatrix を使わず、劇場間は固定値表（seed）で動かして DP を先に検証。
  - Done: travel(A,B) が引ける。
- [ ] **P2-3 DP コア（most_movies のみ）**
  - `12_dp-implementation.md` §5 の参照実装に従う。定式化は `05_routing-algorithm.md` §3。
  - Done: `12_dp-implementation.md` §7 の**検算済み期待値テスト**がすべて緑。← 最重要。
- [ ] **P2-4 infeasible 判定**
  - §7 の reason 分岐と relaxSuggestions。
  - Done: データ0件・must 不能・時間帯狭すぎが正しく分岐。
- [ ] **P2-5 k-best + ラベリング**
  - §4 のビーム化、§6 の代替案選抜。
  - Done: most_movies + less_travel + relaxed が返る。重複 Plan が出ない。
- [ ] **P2-6 `/plan` エンドポイント**
  - Hono + zod-openapi。`04_api-spec.md` 準拠。レート制限。
  - Done: POST /plan が仕様通りの JSON を返す。OpenAPI と実装が一致。
- [ ] **P2-7 `/theaters` `/movies`**
  - Done: 2エンドポイントが動き、`/movies` は上映時刻を返さない（原則1）。

## P3. Web 最小版

- [ ] **P3-1 プロジェクト初期化（Next.js on Cloudflare 等）**
  - shared の型・API クライアントを import。
  - Done: /plan が表示され API を叩ける。
- [ ] **P3-2 プラン作成フォーム**
  - `07_screens.md` §1.3。日付・時間帯・origin/destination・詳細設定。localStorage 復元。
  - Done: 入力して算出リクエストが送れる。
- [ ] **P3-3 結果表示（タイムライン）**
  - §1.4。タブ切替（クライアント内）、公式リンク、集計、終電バッジ。
  - Done: 複数案がタブ表示され、各上映に公式リンクがある。
- [ ] **P3-4 infeasible UI**
  - relaxSuggestions のワンタップ再算出。
  - Done: 案なし時に緩和提案から再実行できる。
- [ ] **P3-5 カレンダー連携**
  - Google render URL 生成、.ics ダウンロード（/plans/{id}/ics）。
  - Done: 上映が Google カレンダー／.ics に登録できる。
  - ※ この時点で「自分用のはしごツール」として完成。ここまでを最初の到達点にする。

## P4. 管理サイト + 劇場拡充

- [ ] **P4-0 ST 環境有効化**
  - 人間作業（`16_human-setup-guide.md` §3: Workers Paid・ST リソース・API トークン・GitHub Environments）の完了後に着手。wrangler.toml へ実 ID を反映 → 初回 ST デプロイ + migrate + seed → ST シークレット投入（人間、16 §3.6）→ 手動取込で疎通確認。
  - Done: ST の /healthz・/plan が応答し、1劇場の手動取込が succeeded になる。
- [ ] **P4-1 Cloudflare Access 設定**
  - /admin にアクセス制御（IdP は One-time PIN で開始、Google IdP 追加は任意。手順: `16_human-setup-guide.md` §4.1）。
  - Done: 認証なしで /admin が開けない。
- [ ] **P4-2 ダッシュボード**（`07_screens.md` §2.2）
- [ ] **P4-3 劇場マスタ CRUD + 手動取込 + 新規は paused 起票**（§2.3、採用プロセスを UI で担保）
- [ ] **P4-4 取込履歴 + R2 再抽出**（§2.4）
- [ ] **P4-5 レビューキュー**（§2.5、承認は通常書込パスで反映）
- [ ] **P4-6 TravelMatrix 事前計算バッチ**
  - 駅すぱあと API で劇場間行列を週次生成 → KV。差分更新。P2-2 の固定値表を置換。
  - Done: KV の travel-matrix を planner が参照する。
- [ ] **P4-7 rendered 劇場対応（Browser Rendering）**
  - JS 描画サイト（TOHO 等）を1つ追加。fetch_method=rendered。
  - Done: rendered 劇場が取込できる。
- [ ] **P4-8 劇場を5館まで拡充**
  - 各館とも採用プロセス（§2 of 08）を経て、3日連続成功で active。

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
