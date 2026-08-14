# ADR-0016: ST 自動デプロイの契機を `main` push から `develop` push に変更（0010 の訂正）
- Status: Accepted
- Date: 2026-07-20

## Context
ADR-0010 は ST の自動デプロイ契機を `main` push と定めた。しかし P1 以降、全ての feature/fix ブランチは一貫して `develop` へ PR マージされており（各フェーズの実装ブランチはロードマップに「〜（develop 派生）」と明記のとおり）、`develop` が事実上の統合ブランチとして運用されてきた。一方 `develop → main` の同期は PR #11（2026-07-16マージ）を最後に行われておらず、それ以降に `develop` へマージされた変更（PR #12〜#19。Workers Logs 可観測性導入・Gemini タイムアウト調査対応等を含む）は GitHub Actions 経由では ST に一切反映されていなかった（2026-07-20、ユーザーからの問い合わせを機に発覚）。実運用ではこれに気づかないまま、都度 `wrangler deploy --env st` の手動実行で埋め合わせていた。

## Decision
`ci.yml` の push トリガーおよび `deploy-st.yml` の push トリガーを `main` から `develop` に変更する。`develop` を実質的な統合・ステージングブランチとして扱い、そこへの push で CI と ST 自動デプロイが走るようにする。`main` は本番リリース候補ブランチとしての役割を維持し、`deploy-prod.yml`（`v*` タグ push + GitHub Environment `prod` の承認ゲート）はそのまま変更しない。本番リリース時は、タグを切る前に `develop` の内容を `main` に反映（PR または fast-forward）する運用とする。

## Consequences
- `develop` への feature/fix マージのたびに ST が自動で最新化され、手動デプロイへの依存が解消される。
- `main` は「prod リリース候補のスナップショット」という役割に純化される。**develop→main の同期を忘れたままタグを切ると、意図せず古いコードが本番へ出る**ため、リリース手順にこの同期ステップを明記する（14 §5.1 に追記）。
- ADR-0010 の3環境構成・prod 承認ゲート・マイグレーション順序・テストゲート（いずれも `main`/`develop` の使い分けとは独立）は変更なし。

## Alternatives considered
- **`develop → main` の統合PRを都度作成して ST 反映を維持**（ADR-0010 の設計のまま運用を正す）: `main` の履歴が常に「検証済みのリリース候補」を表す点はきれいだが、ステージング確認のたびに統合PRを作る手間が発生し、2026-07-16〜20の4日間で既に運用が形骸化していた実績がある。不採用。
