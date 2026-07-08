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

- [ ] **P0-1 モノレポ初期化**
  - 構成: `packages/{shared,ingest,api,web}`。pnpm workspace。
  - Done: `pnpm install` が通り、各パッケージが空ビルドできる。
- [ ] **P0-2 shared パッケージ: zod スキーマ**
  - `02_glossary.md` の命名、`04_api-spec.md` のスキーマ、`06_extraction-spec.md` の抽出スキーマを zod で定義。
  - Done: Theater/Movie/Screening/PlanRequest/Plan/ExtractionResult 等が型として export される。
- [ ] **P0-3 D1 セットアップ + マイグレーション**
  - `11_d1-implementation.md` §1 のマイグレーション（0001_init.sql）をそのまま使用。論理設計は `03_data-model.md` §3。
  - Done: ローカル D1 にテーブルが作成され、seed で theaters 1件を投入できる。
- [ ] **P0-4 Cloudflare リソース定義（3環境）**
  - `14_environments-deploy.md` §3 に従い、wrangler.toml に既定(local)/`[env.st]`/`[env.prod]` を定義。D1/R2/KV/Queues を環境ごとに分離し命名規約（§3.1）に従う。
  - Done: `wrangler dev` が local バインディングを認識。`--env st` / `--env prod` の deploy 構成が揃う（実デプロイはまだしない）。
- [ ] **P0-5 ローカル補助サービス（Docker Compose）**
  - `14_environments-deploy.md` §2 の `compose.yaml`（minio / transit-stub / slack-stub）と `mocks/` 定義。DB本体は含めない（D1はwrangler管理）。
  - Done: `docker compose up -d` でスタブが起動し、`.dev.vars` の向き先でローカル Worker から到達できる。
- [ ] **P0-6 GitHub Actions（CI + デプロイ土台）**
  - `14_environments-deploy.md` §5 の `ci.yml` / `deploy-st.yml` / `deploy-prod.yml` を配置。ST=main push自動、本番=v*タグ＋承認ゲート。
  - Done: PR で ci（typecheck/lint/test）が走る。deploy ワークフローは構文上有効（Secrets 未設定なら実デプロイはスキップ/失敗でよい。人間が §5.6 の設定を行う前提）。

## P1. 取込最小版（1劇場）

対象は robots.txt/規約を確認済みの静的サイト1劇場（`fetch_method=static`）から始める。

- [ ] **P1-1 Fetch + R2 保存**
  - schedule_url を取得（間隔・UA・タイムアウトは `08_compliance-policy.md` §3 遵守）→ R2 に保存。
  - Done: 生 HTML が `raw/{theaterId}/{businessDate}/{fetchedAt}.html` に保存される。
- [ ] **P1-2 前処理**
  - `06_extraction-spec.md` §2 のタグ簡約・script/style 除去。
  - Done: 入力 HTML が抽出用テキストに変換される（�スナップショットでテスト）。
- [ ] **P1-3 LLM 抽出**
  - Haiku 呼出（temperature 0, JSON）。プロンプト v1 を `prompts/v1.ts` に。
  - Done: fixture HTML から ExtractionResult が得られ、zod 検証を通る。CI は録画リプレイ。
- [ ] **P1-4 検証**
  - `06_extraction-spec.md` §5 の V1〜V6。
  - Done: 正常データは通過、故意に壊した fixture は該当コードで弾かれる。
- [ ] **P1-5 正規化 + D1 洗い替え書込**
  - 24時超え時刻、endTime 補完、title_key 名寄せ、DELETE→INSERT。
  - Done: 1劇場・翌日分が screenings に入り、再実行しても重複しない。
- [ ] **P1-6 Cron + Queues 配線**
  - Cron が劇場を Queues 投入 → コンシューマが P1-1〜5 を実行 → ingest_runs 記録。
  - Done: スケジュール実行で1劇場が succeeded になり、ingest_runs に履歴が残る。
- [ ] **P1-7 失敗ハンドリング + Slack 通知**
  - `06_extraction-spec.md` §7 のリトライ方針と通知。
  - Done: fetch 失敗・検証NG が正しい status になり、Slack に飛ぶ。

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

- [ ] **P4-1 Cloudflare Access 設定**
  - /admin にアクセス制御。Google ログイン。
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

## 進行ルール（Claude Code 向け）

1. 着手前に、そのタスクが参照する docs を読む（各タスクにファイル番号を明記済み）。
2. フェーズ内の順序を守る。特に P2-3（DP コア）は期待値テストが緑になるまで次へ進まない。
3. `08_compliance-policy.md` §0 の禁止事項に触れる実装はしない。判断に迷ったら実装せず確認を求める。
4. スキーマ変更が必要になったら、まず `packages/shared` と該当 docs を直し、その後に実装へ反映する（実装だけ先に変えない）。
5. 環境は local / st / prod の3つ（`14_environments-deploy.md`）。シークレットはコードに直書きせず、local は `.dev.vars`、st/prod は `wrangler secret`。ST と本番の Cloudflare リソースIDを取り違えない。
6. st の Cron（取込定期実行）は原則 OFF。開発中に先方サイトを不必要に叩かない（`08` の取得マナー）。
