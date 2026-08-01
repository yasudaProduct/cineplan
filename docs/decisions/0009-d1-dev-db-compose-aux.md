# ADR-0009: 開発DBはD1のまま、Docker Composeは周辺サービス用とする
- Status: Accepted
- Date: 2026-07-08

## Context
開発環境で Docker Compose を使いたい要望。一方、本番DBは Cloudflare D1（SQLite, ADR-0001）で、D1 は Compose でローカルに立てられない。

## Decision
開発DBは D1 のまま（wrangler の SQLite ローカルエミュレーション）とし、Docker Compose は DB本体ではなく開発補助サービス（R2代替の MinIO、駅すぱあと等の外部APIスタブ、Slack webhook モック、任意で Ollama）を束ねる用途に使う。

## Consequences
- 本番とローカルでDBエンジンが一致し（SQLite方言差の事故がない）、Hyperdrive等の追加要素も不要。
- ローカルで外部API・通知に実接続せず開発でき、取得マナー（08）とも整合。
- 制約: Compose で「本物のDBサーバ」を触る体験はできない。D1の制約（11 §8）に開発初期から向き合う必要がある。

## Alternatives considered
- DBを PostgreSQL に変更し Compose 運用（Hyperdrive経由接続）: 慣れたPostgresを使えるが、D1採用の利点（Workers統合・無料枠・運用レス）を捨てることになり、スモールスタート方針に反する。不採用。
- ローカルPostgres + クラウドD1 の二本立て: DB方言差でバグが埋もれるリスクが高く、テストの信頼性が下がる。不採用。
