# 環境構成・デプロイ設計 — ローカル / ST / 本番

- Version: 0.1
- 関連: `11_d1-implementation.md`（マイグレーション）, `08_compliance-policy.md`（シークレット・取得マナー）, ADR-0001（Cloudflare採用）
- 方針決定: 開発DBは **Cloudflare D1（SQLite）のまま**。D1 は Docker Compose で立てられないため、Compose はDB本体ではなく周辺サービス（モック等）に用いる（§2）。

## 1. 環境一覧（3環境）

| 環境 | 用途 | 実行場所 | DB | デプロイ契機 |
|---|---|---|---|---|
| **local** | 日常開発・単体/結合テスト | 開発機（wrangler dev + Docker Compose） | D1 local（SQLite emulation）| なし（手元実行） |
| **st** | クラウド上の動作確認（ステージング） | Cloudflare（本番と別アカウント資源） | D1 `cinema_hashigo_st` | `main` ブランチ push（自動） |
| **prod** | 本番 | Cloudflare | D1 `cinema_hashigo_prod` | Git タグ `v*` or 手動承認（後述） |

- **local と st の役割分担**: local はエミュレーション中心で高速に回す。st は「実際の Cloudflare 上で Workers/D1/R2/KV/Queues/Browser Rendering が想定通り動くか」を確認する場所。エミュレーションでは再現しない挙動（Queues のリトライ、Browser Rendering、Access、Cron）は st で確認する。
- **prod と st は資源を完全分離**する。D1・R2・KV・Queues すべて別インスタンス。シークレットも別。

## 2. ローカル開発 — Docker Compose の役割

D1 は wrangler が SQLite でローカルエミュレーションするため Compose には含めない。Compose は **外部依存のモック/補助サービス**を束ねるために使う。これにより「ローカルでは外部 API・通知に実接続しない」を担保でき、`08_compliance-policy.md` の取得マナー（開発中に先方サイトや実 API を無用に叩かない）とも整合する。

### 2.1 compose.yaml（開発補助サービス）

```yaml
# compose.yaml — ローカル開発の補助サービス群（DB本体は含まない: D1はwranglerがSQLiteで提供）
services:
  # R2 の代替（S3互換）。ローカルでスナップショット保存を検証したい場合に使用。
  # ※ 通常は wrangler の R2 local emulation で足りるため任意。実S3挙動を見たいとき用。
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: devminio
      MINIO_ROOT_PASSWORD: devminio-secret
    ports: ["9000:9000", "9001:9001"]
    volumes: ["minio-data:/data"]

  # 駅すぱあとAPI等 外部APIのスタブ（移動時間行列バッチ・origin解決のローカル検証用）
  # OpenAPIモックでもよいが、まずは固定レスポンスのStubで十分。
  transit-stub:
    image: mockserver/mockserver:latest
    ports: ["1080:1080"]
    environment:
      MOCKSERVER_INITIALIZATION_JSON_PATH: /config/transit-expectations.json
    volumes: ["./mocks/transit:/config"]

  # Slack通知のモック（webhook受け口）。検証NG通知の配線確認用。
  slack-stub:
    image: mockserver/mockserver:latest
    ports: ["1081:1080"]
    volumes: ["./mocks/slack:/config"]

  # LLM抽出をローカルモデルで検証する場合のみ（任意。既定はClaude API）。
  # 既存のOllama環境を使うならこのサービスは不要。
  # ollama:
  #   image: ollama/ollama:latest
  #   ports: ["11434:11434"]
  #   volumes: ["ollama:/root/.ollama"]

volumes:
  minio-data:
  # ollama:
```

- **必須ではないサービスは任意起動**にする（`docker compose up minio transit-stub` のように選択起動）。全部を常時立てる必要はない。
- スタブへの向き先は環境変数で切り替える（§4）。local では `TRANSIT_API_BASE=http://localhost:1080` 等。
- モックの期待値定義（`mocks/transit/*.json`）はリポジトリ管理し、抽出・行列計算のゴールデンテストと対応させる。

### 2.2 ローカル起動手順（概略）

```
# 1) 補助サービス（必要なものだけ）
docker compose up -d minio transit-stub slack-stub

# 2) D1 マイグレーション（ローカル）
wrangler d1 migrations apply cinema_hashigo --local

# 3) 各 Worker をローカル起動
pnpm -F @cinema/api dev
pnpm -F @cinema/ingest dev
pnpm -F @cinema/web dev
```

- D1 の実体はローカルは wrangler 管理の SQLite ファイル。Compose の管轄外。
- ローカルでは Cron/Queues も wrangler が範囲内でエミュレートするが、リトライ挙動の最終確認は st で行う。

## 3. Cloudflare リソースの環境分離

`wrangler.toml`（またはパッケージごとの `wrangler.jsonc`）で環境ごとにバインディングを定義する。**本番資源とST資源のIDを取り違えないよう、名前に環境サフィックスを付ける。**

### 3.1 命名規約

| リソース | st | prod |
|---|---|---|
| Worker (api) | `cinema-api-st` | `cinema-api-prod` |
| Worker (ingest) | `cinema-ingest-st` | `cinema-ingest-prod` |
| D1 | `cinema_hashigo_st` | `cinema_hashigo_prod` |
| R2 バケット | `cinema-snapshots-st` | `cinema-snapshots-prod` |
| KV | `cinema-kv-st` | `cinema-kv-prod` |
| Queue | `cinema-ingest-queue-st` | `cinema-ingest-queue-prod` |
| Pages (web) | `cinema-web-st`（プレビュー相当） | `cinema-web-prod` |

### 3.2 wrangler 設定例（api パッケージ）

```toml
# packages/api/wrangler.toml
name = "cinema-api"
main = "src/index.ts"
compatibility_date = "2026-01-01"

# --- 既定（local: wrangler dev が使用）---
[[d1_databases]]
binding = "DB"
database_name = "cinema_hashigo"
database_id = "local"           # local は wrangler が解決

[[kv_namespaces]]
binding = "KV"
id = "local"

# --- ST 環境 ---
[env.st]
name = "cinema-api-st"
[[env.st.d1_databases]]
binding = "DB"
database_name = "cinema_hashigo_st"
database_id = "<ST_D1_ID>"
[[env.st.kv_namespaces]]
binding = "KV"
id = "<ST_KV_ID>"
[env.st.vars]
APP_ENV = "st"

# --- 本番環境 ---
[env.prod]
name = "cinema-api-prod"
[[env.prod.d1_databases]]
binding = "DB"
database_name = "cinema_hashigo_prod"
database_id = "<PROD_D1_ID>"
[[env.prod.kv_namespaces]]
binding = "KV"
id = "<PROD_KV_ID>"
[env.prod.vars]
APP_ENV = "prod"
```

- デプロイ: `wrangler deploy --env st` / `wrangler deploy --env prod`。
- ingest パッケージも同様に `[env.st]` / `[env.prod]` を定義（Queues・R2・Cron 含む）。
- **Cron は本番のみ有効**にし、st では手動トリガー中心にする（st が先方サイトを毎日叩かないようにする。`08` の取得マナー）。st で定期実行を検証したい期間だけ Cron を一時有効化する運用とする。

## 4. シークレット・環境変数

- コードに直書きしない（`08_compliance-policy.md` §4）。区分は以下。
  - **vars（非機密・平文可）**: `APP_ENV`, 外部APIのベースURL等 → wrangler.toml の `[env.*.vars]`。
  - **secret（機密）**: LLM APIキー / 駅すぱあとAPIキー / Slack Webhook URL → `wrangler secret put <NAME> --env st|prod`。
- local は `.dev.vars`（gitignore）でローカル秘密を与える。スタブ向き先もここで上書き。

```
# .dev.vars（例・コミットしない）
APP_ENV=local
ANTHROPIC_API_KEY=sk-ant-xxxx
TRANSIT_API_BASE=http://localhost:1080
SLACK_WEBHOOK_URL=http://localhost:1081/webhook
```

- GitHub Actions からのデプロイに必要な機密（Cloudflare API Token 等）は GitHub の **Environments**（`st` / `prod`）の Secrets に置く（§5）。

## 5. GitHub Actions によるデプロイ

### 5.1 方針

- **ST**: `main` への push で自動デプロイ（動作確認を速く回す）。
- **本番**: `v*` タグの push を契機にデプロイ。かつ GitHub Environment `prod` に **required reviewers**（自分の承認）を設定し、承認ゲートを通す。誤爆デプロイを防ぐ。
- マイグレーションはデプロイ前に該当環境の D1 へ適用する。
- テスト（型・lint・unit、特に DP 期待値テスト）が通らなければデプロイしない。

### 5.2 ワークフロー構成

```
.github/workflows/
  ci.yml       # PR & push: install → typecheck → lint → test（デプロイなし）
  deploy-st.yml   # push main: ci通過を前提に ST へ deploy + migrate
  deploy-prod.yml # push tag v*: 承認 → PROD へ deploy + migrate
```

### 5.3 ci.yml（テストのみ・全PR/ push）

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test          # DP期待値テスト（12 §7）を含む
```

### 5.4 deploy-st.yml（main push で ST へ）

```yaml
name: deploy-st
on:
  push:
    branches: [main]
concurrency: { group: deploy-st, cancel-in-progress: true }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: st          # GitHub Environment: st の Secrets を使用
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test        # 念のため再実行（緑でなければ止める）

      # D1 マイグレーション（ST）
      - name: migrate D1 (st)
        run: pnpm -F @cinema/api exec wrangler d1 migrations apply cinema_hashigo_st --env st --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      # Workers デプロイ（ST）
      - name: deploy api (st)
        run: pnpm -F @cinema/api exec wrangler deploy --env st
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: deploy ingest (st)
        run: pnpm -F @cinema/ingest exec wrangler deploy --env st
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      # web（Pages）は Pages 用アクションでデプロイ（別ステップ）
```

### 5.5 deploy-prod.yml（タグ + 承認ゲート）

```yaml
name: deploy-prod
on:
  push:
    tags: ["v*"]
concurrency: { group: deploy-prod, cancel-in-progress: false }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: prod        # required reviewers を設定 → 手動承認ゲート
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

      - name: migrate D1 (prod)
        run: pnpm -F @cinema/api exec wrangler d1 migrations apply cinema_hashigo_prod --env prod --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: deploy api (prod)
        run: pnpm -F @cinema/api exec wrangler deploy --env prod
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: deploy ingest (prod)
        run: pnpm -F @cinema/ingest exec wrangler deploy --env prod
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

### 5.6 必要な GitHub 設定（人間が事前に行う）

1. リポジトリ Settings → Environments で `st` と `prod` を作成。
2. `prod` に **Required reviewers = 自分** を設定（承認ゲート）。
3. 各 Environment の Secrets に `CLOUDFLARE_API_TOKEN`（Workers/D1/R2/KV/Pages 権限）と `CLOUDFLARE_ACCOUNT_ID` を登録。
4. Cloudflare API Token は st 用・prod 用を分けて発行し、それぞれの Environment にのみ置く（越境デプロイを防ぐ）。
5. アプリのシークレット（LLM/駅すぱあと/Slack）は Actions ではなく `wrangler secret put --env st|prod` で各環境に直接設定（初回のみ手動）。

## 6. マイグレーションの流れ（環境横断）

```
local:  wrangler d1 migrations apply cinema_hashigo --local
   ↓ 動作確認
st:     （main push で Actions が）apply ... cinema_hashigo_st --env st --remote
   ↓ クラウド上で確認
prod:   （v* タグ + 承認で Actions が）apply ... cinema_hashigo_prod --env prod --remote
```

- マイグレーションは前方のみ（`11 §1`）。破壊的変更はデータ移行スクリプトを別マイグレーションで用意。
- st で流したマイグレーションが問題ないことを確認してから prod タグを切る運用。

## 7. ロールバック方針

- **コード**: prod は直前の正常タグを再デプロイ（`wrangler deploy --env prod` を旧コミットで）。Workers は即時反映。
- **スキーマ**: 前方のみのため「打ち消しマイグレーション」を新規に追加して対応。DELETE 系は慎重に。
- st で事前検証しているため、prod での破壊的失敗の確率を下げる前提。

## 8. 環境ごとの差異まとめ

| 項目 | local | st | prod |
|---|---|---|---|
| DB | D1 local (SQLite) | D1 st | D1 prod |
| 外部API/通知 | Compose スタブ | 実サービス（低頻度） | 実サービス |
| Cron（取込定期実行） | エミュレート | 原則OFF（検証時のみON） | ON |
| Browser Rendering | 制限あり/スキップ可 | 有効 | 有効 |
| Access（管理サイト） | 省略可 | 有効 | 有効 |
| シークレット源 | `.dev.vars` | wrangler secret (st) | wrangler secret (prod) |
| デプロイ | 手元実行 | main push（自動） | v* タグ＋承認 |
