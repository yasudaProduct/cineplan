# ADR-0018: ST/prod の抽出モデルを `gemini-flash-lite-latest` に変更（0011 のモデル指定の更新）
- Status: Accepted
- Date: 2026-07-21

## Context

ADR-0011 以来、ST/prod は `GEMINI_MODEL` 未設定の既定値 `gemini-flash-latest`（Flash 最上位系の最新安定版を指すエイリアス）で抽出してきた。2026-07-21、日単位分割（ADR-0017）の ST 検証で、出力が数十トークンしかない日付発見コールまでもが 120 秒×3回のタイムアウトで失敗し、ローカルからの直接 API 実測で原因が確定した:

- `gemini-flash-latest` / `gemini-3.5-flash`: **503 UNAVAILABLE「This model is currently experiencing high demand」**。無料枠の容量逼迫で、即時 503 か応答保留（→クライアント側 120 秒打ち切り）になる。ST の取込は 2026-07-20 の無料枠復帰以降、全てこれで失敗していた（出力量とは別の第2の障害）。
- `gemini-2.5-flash` / `gemini-2.5-flash-lite`: **404「no longer available to new users」**。旧世代はこの1週間で新規利用不可になっており、旧固定IDへのピン留めは選択肢にない。
- `gemini-3.1-flash-lite`（= エイリアス `gemini-flash-lite-latest`）: **正常**。実データ（大阪ステーションシネマの週間ページスナップショット）で日付発見 1.5 秒（7/24-25 を「未定のため除外」と正しく判断）、日別抽出 18.4 秒・69件（期待値 347セル÷5日と一致）・対象日外混入ゼロ・29作品・detailPath 保持と、品質・速度とも十分だった。

## Decision

`packages/ingest/wrangler.toml` の `[env.st.vars]` / `[env.prod.vars]` に `GEMINI_MODEL = "gemini-flash-lite-latest"` を設定し、抽出モデルを Flash-Lite 系の最新安定版エイリアスに変更する。固定IDでなくエイリアスを使うのは、旧世代の提供打ち切り（上記 2.5 系）が実際に起きており、ピン留めはある日突然 404 で全取込が止まるリスクの方が大きいため。コード変更は不要（`llm/index.ts` は元々 `GEMINI_MODEL` を参照している）。

## Consequences

- 無料枠での安定性が回復する（Lite 系は最上位 Flash より契約者負荷が軽く、容量逼迫に巻き込まれにくい）。速度も向上し（実測 約460 tok/s）、日分割の1呼出は数十秒で余裕を持って完了する。
- モデル世代がエイリアスで自動的に進む（挙動が変わりうる）。品質は従来どおりレビューキュー（V1〜V6）と管理サイトの抽出検証表示（ADR-0015）で監視し、劣化が見えたら本 ADR を見直す。
- 最上位 Flash に戻したくなった場合は var を削除するだけでよい（既定値 `gemini-flash-latest` に戻る）。

## Alternatives considered

- **`gemini-flash-latest` のまま容量回復を待つ**: 2026-07-20〜21 の2日間、ST の全取込が失敗し続けており、回復時期の見通しが立たない。不採用。
- **旧世代の固定ID（`gemini-2.5-flash` 等）へピン留め**: 既に 404（新規利用不可）。エイリアス運用の方が提供打ち切りに強いことがこの1週間で実証された。不採用。
- **503/timeout 時に Lite へフォールバックする実装**: モデル二重化はリトライ・品質比較の複雑さが増す。単一モデル＋設定切替で十分なため見送り（将来必要になれば再検討）。
