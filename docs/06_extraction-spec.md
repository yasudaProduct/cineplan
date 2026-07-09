# 抽出仕様 — LLM ベース上映スケジュール抽出

- Version: 0.1
- 対象: `packages/ingest/src/extraction/`
- 原則: **構造非依存**。CSS セレクタで狙い撃ちせず、テキスト化した HTML から LLM が意味的に抽出する。サイトのマイナーな構造変更で壊れないことを設計目標とする。

## 1. パイプライン全体

```
Fetch (static fetch / Browser Rendering)
  → R2 保存 (raw/{theaterId}/{businessDate}/{fetchedAt}.html)
  → 前処理（HTML → 抽出用テキスト）
  → LLM 抽出（既定 Gemini Flash, JSON 構造化出力。ADR-0011。provider は設定値）
  → zod スキーマ検証
  → 妥当性検証（レンジ・件数）
  → 正規化（24時超え時刻・名寄せ）
  → D1 洗い替え書込（DELETE→INSERT, 03_data-model.md §7）
```

失敗時の分岐は §7。

## 2. 前処理（トークン圧縮）

目的: LLM 入力トークンを減らしコストと誤抽出を抑える。**やりすぎて情報を落とすくらいなら素通しに近い方が安全**（Gemini Flash のコンテキストには余裕がある。無料枠 1M TPM に対し1回 in 50k tok 想定）。

1. `<script>` `<style>` `<svg>` `<noscript>` コメントを除去。
2. 属性は `href` のみ残し他を除去（detail_url 抽出のため）。
3. 連続空白・空行を圧縮。
4. テキスト化: HTML タグを保ったまま（表構造の手掛かりになるため Markdown 変換はしない。タグ簡約のみ）。
5. 上映スケジュールらしき領域の切り出しは**行わない**（ヒューリスティックがサイト依存になるため）。将来コスト最適化が必要になったら「前日スナップショットとの diff が閾値未満なら抽出スキップ」を先に導入する。

## 3. 抽出スキーマ（zod / packages/shared）

```ts
export const ExtractedScreening = z.object({
  movieTitle: z.string().min(1),          // サイト表記のまま。正規化は後段
  startTime: z.string().regex(/^\d{1,2}:\d{2}$/),   // "25:10" 等の24時超え許容
  endTime: z.string().regex(/^\d{1,2}:\d{2}$/).nullable(), // 記載なければ null
  format: z.string().nullable(),          // "IMAX", "字幕" 等。表記のまま
  screenName: z.string().nullable(),      // "スクリーン7" 等。参考情報
  detailPath: z.string().nullable(),      // 作品詳細への相対/絶対 URL
});

export const ExtractionResult = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // ページに明示された対象日
  screenings: z.array(ExtractedScreening),
  notes: z.string().nullable(),           // LLM が気付いた異常（"休館日と記載" 等）
});
```

## 4. プロンプト設計

- 場所: `packages/ingest/src/extraction/prompts/v{N}.ts`。**プロンプトは必ずバージョン番号付きファイルで管理し、ingest_runs.prompt_version に記録する**（過去実行の再現のため）。既存バージョンのファイルは変更せず、修正は新バージョン追加で行う。プロンプト本文はプロバイダ非依存に保つ。
- プロバイダ/モデル: **本番/ST 既定 Google Gemini Flash（無料ティア。ADR-0011）、ローカル開発は Ollama 既定**。呼び出しはプロバイダ抽象化した抽出クライアント越しに行い、`provider`（`gemini` | `ollama` | `workers-ai` | `anthropic`）と `model` を設定値（`LLM_PROVIDER` / wrangler var）で切替える。具体モデルID（例: Gemini は `gemini-flash` 系、Ollama は `qwen2.5` 等）は実装時に確定する。精度不足は管理サイトの検証NG率で観測し、上位モデル/別プロバイダへ差し替える（抽象化済みのため容易）。
- 呼出パラメータ: temperature 0。JSON 構造化出力は Gemini の `responseMimeType=application/json` + `responseSchema`（§3 の zod を JSON Schema 化）で担保する。出力上限は想定件数 × 60 トークン + 500 目安。
- 記録: ingest_runs に provider + model + in/out トークンを残す（プロバイダ横断でコスト・品質を比較）。`llm_model` は provider 込みの識別子（例: `gemini:gemini-flash`）とする。

### プロンプト v1 骨子

```
<role>
あなたは映画館の上映スケジュールページから上映情報を抽出する抽出器です。
</role>

<instructions>
- 与えられた HTML から、{businessDate} の上映情報をすべて抽出し、
  指定の JSON スキーマのみで出力してください。説明文は出力しないでください。
- 上映時刻はページの表記のまま抽出してください（"25:10" のような表記もそのまま）。
- 終了時刻の記載がなければ endTime は null にしてください。推測しないでください。
- ページに存在しない情報を補完・創作しないでください。
- 上映が1件もない（休館日等）の場合は screenings を空配列にし、notes に理由を書いてください。
- ページ内の広告・公開予定作品（日付が対象日でないもの）は含めないでください。
</instructions>

<schema>{JSON Schema をここに展開}</schema>
<page url="{scheduleUrl}" businessDate="{businessDate}">{前処理済み HTML}</page>
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
