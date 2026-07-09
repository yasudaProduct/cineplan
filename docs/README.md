# docs/ — ドキュメント索引

映画館はしごスケジューリングサービスの設計ドキュメント一式。Claude Code での開発時は、着手するタスクに対応するドキュメントを必ず読み込んでから実装すること。

| # | ファイル | 内容 | 状態 |
|---|---|---|---|
| 01 | `01_requirements.md` | 要件定義（機能要件 F-xx / 非機能要件 N-xx / スコープ / 前提） | Draft |
| 02 | `02_glossary.md` | 用語集・命名規則・ステータス値の正規定義 | Draft |
| 03 | `03_data-model.md` | D1 スキーマ（DDL）/ R2 / KV 設計・ライフサイクル | Draft |
| 04 | `04_api-spec.md` | コア API の OpenAPI 3.1 定義 | Draft |
| 05 | `05_routing-algorithm.md` | ルート算出 DP の定式化・k-best・テストケース | Draft |
| 06 | `06_extraction-spec.md` | LLM 抽出パイプライン・プロンプト・検証ルール | Draft |
| 07 | `07_screens.md` | Web / 管理サイトの画面設計・遷移 | Draft |
| 08 | `08_compliance-policy.md` | スクレイピング・コンプライアンスポリシー（最重要制約） | Draft |
| 09 | `09_roadmap.md` | タスク分解・開発ロードマップ | Draft |
| 10 | `10_adr/` | Architecture Decision Records（0001〜0010） | Draft |
| 11 | `11_d1-implementation.md` | D1 実装詳細（マイグレーション・クエリ・アクセス層） | Draft |
| 12 | `12_dp-implementation.md` | DP 実装詳細（参照実装・**検算済み期待値テスト**） | Draft |
| 13 | `13_claude-code-kickoff.md` | Claude Code 起動プロンプト（フェーズ別テンプレ付き） | Draft |
| 14 | `14_environments-deploy.md` | 環境構成（local/st/prod）・Docker Compose・GitHub Actions | Draft |
| 15 | `15_folder-structure.md` | リポジトリフォルダ構成（ツリー・パッケージ依存） | Draft |
| 16 | `16_human-setup-guide.md` | 人間（オーナー）が行う作業の手順（アカウント・課金・規約確認・承認・運用） | Draft |

※ リポジトリルートに `CLAUDE.md`（Claude Code エントリポイント）あり。

## ドキュメント間の優先順位（矛盾時）

1. `02_glossary.md`（命名・用語） — すべてに優先
2. `01_requirements.md`（何を作るか）
3. `03`〜`07`（どう作るか） — 実装と食い違ったらドキュメントを先に直してから実装を直す
4. `11`〜`12`（実装詳細） — 論理設計（03/05）と食い違ったら、まず両者どちらが正しいか判断して片方を直す。期待値（12 §7）は検算済みのため、原則こちらを正とする

## 実装時の不変条件（全ドキュメント共通）

- 取得した上映スケジュールは内部ロジック専用。劇場×日付の上映一覧を返す API・画面を作らない。
- 先方サイトへのアクセスは最小限（日次1回原則・再処理は R2 スナップショットから）。
- zod スキーマ（packages/shared）が型の単一の真実。API/DB/フロントで別定義を作らない。
