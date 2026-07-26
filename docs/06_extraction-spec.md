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
  → R2 保存 (raw/{theaterId}/{businessDate}/{fetchedAt}.html / .gif 等
             複数日取得（ADR-0019）は日ごとに {prefix}_d{date}.html も保存)
  → 前処理（text: HTML→抽出用テキスト / vision: 画像バイト→base64）
  → LLM 抽出（既定 Gemini Flash, JSON 構造化出力。ADR-0011。provider・方式は設定値）
  → zod スキーマ検証
  → 妥当性検証（レンジ・件数）
  → 正規化（24時超え時刻・名寄せ）
  → D1 洗い替え書込（businessDate 別に DELETE→INSERT, 03_data-model.md §7）
```

- vision で月間画像を扱う場合、1回の抽出が複数 businessDate を含む。抽出結果を screening の `date` でグルーピングし、対象範囲（翌日〜+7）を businessDate ごとに洗い替えする。
- **text は日単位分割呼出（`text_v2`。ADR-0017）**: まず「日付発見コール」でページ上の営業日付一覧（`{dates: []}`）を取得し、次に日付ごとに「その日の上映のみ抽出」を1呼出ずつ行う。全日の結果を1つの `ExtractionResult` にマージ（各 screening の `date` を対象日で確定）してから、洗い替え書込は従来どおり1回で行う。シネコンの週間ページ（例: 大阪ステーションシネマ ≒347上映/ページ）では一括出力が LLM の120秒タイムアウト内に生成しきれないため（出力律速）、1呼出の出力を1日分（≒数千トークン）に抑える。発見日付は昇順・重複除去・最大14日で切詰め。日付が1つも無いページ（描画失敗の殻等）は日別呼出をせず 0件+notes で成功させる。
- 失敗時の分岐は §7。

## 2. 前処理（トークン圧縮）

目的: LLM 入力トークンを減らしコストと誤抽出を抑える。**やりすぎて情報を落とすくらいなら素通しに近い方が安全**（Gemini Flash のコンテキストには余裕がある。無料枠 1M TPM に対し1回 in 50k tok 想定）。

1. `<script>` `<style>` `<svg>` `<noscript>` コメントを除去。
2. 属性は `href` のみ残し他を除去（detail_url 抽出のため）。
3. 連続空白・空行を圧縮。
4. テキスト化: HTML タグを保ったまま（表構造の手掛かりになるため Markdown 変換はしない。タグ簡約のみ）。
5. 上映スケジュールらしき領域の切り出しは**行わない**（ヒューリスティックがサイト依存になるため）。将来コスト最適化が必要になったら「前日スナップショットとの diff が閾値未満なら抽出スキップ」を先に導入する（画像は Last-Modified / バイト一致で判定）。
6. **常に無情報と言えるノイズ領域のみ除去する**（2026-07-20 追加。5とは別軸: 5は「サイト依存のヒューリスティックでスケジュール領域を当てにいく」ことの禁止、6は「HTML5の意味論・実装上の制約から常に安全と言える除去」の許可）。`header`/`footer`/`nav`（HTML5上サイト共通のチロム）・`meta`/`link`（void要素）・`img`（href以外の属性を保持しない実装のため常に無内容）は無条件除去。`figure`/`iframe`はタグを剥がした結果が空文字の場合のみ除去（キャプション付きfigure等、テキストを含む場合は保持する安全側の実装）。大阪ステーションシネマの実データで検証済み（27,862字→21,303字・24%減、時刻347件・detailPathの一意性30件とも完全一致）。実装は`worker/preprocess.ts`の`stripNoise`。

### 2.0 rendered（JS 描画サイト）の取得（P4-7）
- `fetch_method=rendered` の劇場は Cloudflare Browser Rendering（`BROWSER` バインディング + @cloudflare/puppeteer）で描画後の DOM を取得する。1回の取込 = 1回のページロード（既定 `fetch_day_mode='single'`）。`tabs` の劇場は同一ページ上で日付タブを順にクリックし、1日1文書分の DOM を取得する（§2.2）。取得マナーは static と同じ（正直 UA・30s タイムアウト。docs/08 §3）。
- 描画後 HTML を R2 に保存し（`{prefix}.html`。複数日取得時は各日 `{prefix}_d{date}.html` も）、以降の再抽出はこのスナップショットから行う（先方再取得なし）。画像のダウンロードは行わない（rendered は text 抽出前提）。
- ローカル開発でも `wrangler dev` がローカル Chromium を起動するため実機同等に検証できる（docs/14 §8）。

### 2.2 複数日取得（fetch_day_mode。ADR-0019）

1ページに1日分しか掲載しないサイト（T・ジョイ梅田等）向けに、**劇場ごとの設定**で1セッション内に複数日分のページを取得する。取得マナー（5秒間隔・直列・上限）は docs/08 §0・§3 が正。

- `fetch_day_mode`: `single`（既定・現行動作＝1ページ）/ `tabs`（Browser Rendering で日付タブを順にクリック。`fetch_method=rendered` 必須）/ `url_template`（`schedule_url` の `{date}` を置換して日付ごとに静的取得。`fetch_method=static`）。
- `fetch_days`: 取得日数。`0` = 検出したタブ全件（`tabs` のみ）。いずれもコード側の絶対上限 `MAX_FETCH_DAYS`=10 で頭打ち（`packages/shared`。DB の CHECK・zod・fetch 実装の三重で守る）。
- 対象は `extract_method=text` のみ（vision は月間画像に複数日が含まれるため不要）。
- **タブ検出は構造非依存**（ADR-0003）: CSS セレクタで狙い撃ちしない。「値が `YYYY-MM-DD` に完全一致する属性を持つ、表示中の要素」を属性名に依存せず収集し、重複除去・昇順・**当日以降のみ**に絞る（過去日を混ぜると洗い替え範囲が過去へ広がり履歴を消すため）。検出0件なら `single` と同じ挙動に自動フォールバックする。
- **クリック後の待機**: `goto` の `networkidle0` はクリックには効かない。`waitForNetworkIdle`（best-effort）+ **本文テキスト（`body.innerText`）のシグネチャ変化**のポーリングで AJAX 到着を検出し、変化後に1周期分の安定を確認してから DOM を取得する。`page.content()` のハッシュを使わないのは、タブの active クラス付替えだけで変化して AJAX 到着前の DOM を掴む誤検出を避けるため。
- **本文変化と独立に「同一オリジンの XHR/fetch が飛んだか」も数える**（`page.on('response')` + `resourceType`。第三者の広告・計測は host 一致で除外）。**シネコンの平日は編成が完全に同一になることがあり、本文変化だけでは「前日と同じ内容」と「AJAX 未着」を区別できない**ため（実測: T・ジョイ梅田で月→火→水が同一編成のため 7/28・7/29 を誤って捨てた。2026-07-25）。判定は次のとおり:
  - 本文が変化した → 採用
  - 本文は不変だが同一オリジン XHR が飛んだ → **採用**（前日と編成が同じ正当な日。`fetch.tabs.same_content` に記録）
  - どちらも無い → クリックが何も起こしていないため**その日を捨てて notes に記録**（1日目のみ「初期表示がその日だった」として採用）
- R2: 既定文書は従来どおり `{prefix}.html`（`days[0]` と同内容）、各日は `{prefix}_d{date}.html`。vision の `{prefix}_{n}.{gif|png|jpg}` とは拡張子で分離される。
- 抽出は文書ごとに日付が既知のため**日付発見コールを行わず**、文書1つにつき日別コールを1回だけ呼ぶ（§4）。

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
- プロバイダ/モデル: **本番/ST 既定 Google Gemini Flash 系（無料ティア。ADR-0011）、ローカル開発は Ollama 既定**。呼び出しはプロバイダ抽象化した抽出クライアント越しに行い、`provider`（`gemini` | `ollama` | `workers-ai` | `anthropic`）と `model` を設定値（`LLM_PROVIDER` / wrangler var）で切替える。精度不足は管理サイトの検証NG率で観測し、上位モデル/別プロバイダへ差し替える（抽象化済みのため容易）。
- **モデルは方式（modality）ごとに指定する（ADR-0020）**。`createLlmClient(env, modality)` に `'text' | 'vision'` を明示的に渡す。
  - **text**: `GEMINI_MODEL`。ST/prod は `gemini-flash-lite-latest`（ADR-0018。最上位 Flash が無料枠の容量逼迫で 503／応答保留になるため）。
  - **vision**: `GEMINI_MODEL_VISION`。既定 `gemini-flash-latest`。**Flash-Lite は月間グリッド画像の日付列を読み取れず、全日程を単一日に潰す**ことが実データで判明したため（ADR-0020）。同一プロンプト `vision_v1`・同一画像で最上位 Flash は 136件を正しく分散できている。
  - **モデルやプロンプトを変更するときは text と vision の両パスで実データ検証を行う**。ADR-0018 は text の実測のみで両パスに適用してしまい、vision 劇場が1館しかないため回帰が見逃された。
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

### プロンプト text_v3 骨子（日単位分割・現行版・ADR-0017）

`text_v2` の後継（本番経路の現行版）。**基準日 `businessDate`（当日）を発見・日別の両コールに `<page businessDate=...>` 属性で渡す**点が v2 との違い。T・ジョイ梅田（tjoy.jp / KINEZO系）のように、当日分のスケジュールが**日付見出し無し**でページ先頭に並び（日付はタブの "7/22" のみ）、先行販売の将来日だけ見出し付きのページで、v2 が当日分（43件）を丸ごと取りこぼした事例への対策（2026-07-22 実データで確認・実証。修正後 27→70件・当日43件を回収）。

- system: 「ページ先頭付近に日付見出し無しで上映(HH:MM)が並ぶブロックは、ページ既定表示の当日分。基準日の上映として扱う」を明示。
- 発見コール: 「ページ先頭に日付見出し無しで上映が並ぶ当日ブロックがあれば、その日付は基準日 `{businessDate}` として必ず含める」。
- 日別コール: 「対象日が当日（`{businessDate}`）と同じ場合、ページ先頭の日付見出し無し当日ブロックも対象日の上映として抽出する」。
- 版管理規則どおり `text_v2.ts` は変更せず新版追加。`text_v3` を `prompt_version` に記録。

### プロンプト text_v2 骨子（日単位分割・ADR-0017。text_v3 に置換済み）

`text_v1`（全日付一括）の後継。system プロンプトは共通で、ユーザーテキスト末尾の `<task>` で「日付一覧」「対象日抽出」の2タスクを切替える。

```
system:
  あなたは映画館の上映スケジュールページ（HTML）から情報を抽出する抽出器です。
  ユーザーメッセージ末尾の <task> の指示に従い、指定の JSON スキーマのみで出力してください。
  - 日付は基準月 {businessMonth} でページ表記（例 7/12(土)）から YYYY-MM-DD に補完
    （前月・翌月の表記はその月で。v1 と同じ規則）。
  - 推測・創作をしない。読み取れない項目は null。異常は notes に記す。
  - （v1 の抽出規則: HH:MM のみ・広告/公開予定除外・format/screenName/detailPath 等を踏襲）

user（日付発見コール。responseFormat='dateList' → ExtractedDateList スキーマ）:
  <page url="{scheduleUrl}" businessMonth="{businessMonth}">{前処理済み HTML}</page>
  <task>このページに上映スケジュールが掲載されている営業日付をすべて列挙してください。
  上映の掲載が無い日付・公開予定作品の日付は含めないでください。1件も無ければ空配列にし notes に理由を。</task>

user（日別抽出コール。responseFormat='extraction' → ExtractionResult スキーマ）:
  <page url="{scheduleUrl}" businessMonth="{businessMonth}">{前処理済み HTML}</page>
  <task>対象日 {date} の上映情報のみをすべて抽出してください。businessDate は {date}。
  他の日付の上映は出力しないでください。対象日の上映が無ければ screenings を空配列に。</task>
```

- **`<page>`（全文）を先頭・`<task>` を末尾に置く**: 全呼出でプレフィックスが同一になり、課金枠に戻した場合に Gemini の暗黙キャッシュが効く配置（無料枠では効果なしだが設計として固定する）。
- 日別呼出の応答に対象日以外の `date` を持つ行が混ざった場合、実装側で**除外**し notes に件数を記録する（別日に書き換えない。幻覚行を対象日の偽上映にしないため）。
- 発見・日別とも `prompt_version='text_v2'` を記録する。
- **複数日取得（ADR-0019）では日別コールのみを、基準日 `businessDate` に対象日そのものを入れて呼ぶ**（1文書＝その日1日分のため、「日付見出しの無い先頭ブロックは基準日の分」という規則がそのまま効く）。日付発見コールは行わない。プロンプト本文は text_v3 のまま（新版は作らない）。

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
| V2 | 件数が過去7日間の同劇場平均の 50%〜200% を逸脱（履歴**2件**未満ならスキップ） | `COUNT_ANOMALY` |
| V3 | 正規化後の start_at が businessDate の 06:00〜翌 04:00 (JST) を逸脱 | `TIME_OUT_OF_RANGE` |
| V4 | endTime ≠ null なのに end ≤ start（24時超え正規化後） | `NEGATIVE_DURATION` |
| V5 | 同一 (movieTitle, startTime) の重複 | `DUPLICATE_ROW` |
| V6 | movieTitle に HTML タグ・URL が混入 | `DIRTY_TITLE` |
| V7 | 同一 (businessDate, screenName) で上映時間帯が重複、または開始時刻が完全一致する別作品 | `SCREEN_TIME_OVERLAP` |

- V2 は「サイト大改修で半分しか取れていない」を検出する主砲。閾値は運用しながら調整する（定数は設定ファイルで管理）。
- **V2 の履歴下限は当初 3 件だったが、2026-07-26 に 2 件へ下げた**（ADR-0020）。シネ・ヌーヴォの成功 run が2件（145/136件）しか無い状態で 22 件へ激減した run が V2 を素通りし、洗い替えで6日分のデータを失う事故が起きたため。2件でも平均としての意味はあり、50〜200% は十分ゆるい。誤検知はレビューキューでの人間確認に落ちるだけで、データ損失より軽い。
- **V7（2026-07-26 追加・ADR-0020）**: 1つのスクリーンで時間帯が重なる上映は物理的に存在しない。**月間グリッド画像の全日程が単一日に潰れる**類の日付誤りを確実に検出する（正規化後に判定＝`validateNormalized`）。誤検知を避けるため:
  - `screenName` が空文字の劇場（サイトがスクリーンを公開していない。例: **大阪ステーションシネマ**は355件すべて空）はスキップする。並行上映が1グループに畳まれ、全件が重複扱いになるため。**この劇場群では V7 は効かず V2 が主防御になる**。
  - 重複判定は**両方の endAt が site 由来のときのみ**（`endAtSource='estimated'` は推定尺のため尺違いで誤検知しうる）。
  - ただし**開始時刻が完全一致する別作品**は endAt の由来に関わらず NG とする（1スクリーンが同一分に2作品を開始できない）。二本立てを1つの開始時刻で併記するサイトでは誤検知しうるが、その場合はレビューキューで承認すればよい。
- レビューキューで approve された payload は通常の書込関数で反映する（二重実装禁止）。
- **検証は書込より前に走る**（`validateNormalized` → `normalizeResolveWrite`）。したがって V3/V4/V7 で弾かれた run は D1 を一切変更しない＝洗い替えによるデータ損失も起きない。これが V7 を「日付誤りの主防御」として置く理由。

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
- **LLM API エラー / JSON パース不能 / zod NG**: 同一 Worker 呼出内で `extractVisionWithRetries` / `extractTextDaySplit`（`extract.ts`）がループでリトライする。fetch 済みの入力（メモリ上・R2 保存済み）を使い回すため再取得しない。LLM API エラー（`client.extract()` 自体の throw）は最大2回、JSON パース不能（`ExtractionParseError`）と zod NG（スキーマ `.parse` の throw）は合算で最大1回（表の2行は同一予算を共有）。**このリトライ予算は LLM 呼出1回ごとに適用される**（text の日単位分割では日付発見コール・各日別コールがそれぞれ独立の予算を持つ。ADR-0017）。いずれかの呼出が予算を使い切った時点で run 全体を `extraction_failed` に確定し Slack 通知する（試行ごとには通知しない）。
- **抽出デッドライン（text 日分割・ADR-0017）**: 分割により run の抽出合計時間が伸びる（正常時 4〜8分）ため、run 内の抽出開始から **10分** のデッドラインを設け、各 LLM 呼出の前に判定する（超過時は `extraction_failed`。error_message に処理済み日数を残す）。Queue consumer の実行上限（約15分/起動）の内側に必ず収めるための安全弁。
- **複数日取得（ADR-0019）の fetch 失敗と run 予算**: `url_template` の**初日**の取得失敗は `fetch_failed`（URL 設定ミスを黙って通さない）、2日目以降の失敗はその日をスキップして notes に記録し続行する（先行販売未掲載の日が404を返す等は正常）。`tabs` はタブが見つからない／内容が変化しない日をスキップして notes に記録する。fetch 自体は抽出デッドラインの外側で時間を使うため、pipeline は run 全体の予算（12分）から経過時間を差し引いて抽出デッドラインを算出して渡す。**複数日取得では1日以上成功していればデッドライン到達で打ち切って部分結果を返す**（未取得日は洗い替え範囲に入らないため既存データは消えない）。0日なら単日経路と同じく `extraction_failed`。
- **手動取込・再抽出を Queue 経由にした理由（孤児run バグの修正）**: 管理サイト UI の「取込を実行」「このスナップショットで再抽出」はいずれもブラウザの HTTP リクエストに処理を同期させていたため、rendered＋LLM抽出（リトライ込みで数十秒〜数分）の途中でタブを閉じる／通信が切れると、Cloudflare Workers がレスポンス未送信のまま実行をキャンセルし、`status='extracting'` で `finished_at` が入らない孤児 run が発生していた（`ctx.waitUntil()` はレスポンス送信後 **最大30秒** しか延長できないため単純な早期return対応では不十分。実機で確認）。Queue consumer はブラウザ接続に紐づかないため、cron と同じ経路に乗せることで解消する。**当初は再抽出を「先方サイトへのアクセスが無く比較的短時間で終わる」として対象外にしていたが、大きな rendered ページ（テアトル梅田等）では抽出そのもの（Gemini呼出のリトライ）だけで数分かかることが実機で判明し、再抽出にも同じ孤児化が起きたため対象を拡張した**（2026-07-19）。Queue メッセージは `{theaterId, trigger}`（取込）と `{reextractRunId}`（再抽出）の2形を受け付ける。
- **孤児run の掃除（保険）**: 上記の修正後も、真にハングしたケースへの保険として、`db/ingest-runs.ts` の `reapStaleRuns()` が `queued`/`fetching`/`extracting` のまま30分以上動いていない run を `extraction_failed` に確定する（text 日分割の正常上限=抽出デッドライン10分+呼出中の超過猶予+fetch を余裕をもって上回る値。ADR-0017 で 20分→30分）。`/admin` ダッシュボード読込時に呼ばれる（新規 Cron は追加しない）。掃除した run の id はログ（`reap.done`）に残る。
- **観測性（Workers Logs。2026-07-19 追加）**: 上記のすべての段階が構造化ログ（`src/log.ts`）を Workers Logs に出力する。`run.start` → `run.fetch.ok` → `run.extract.ok/fail` → `run.done` 等のイベントを `runId` でフィルタすると1回の取込の全行程を時系列で追跡できる。LLM 呼出の失敗は **timeout / http（status 付き。429=レート制限）/ network** に分類し、リトライ予算切れ時は試行回数の内訳を `error_message` に前置する（管理画面の error_message 単体で原因を即断できるようにする）。イベント台帳は `packages/ingest/README.md`、ログの見方は `16` §6。

## 8. コスト管理

- ingest_runs に in/out トークンを記録し、管理サイトで日次合計を表示。
- 日次トークン合計が設定閾値（初期: 500万 in-tokens/日）を超えたら Slack 警告（N-07）。
- **日単位分割（ADR-0017）の予算感**: 呼出数は劇場あたり 1+日数（週間ページで8回/取込。現行4館 ≒25回/日・10館全て週間ページでも ≒90回/日）で、無料枠 1,500 req/日（ADR-0011）に対し十分小さい。**複数日取得（ADR-0019）は日付発見コールが無いため「日数」回**（1回少ない）。1文書＝1日分で小さいぶん in トークンも抑えられる。入力（ページ全文）を日数分再送するため in トークンは 約8万/run（21k字ページ×8呼出）だが、500万 in-tok/日 閾値にも遠い。Queue が直列（`max_concurrency=1`）のため RPM/TPM は分割前と変わらない。
- 最適化の優先順（必要になってから着手）:
  1. 前日スナップショット diff によるスキップ
  2. 前処理の切り出し強化
  3. プロンプトキャッシュ（システム部の共通化）

## 9. テスト戦略

- `fixtures/` に各劇場の実 HTML スナップショット（匿名化不要、日付固定）を保存し、抽出のゴールデンテストを作る。
- LLM 呼出を含むテストは CI では録画リプレイ（保存済みレスポンス）で回し、実 API を叩く統合テストは手動トリガーのみ。
- **開発は Ollama（ローカル）で高速反復してよい（ADR-0011）が、抽出品質の確定は本番プロバイダ（Gemini）で行う**。プロンプト調整・ゴールデン期待値の作成・新劇場の active 昇格判断は Gemini の出力で検証する（モデル差で結果が変わるため。「Ollama で通った ≠ Gemini で通る」）。CI は provider に依らず録画リプレイ。
- 新劇場追加時の受入手順: 手動取込 → レビューキューで全件目視 → 3日連続 succeeded で active 昇格。
