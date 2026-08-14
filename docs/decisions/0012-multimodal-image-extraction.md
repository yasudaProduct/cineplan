# ADR-0012: 画像スケジュールをマルチモーダルLLMで抽出
- Status: Accepted
- Date: 2026-07-10
- Extends: ADR-0003

## Context
P1 の1館目選定で、ユーザー指定の eiga.com は robots.txt（AIクローラー全面ブロック）・利用規約（複製/再利用の全面禁止）・アグリゲーター（ADR-0002 に反する）で採用不可と判明。代替として大阪の独立系（シネ・ヌーヴォ／シアターセブン／第七藝術劇場）を実査したが、いずれも上映時刻表をテキストHTMLで持たず、月間スケジュール画像（GIF/JPG）または外部チケットシステム（sboticket.net）で提供していた。日本のミニシアターに共通の傾向。一方メジャー系（TOHO 等）は JS 描画で P4-7（Browser Rendering）の領域。

## Decision
HTML→text 抽出（ADR-0003）に加え、**画像スケジュール（GIF/JPG/PDF）をマルチモーダルLLMで直接、構造化抽出する経路**を設ける。劇場ごとに抽出方式を `theaters.extract_method`（`text` | `vision`）で持つ。P1 の1館目シネ・ヌーヴォは `vision`。既定プロバイダはビジョンも Gemini（本番/ST）、開発は Ollama のビジョン対応モデル（qwen2-vl / llama3.2-vision）or 画像時のみ Gemini（ADR-0011）。

## Consequences
- ミニシアターの画像スケジュールをそのまま取り込め、JS 描画基盤（Browser Rendering）無しで P1 を完結できる。ADR-0003（構造非依存の意味抽出）の自然な拡張。
- 月間画像は複数 businessDate を含むため、抽出スキーマに日付が必要 → `ExtractedScreening` に `date` を追加（docs/06 §3）。
- 画像そのものは複製・再配布しない（事実データのみ抽出。docs/08 §4・原則1）。R2 に保存する生画像は内部の再抽出用のみ。
- コンプラの学習利用トレードオフ（ADR-0011 §4）は画像でも同じ（公開事実データ限定）。
- 密な月間グリッド画像の読み取り精度が新たなリスク。V1〜V6 の妥当性検証（特に V2 件数）＋レビューキュー＋Gemini での品質確定で担保する。

## Alternatives considered
- **テキストHTMLの劇場を探し続ける**: 大阪では純テキスト静的スケジュールの館が少数で不確実。将来見つかれば text 経路で併用。
- **メジャー系を Browser Rendering（P4-7 前倒し）**: はしごの本命だが実装量大（headless browser 基盤）。P4-7 のまま据え置き。
- **画像を OCR→text 抽出**: OCR 依存が増える。マルチモーダルLLMが OCR+構造化を一括で行える方が単純。
