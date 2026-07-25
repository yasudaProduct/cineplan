# 用語集 / ユビキタス言語

- Version: 0.1
- 目的: 4パッケージ（ingest / api / web / shared）間で命名を統一する。**コード上の識別子・テーブル名・API フィールド名は本表の英名を正とする。**

## ドメイン用語

| 日本語 | 英名（識別子） | 定義 |
|---|---|---|
| 劇場 | `Theater` / `theaters` | 上映を行う映画館の1拠点。チェーンではなく個々の館を指す（例: TOHOシネマズ梅田）。 |
| 作品 | `Movie` / `movies` | 映画作品。上映形式（IMAX/字幕/吹替）が違っても同一作品なら同一 Movie。 |
| 上映 | `Screening` / `screenings` | ある劇場・あるスクリーンでの1回の上映。開始時刻・終了時刻・作品・形式を持つ。本システムの最小データ単位。 |
| 上映形式 | `format` | 2D / IMAX / 4DX / 字幕(SUB) / 吹替(DUB) 等。Screening の属性。 |
| ルート / プラン | `Plan` | 1日のはしご鑑賞計画。複数の Leg からなる。API レスポンスの単位。 |
| レッグ | `Leg` | Plan を構成する要素。`screening` / `travel` / `wait` の3種。 |
| 移動 | `Travel` | 劇場間（または origin/destination と劇場間）の移動。出発・到着時刻と経路概要を持つ。 |
| 待ち時間 | `Wait` | 到着マージンを超えて発生する滞留時間。 |
| 到着マージン | `arrivalMargin` | 上映開始時刻の何分前までに劇場へ到着していなければならないかの余裕時間。デフォルト15分。 |
| マスト作品 | `mustMovies` | ルートに必ず含めるべき作品。含められない場合は infeasible。最大3。 |
| ウィッシュ作品 | `wishMovies` | 観たい候補の作品集合。空の場合は全上映中作品が候補。 |
| 利用可能時間帯 | `timeWindow` | 利用者がはしごに使える時間帯（start/end, JST）。 |
| スタート地点 / ゴール地点 | `origin` / `destination` | 駅または緯度経度。destination は省略可。 |
| 移動時間行列 | `TravelMatrix` | 対象劇場すべての組の移動所要時間（分）を保持する事前計算データ。KV に格納。 |
| 代替案ラベル | `PlanLabel` | 各 Plan の性格を示すラベル。`most_movies` / `less_travel` / `relaxed` 等。定義は `05_routing-algorithm.md` §6。 |

## 取込ドメイン用語

| 日本語 | 英名（識別子） | 定義 |
|---|---|---|
| 取込 | `Ingest` | 1劇場・1回分の「取得→抽出→検証→保存」の一連の処理。 |
| 取込実行 | `IngestRun` / `ingest_runs` | Ingest の実行記録。ステータス・件数・消費トークン等を持つ。 |
| 取得 | `Fetch` | 対象ページの HTML を取得し R2 に保存するステップ。 |
| 取得方式 | `fetchMethod` | `static`（fetch のみ）/ `rendered`（Browser Rendering 使用）。劇場マスタの属性。 |
| 複数日取得方式 | `fetchDayMode` | `single`（1ページ・既定）/ `tabs`（日付タブを順にクリック）/ `url_template`（URL の `{date}` を置換）。劇場マスタの属性（ADR-0019）。 |
| 取得日数 | `fetchDays` | 1セッションで取得する日数。`0`=検出タブ全件（`tabs` のみ）。上限 `MAX_FETCH_DAYS`=10。 |
| スナップショット | `Snapshot` | R2 に保存された取得時点の生 HTML。キーは `raw/{theaterId}/{date}/{fetchedAt}.html`（複数日取得は各日 `..._d{date}.html` も）。 |
| 抽出 | `Extraction` | Snapshot から LLM で Screening 配列（JSON）を得るステップ。 |
| 検証 | `Validation` | 抽出結果に対する zod スキーマ検証 + 妥当性検証（件数レンジ・日時レンジ等）。 |
| レビューキュー | `ReviewQueue` / `extraction_reviews` | 検証NGとなった抽出結果を管理者が目視確認するための待ち行列。 |
| 規約確認 | `TermsCheck` | 劇場サイトの robots.txt / 利用規約を管理者が確認し記録する行為。`termsNote` / `termsCheckedAt`。 |

## ステータス値（正規定義）

| 対象 | 値 | 意味 |
|---|---|---|
| `IngestRun.status` | `queued` | Queues 投入済み・未処理 |
| | `fetching` | HTML 取得中 |
| | `extracting` | LLM 抽出中 |
| | `succeeded` | D1 書込完了 |
| | `validation_failed` | 検証NG。レビューキューへ |
| | `fetch_failed` | 取得失敗（HTTP エラー・タイムアウト） |
| | `extraction_failed` | LLM 呼出失敗 or JSON パース不能 |
| `Theater.status` | `active` | 取込対象 |
| | `paused` | 一時停止（規約再確認中など） |
| | `retired` | 恒久的に対象外 |
| `ExtractionReview.status` | `pending` / `approved` / `rejected` | レビュー待ち / 承認（D1反映） / 破棄 |

## 命名規則

- TypeScript: 型は PascalCase（`Screening`）、変数・フィールドは camelCase（`startAt`）。
- D1 テーブル・カラム: snake_case（`screenings.start_at`）。テーブル名は複数形。
- API JSON フィールド: camelCase。日時は ISO 8601（`2026-07-12T10:30:00+09:00`）。
- ID: プレフィックス付き短ID。`thr_xxxx`（Theater）/ `mov_xxxx`（Movie）/ `scr_xxxx`（Screening）/ `pln_xxxx`（Plan 共有ID）/ `run_xxxx`（IngestRun）。
- 時刻の内部表現: D1 には UTC epoch 秒 or ISO 文字列（UTC）で保存し、表示層で JST 変換。「日付」（対象日）のみ JST の `YYYY-MM-DD` 文字列で扱う。

## 紛らわしい用語の区別

- **Screening と Showtime**: 「Showtime」は使わない。常に `Screening`。
- **Plan と Route**: 「Route」は交通経路（Travel の中身）を指す場合に限定し、はしご計画全体は必ず `Plan`。
- **Theater と Cinema / Chain**: チェーン（運営会社）概念は MVP では持たない。必要になったら `TheaterGroup` を新設する（`Theater` に混ぜない）。
- **date（対象日）と screeningDate**: レイトショーは 24時超え表記（25:10 等）がサイト上ありうる。内部では実時刻（翌日 01:10）に正規化し、`businessDate`（興行上の対象日）を別途保持する。
