# 抽出仕様 — LLM ベース上映スケジュール抽出

- Version: 0.1
- 対象: `packages/ingest/src/extraction/`
- 原則: **構造非依存**。CSS セレクタで狙い撃ちせず、テキスト化した HTML または スケジュール画像から LLM が意味的に抽出する。サイトのマイナーな構造変更で壊れないことを設計目標とする。
- 抽出方式（`theaters.extract_method`。ADR-0012）:
  - `text`: HTML をテキスト化して抽出（従来）。将来の rendered メジャー館（P4-7）等。
  - `vision`: 月間スケジュール画像（GIF/JPG/PDF）をマルチモーダルLLMで直接抽出。ミニシアター向け。P1 の1館目シネ・ヌーヴォはこちら。

## 1. パイプライン全体

```
Fetch (static fetch / Browser Rendering)
  → R2 保存 (raw/{theaterId}/{businessDate}/{fetchedAt}.html / .gif 等)
  → 前処理（text: HTML→抽出用テキスト / vision: 画像バイト→base64）
  → LLM 抽出（既定 Gemini Flash, JSON 構造化出力。ADR-0011。provider・方式は設定値）
  → zod スキーマ検証
  → 妥当性検証（レンジ・件数）
  → 正規化（24時超え時刻・名寄せ）
  → D1 洗い替え書込（businessDate 別に DELETE→INSERT, 03_data-model.md §7）
```

- vision で月間画像を扱う場合、1回の抽出が複数 businessDate を含む。抽出結果を screening の `date` でグルーピングし、対象範囲（翌日〜+7）を businessDate ごとに洗い替えする。
- 失敗時の分岐は §7。

## 2. 前処理（トークン圧縮）

目的: LLM 入力トークンを減らしコストと誤抽出を抑える。**やりすぎて情報を落とすくらいなら素通しに近い方が安全**（Gemini Flash のコンテキストには余裕がある。無料枠 1M TPM に対し1回 in 50k tok 想定）。

1. `<script>` `<style>` `<svg>` `<noscript>` コメントを除去。
2. 属性は `href` のみ残し他を除去（detail_url 抽出のため）。
3. 連続空白・空行を圧縮。
4. テキスト化: HTML タグを保ったまま（表構造の手掛かりになるため Markdown 変換はしない。タグ簡約のみ）。
5. 上映スケジュールらしき領域の切り出しは**行わない**（ヒューリスティックがサイト依存になるため）。将来コスト最適化が必要になったら「前日スナップショットとの diff が閾値未満なら抽出スキップ」を先に導入する（画像は Last-Modified / バイト一致で判定）。

### 2.0 rendered（JS 描画サイト）の取得（P4-7）
- `fetch_method=rendered` の劇場は Cloudflare Browser Rendering（`BROWSER` バインディング + @cloudflare/puppeteer）で描画後の DOM を取得する。1回の取込 = 1回のページロード（取得マナーは static と同じ: 正直 UA・30s タイムアウト。docs/08 §3）。
- 描画後 HTML を R2 に保存し（`{prefix}.html`）、以降の再抽出はこのスナップショットから行う（先方再取得なし）。画像のダウンロードは行わない（rendered は text 抽出前提）。
- ローカル開発でも `wrangler dev` がローカル Chromium を起動するため実機同等に検証できる（docs/14 §8）。

### 2.1 vision（画像）の前処理
- schedule ページ HTML を取得し `image/schedule/*.gif` 等の画像 URL を抽出 → 各画像を取得 → R2 保存。
- 画像バイトを base64 化して LLM に渡す（Gemini=`inline_data`、Ollama=`images[]`）。過大な画像のみ縮小（初期は素通し。cinenouveau は 1枚 ≒ 23KB GIF）。
- 画像そのものは複製・再配布しない。抽出するのは事実データのみ（docs/08 §4・原則1）。

## 3. 抽出スキーマ（zod / packages/shared）

```ts
// 時刻は「時 0〜29・分 00〜59」に制約する（24時超え表記は 24:00〜29:59 のみ許容。§6）。
// 分を \d{2} のまま（00〜99許容）にすると "10:75" 等の LLM 誤生成が regex を素通りし、
// 正規化（setHours）が silent に別時刻へ丸めてしまうため、時分とも値域を絞る。
const TIME_RE = /^(2[0-9]|[01]?[0-9]):[0-5]\d$/;

export const ExtractedScreening = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), // 月間画像等で日付が行に紐づく場合。単日ページは null/省略（ExtractionResult.businessDate を使用）
  movieTitle: z.string().min(1),          // サイト表記のまま。正規化は後段
  startTime: z.string().regex(TIME_RE),   // "25:10" 等の24時超え許容（時0〜29・分00〜59）
  endTime: z.string().regex(TIME_RE).nullish(), // 記載なければ null/省略
  format: z.string().nullish(),           // "IMAX", "字幕" 等。表記のまま
  screenName: z.string().nullish(),       // "スクリーン7" 等。参考情報
  detailPath: z.string().nullish(),       // 作品詳細への相対/絶対 URL（画像抽出では通常 null）
});

export const ExtractionResult = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // 単日ページの対象日 / 月間画像では基準日（当日）
  screenings: z.array(ExtractedScreening),
  notes: z.string().nullish(),            // LLM が気付いた異常（"休館日と記載" 等）
});
```

- 各 screening の実効 businessDate は `screening.date ?? ExtractionResult.businessDate`。正規化（§6）でこの日付を使って UTC 化し、businessDate 別に洗い替える。
- **任意フィールド（screening の date/endTime/format/screenName/detailPath、および ExtractionResult.notes）は実装では `.nullish()`**（null も欠落も許容）。LLM の構造化出力は空フィールドを null ではなく省略する場合がある（Gemini 実データで判明）。**プロバイダの responseSchema の `required` 配列に無いフィールドは、対応する zod 側を必ず `.nullish()` にする**（`.nullable()` のままだと省略時に ZodError → 偽の extraction_failed になる）。V1（EMPTY_WITHOUT_REASON）など notes を参照するコードは `result.notes ?? ''` で null/undefined を同一視する。
- vision プロンプトでは screenName にスクリーン名のみを入れさせ、date/時刻の混入や businessDate 潰れを防ぐ（複雑な月間グリッドで Gemini が取り違える事例があったため。`vision_v1` で対策）。

## 4. プロンプト設計

- 場所: `packages/ingest/src/extraction/prompts/`。**プロンプトは必ずバージョン番号付きファイルで管理し、ingest_runs.prompt_version に記録する**（過去実行の再現のため）。既存バージョンのファイルは変更せず、修正は新バージョン追加で行う。プロンプト本文はプロバイダ非依存に保つ。方式別に分ける: `text_v{N}.ts`（HTML）/ `vision_v{N}.ts`（画像）。
- プロバイダ/モデル: **本番/ST 既定 Google Gemini Flash（無料ティア。ADR-0011）、ローカル開発は Ollama 既定**。呼び出しはプロバイダ抽象化した抽出クライアント越しに行い、`provider`（`gemini` | `ollama` | `workers-ai` | `anthropic`）と `model` を設定値（`LLM_PROVIDER` / wrangler var）で切替える。具体モデルID（例: Gemini は `gemini-flash` 系、Ollama は `qwen2.5` 等）は実装時に確定する。精度不足は管理サイトの検証NG率で観測し、上位モデル/別プロバイダへ差し替える（抽象化済みのため容易）。
- 呼出パラメータ: temperature 0。JSON 構造化出力は Gemini の `responseMimeType=application/json` + `responseSchema`（§3 の zod を JSON Schema 化）で担保する。出力上限は想定件数 × 60 トークン + 500 目安。
- 記録: ingest_runs に provider + model + in/out トークンを残す（プロバイダ横断でコスト・品質を比較）。`llm_model` は provider 込みの識別子（例: `gemini:gemini-flash`）とする。

### プロンプト v1 骨子

```
<role>
あなたは映画館の上映スケジュールページから上映情報を抽出する抽出器です。
</role>

<instructions>
- 与えられた HTML から、ページに掲載されている全日付の上映情報をすべて抽出し、
  指定の JSON スキーマのみで出力してください。説明文は出力しないでください。
- 各上映の date(YYYY-MM-DD) はページの表記から補完してください（基準月 {businessMonth}）。
  ページが単一日のみで日付が読み取れない場合は date を null にしてください
  （正規化時に businessDate へフォールバックする。vision_v1 と同じ意味論）。
- 上映時刻はページの表記のまま抽出してください（"25:10" のような表記もそのまま）。
- 終了時刻の記載がなければ endTime は null にしてください。推測しないでください。
- ページに存在しない情報を補完・創作しないでください。
- 上映が1件もない（休館日等）の場合は screenings を空配列にし、notes に理由を書いてください。
- ページ内の広告・公開予定作品（日付が対象日でないもの）は含めないでください。
</instructions>

<schema>{JSON Schema をここに展開}</schema>
<page url="{scheduleUrl}" businessDate="{businessDate}">{前処理済み HTML}</page>
```

### プロンプト vision_v1 骨子（画像・ADR-0012）

```
<role>あなたは映画館の月間スケジュール画像から上映情報を抽出する抽出器です。</role>
<instructions>
- 添付画像（月間スケジュール表）から、各上映の date(YYYY-MM-DD)/movieTitle/startTime を
  すべて読み取り、指定の JSON スキーマのみで出力してください。説明文は出力しないでください。
- 基準月は {businessMonth}（例 2026-07）。画像に日付が「7/12」等で書かれていれば date に補完してください。
- 時刻は画像の表記のまま（"25:10" 等もそのまま）。読み取れない項目は null。推測・創作をしないでください。
- 画像に無い情報を補完しないでください。判読不能な箇所は notes に記してください。
</instructions>
<schema>{JSON Schema をここに展開}</schema>
{画像を inline で添付}
```

設計上の要点:
- **「推測しないで null」を明示**する。LLM 抽出の主リスクは欠損の創作的補完。
- businessDate をプロンプトで与え、ページ上の別日タブ・公開予定を除外させる。
- 出力は JSON のみ。パース前に ```json フェンス除去の防御的処理を入れる。

## 5. 検証（Validation）

zod 検証通過後、以下の妥当性検証を行う。1つでも NG なら `validation_failed` としてレビューキューへ（D1 には書き込まない）。

| # | ルール | NG コード |
|---|---|---|
| V1 | screenings 件数が 0 のとき、notes に休館理由がない | `EMPTY_WITHOUT_REASON` |
| V2 | 件数が過去7日間の同劇場平均の 50%〜200% を逸脱（履歴3件未満ならスキップ） | `COUNT_ANOMALY` |
| V3 | 正規化後の start_at が businessDate の 06:00〜翌 04:00 (JST) を逸脱 | `TIME_OUT_OF_RANGE` |
| V4 | endTime ≠ null なのに end ≤ start（24時超え正規化後） | `NEGATIVE_DURATION` |
| V5 | 同一 (movieTitle, startTime) の重複 | `DUPLICATE_ROW` |
| V6 | movieTitle に HTML タグ・URL が混入 | `DIRTY_TITLE` |

- V2 は「サイト大改修で半分しか取れていない」を検出する主砲。閾値は運用しながら調整する（定数は設定ファイルで管理）。
- レビューキューで approve された payload は通常の書込関数で反映する（二重実装禁止）。

## 6. 正規化

1. **24時超え時刻**: `25:10` → businessDate + 1日の `01:10`。境界は 24:00〜29:59 を許容。
2. **endTime null の補完**: `movies.runtime_min` があれば `start + runtime + 10分（予告分）`、なければ同一 movie の他劇場実績、それもなければ `start + 120 + 10分` の既定値。補完した場合 `end_at_source = 'estimated'`。
3. **タイトル名寄せ**: `03_data-model.md` §6 の title_key 規則で movies に突合。
4. **detailPath**: 相対 URL は scheduleUrl 基準で絶対化。外部ドメイン（チケットベンダー等）はそのまま保持。

## 7. 失敗時の挙動

| 失敗点 | status | リトライ | 通知 |
|---|---|---|---|
| HTTP 取得失敗 / タイムアウト | `fetch_failed` | Queues 標準リトライ 3回（指数バックオフ、初回 5分後） | 3回失敗で Slack |
| LLM API エラー | `extraction_failed` | 2回（R2 スナップショットから再抽出。再取得はしない） | 2回失敗で Slack |
| JSON パース不能 / zod NG | `extraction_failed` | 1回（同一入力・同一プロンプトで再試行し、確率的失敗のみ救済） | 失敗継続で Slack |
| 妥当性検証 NG | `validation_failed` | 自動リトライなし | Slack + レビューキュー |

**再取得（先方サイトへの再アクセス）を伴うリトライは fetch_failed のみ。** それ以外は必ず R2 スナップショットを入力にする（N-06 の取得マナー遵守）。

実装（`packages/ingest/src/worker/`）:
- **fetch_failed**: Queue redelivery を利用する（Worker 側で意図的な再取得は行わない）。`queue()` consumer が `msg.attempts`（1始まり）を見て `msg.attempts < 3` なら `msg.retry({ delaySeconds })`（指数バックオフ: `300 * 2^(attempts-1)` 秒 = 5分・10分…）、`attempts >= 3` で `msg.ack()`（打ち切り）。Slack 通知は 3回目到達時のみ（`fail.ts` の `silent` フラグで attempts<3 は抑止）。管理サイト UI の手動取込（`trigger='manual'`）も **Queue に投入して cron と同じ consumer 経路で処理する**（後述の理由により fetch_failed の Queue 標準リトライも同様に適用される）。curl 直叩き用の `POST /admin/ingest`（P1-6 由来。スクリプト用途で即座に結果を返す契約）のみ Queue を経由せず同期実行のまま。
- **LLM API エラー / JSON パース不能 / zod NG**: 同一 Worker 呼出内で `extractVisionWithRetries`（`extract.ts`）がループでリトライする。fetch 済みの画像バイト（メモリ上・R2 保存済み）を使い回すため再取得しない。LLM API エラー（`client.extract()` 自体の throw）は最大2回、JSON パース不能（`ExtractionParseError`）と zod NG（`ExtractionResult.parse` の throw）は合算で最大1回（表の2行は同一予算を共有）。全リトライを使い切って初めて `extraction_failed` を確定し Slack 通知する（試行ごとには通知しない）。
- **手動取込を Queue 経由にした理由（孤児run バグの修正）**: 管理サイト UI の「取込を実行」はブラウザの HTTP リクエストに処理を同期させていたため、rendered＋LLM抽出（リトライ込みで数十秒〜数分）の途中でタブを閉じる／通信が切れると、Cloudflare Workers がレスポンス未送信のまま実行をキャンセルし、`status='extracting'` で `finished_at` が入らない孤児 run が発生していた（`ctx.waitUntil()` はレスポンス送信後 **最大30秒** しか延長できないため単純な早期return対応では不十分。実機で確認）。Queue consumer はブラウザ接続に紐づかないため、cron と同じ経路に乗せることで解消する。
- **孤児run の掃除（保険）**: 上記の修正後も、真にハングしたケースへの保険として、`db/ingest-runs.ts` の `reapStaleRuns()` が `queued`/`fetching`/`extracting` のまま15分以上動いていない run を `extraction_failed` に確定する。`/admin` ダッシュボード読込時に呼ばれる（新規 Cron は追加しない）。

## 8. コスト管理

- ingest_runs に in/out トークンを記録し、管理サイトで日次合計を表示。
- 日次トークン合計が設定閾値（初期: 500万 in-tokens/日）を超えたら Slack 警告（N-07）。
- 最適化の優先順（必要になってから着手）:
  1. 前日スナップショット diff によるスキップ
  2. 前処理の切り出し強化
  3. プロンプトキャッシュ（システム部の共通化）

## 9. テスト戦略

- `fixtures/` に各劇場の実 HTML スナップショット（匿名化不要、日付固定）を保存し、抽出のゴールデンテストを作る。
- LLM 呼出を含むテストは CI では録画リプレイ（保存済みレスポンス）で回し、実 API を叩く統合テストは手動トリガーのみ。
- **開発は Ollama（ローカル）で高速反復してよい（ADR-0011）が、抽出品質の確定は本番プロバイダ（Gemini）で行う**。プロンプト調整・ゴールデン期待値の作成・新劇場の active 昇格判断は Gemini の出力で検証する（モデル差で結果が変わるため。「Ollama で通った ≠ Gemini で通る」）。CI は provider に依らず録画リプレイ。
- 新劇場追加時の受入手順: 手動取込 → レビューキューで全件目視 → 3日連続 succeeded で active 昇格。
