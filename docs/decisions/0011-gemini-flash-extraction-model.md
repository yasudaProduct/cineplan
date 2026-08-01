# ADR-0011: 抽出 LLM を Gemini Flash（無料枠）に変更
- Status: Accepted
- Date: 2026-07-09
- Supersedes: ADR-0004

## Context
ADR-0004 で抽出モデルに Claude Haiku を採用したが、Anthropic API は従量課金で無料枠がほぼない。オーナーの意向はランニングコスト最小化（N-04: 月3,000円以内）で、無料または無料枠の大きい LLM を使いたい。抽出は日次・低頻度（5〜10館 × 1日1回 = 数十リクエスト/日、スケール上限30館でも30/日、1リクエストの入力HTMLは大きめ）で、Gemini 無料ティア（Flash 系: 1,500 req/日・15 RPM・1M TPM・クレカ不要）に対し桁違いに余裕がある。

## Decision
抽出の既定プロバイダを、**本番/ST は Google Gemini Flash（無料ティア）**、**ローカル開発は Ollama（ローカルモデル）** とする。呼び出しはプロバイダ抽象化した抽出クライアント越しに行い、`provider`（`gemini` | `ollama` | `workers-ai` | `anthropic`）と `model` を設定値（`LLM_PROVIDER` / wrangler var）で切替可能にする。JSON 構造化出力は Gemini の `responseMimeType=application/json` + `responseSchema`（docs/06 §3 の zod を JSON Schema 化）、Ollama の `format`（JSON schema）で担保する。Ollama は Workers 上で動かないため本質的に開発専用。

## Consequences
- LLM コストが実質 0円（無料枠内）になり N-04 に大きく余裕（docs/16 §7 更新）。
- **トレードオフ（コンプライアンス）**: 無料ティアは送信プロンプトが Google のモデル学習に使われうる。抽出対象は公開ページ（ログイン不要）の事実データ（劇場名・作品名・時刻）に限られ、生HTMLは前処理で script/style/画像/創作的表現を除去済み（docs/06 §2, docs/08 §4）だが、docs/08 §4「第三者提供しない」と緊張する。§4 に許容条件を追記した（公開事実データ限定・個人情報含有ページは対象外・拡大時は切替）。§0/§1 の最重要禁止事項は変更していない。
- 品質はオープンモデル/Flash 依存。P1 の fixture ゴールデンテスト（docs/06 §9）と管理サイトの検証NG率で監視し、不足なら上位モデル（Flash→Pro）or 別プロバイダへ差し替える。抽象化済みのため差し替えは容易。
- ingest_runs に provider + model + in/out トークンを記録し、プロバイダ横断でコスト・品質を比較可能にする。
- **開発は Ollama（ローカル・無料・オフライン）を既定にできる**: 反復開発でクォータを消費せず、生HTMLが一切外部に出ない（§4 の観点で開発時は最も安全）。ただし Ollama のローカルモデルは本番 Gemini と出力が異なるため、**抽出品質の確定（fixture ゴールデンテスト／プロンプト調整／新劇場の受入・active 昇格）は本番プロバイダ Gemini で検証する**。「Ollama で通った ≠ Gemini で通る」。Ollama はパイプライン/パース/正規化コードの反復に使い、品質のゲートは prod モデルで通す（docs/06 §9）。

## Alternatives considered
- **Cloudflare Workers AI**: Cloudflare完結・APIキー不要・入力を学習に使わず §4 整合が最も高い有力案。完全無料(0円)を優先するオーナー判断で次点とし、差し替え先（機密性上昇・規模拡大・学習利用を避けたい場合）として維持する。無料10k Neurons/日、超過は $0.011/1k Neurons。
- **Claude Haiku 継続（ADR-0004）**: 品質は堅いが無料枠ほぼ無しで方針と不一致。
- **Gemini 有料ティア**: 学習不使用だが無料枠の利点が消える。無料枠超過時の移行先。
