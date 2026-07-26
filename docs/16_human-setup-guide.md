# 人間セットアップ・運用ガイド — オーナー作業手順

- Version: 0.1
- 目的: Claude Code が代行できない・すべきでない作業（アカウント作成・課金・シークレット発行・規約/法務の判断・本番デプロイ承認・目視レビュー）を、実施タイミング順に手順化する。
- 使い方: `09_roadmap.md` の「人間（オーナー）作業との依存関係」から該当節を参照。作業を終えたら Claude Code に「§x.x 完了」と伝えれば続きを再開できる。
- 注意:
  - 外部サービスの画面・メニュー名・提供条件は変わりうる（本書は 2026-07 時点）。ズレていたら本書を更新する。
  - **シークレット値（APIキー・トークン・Webhook URL）をチャット・コード・コミットに貼らない。** 投入は自分のターミナルか各サービスの画面で行う。

## 0. 全体マップ

| 節 | 作業 | タイミング | 所要目安 |
|---|---|---|---|
| §1 | 開発ツール・GitHub | P0 前 | 確認済み・作業なし |
| §2.1 | Google Gemini API キー発行（開発は Ollama で先行可） | P1 品質確定/ST 前 | 10分 |
| §2.2 | 劇場1館目の採用確認（規約・robots） | P1 前 | 30分 |
| §2.3 | Slack Webhook 作成 | ST 有効化（§3）まで | 10分 |
| §3 | ST 環境有効化（課金・トークン・GitHub 設定） | P3 完了後推奨 | 40〜60分 |
| §4.1 | Cloudflare Access 設定 | P4-1 前 | 20分 |
| §4.2 | 駅すぱあと API キー申込 | P4-6 前（審査日数に注意） | 申込15分 + 数日 |
| §4.3 | 劇場2〜5館の採用確認 + レビュー目視 | P4-8 | 30分/館 + 3日観察 |
| §5 | 本番昇格一式（ドメイン・prod 資源・承認） | P5-7 前後 | 60〜90分 |
| §6 | 継続運用 | リリース後 | 日次5分・週次10分 |

## 1. P0 開始前 — 開発環境と GitHub

2026-07-08 時点の確認結果（このマシン）。**すべて準備済みのため、P0 のための追加作業はない。**

| 項目 | 状態 |
|---|---|
| Node.js | v22.23.1（nodebrew）✅ ※P3 で v22.14→v22.23.1 に更新（React Router v8 が Node >22.22 を要求。切替は `nodebrew use`。pnpm は `corepack enable pnpm` で再有効化） |
| pnpm | 10.33.0（corepack）✅ |
| Docker / Compose | 20.10.24 / v2.17.2 ✅ |
| wrangler | 4.54.0（グローバル）✅ 任意で更新: `npm i -g wrangler@latest` |
| gh CLI | 2.86.0・`yasudaProduct` で認証済み（repo/workflow スコープあり）✅ |
| GitHub リポジトリ | `yasudaProduct/cineplan`（origin 設定済み）✅ |
| Cloudflare | wrangler ログイン済み ✅（プランは Free。Paid 加入は §3.1） |

- P0-6 で追加される CI（typecheck/lint/test）は develop への push で自動的に動き始める（ADR-0016。当初は main pushだったが実運用に合わせて訂正）。deploy-st / deploy-prod は §3 の Secrets 設定まで実デプロイに失敗するが、これは想定内（`09_roadmap.md` P0-6 の Done 条件参照）。

## 2. P1 開始前

### 2.1 Google Gemini API キー（LLM 抽出用。ADR-0011）

抽出の既定プロバイダは本番/ST が Google Gemini Flash（無料ティア）。本サービスの負荷（数十リクエスト/日）は無料枠（Flash 系: 1,500 req/日・15 RPM・1M TPM）に対し桁違いに余裕があり、実質 0円で運用できる。

> **開発は API キー無しで着手できる**: 抽出の**ローカル開発は Ollama（既定・オフライン・無料）**で回す（ADR-0011）。Gemini キーが要るのは「抽出品質を本番プロバイダで確定する段階」と ST/prod。先に取っておくとスムーズだが、P1-3 の実装反復は Ollama だけで始められる。Ollama は既存環境をそのまま利用可（`http://localhost:11434`。Mac は native 版推奨、`ollama pull qwen2.5` 等）。

1. https://aistudio.google.com に Google アカウントでログイン。
2. 「Get API key」→ Create API key。**クレジットカード不要**。無料ティアで始められる。
3. **無料ティアの注意**: 送信プロンプト（＝抽出対象の HTML）が Google のモデル学習に使われうる（`docs/08 §4` の条件付きで許容 = 公開ページの事実データに限定・個人情報を含むページは対象外）。学習に使わせたくない場合のみ、AI Studio で課金を有効化し有料ティアにする（無料の利点は薄れる）。将来、学習利用を完全に避けたくなったら Cloudflare Workers AI へ差し替え可能（抽出クライアントは抽象化済み）。
4. リポジトリルートの `.dev.vars.example` を `.dev.vars` にコピーし、自分のエディタで記入:
   ```
   GEMINI_API_KEY=...
   ```
5. Claude Code に「§2.1 完了」と伝える。st/prod への投入は §3.6 / §5.3。

### 2.2 劇場1館目の採用確認（`08_compliance-policy.md` §2 の実施）

規約・マナーの**判断を含むため必ず人間が行う**。Claude Code は robots.txt の取得代行やメモの整形は手伝えるが、採用可否の判断はしない。

1. **候補選び**: 大阪市内で、上映スケジュールが JavaScript なしで HTML に含まれるサイト（ブラウザで「ページのソースを表示」して上映時刻が見える）を選ぶ（`fetch_method=static`）。独立系・ミニシアター系にこの形式が多い。大手チェーン（JS 描画）は P4-7 の rendered 対応後に回す。
2. **robots.txt**: ブラウザで `https://<劇場サイトのドメイン>/robots.txt` を開き、スケジュールページのパスが `Disallow` に該当しないか確認 → `allowed` / `disallowed` をメモ。
3. **利用規約・サイトポリシー**を読む: 自動取得・スクレイピング・クローリングの明示的禁止があれば**不採用**。判断に迷うグレーも不採用（08 §2）。要点をメモ（terms_note になる）。
4. 対象ページが**ログイン不要**で閲覧できることを確認（会員限定ページは対象外）。
5. 採用する場合、以下を Claude Code に渡す（seed / 劇場マスタに記録される）:
   - 劇場名 / スケジュールページ URL（日付がURLに入る場合はその形式も）/ 公式トップ URL
   - 緯度経度（Google マップで右クリック→座標コピー）/ 最寄駅名 / 駅からの徒歩分
   - robots 確認結果・規約確認の要点・確認日（= terms_checked_at）
6. 不採用にした劇場も理由をメモに残す（再検討の重複を防ぐ）。

### 2.3 Slack Webhook（取込失敗・検証NG通知の宛先）

ローカル開発は Compose の slack-stub に飛ばすため必須ではない。**§3（ST 有効化）までに**用意すればよい。

1. https://api.slack.com/apps → Create New App → From scratch。名前例 `cineplan-alerts`、通知先ワークスペースを選択。
2. Incoming Webhooks を ON → Add New Webhook to Workspace → 通知チャンネル（例 `#cineplan-alerts`）を選択。
3. 発行された Webhook URL を控える（→ §3.6 で st に投入。URL 自体が認証情報なので扱いはシークレット同様）。

## 3. ST 環境有効化（推奨タイミング: P3 完了後、P4-0 の前）

### 3.1 Workers Paid プラン加入（$5/月）

Queues と Browser Rendering の利用に Paid が必要。

1. https://dash.cloudflare.com → 対象アカウント → Workers & Pages → Plans。
2. Workers Paid を購入（支払い方法登録）。

### 3.2 ST リソース作成（Claude Code 代行可）

wrangler ログイン済みのため、**Claude Code に依頼すれば実行できる**（あなたはコマンド実行の許可を出すだけ）。作成するリソース名は `14_environments-deploy.md` §3.1 の命名規約どおり:

```
wrangler d1 create cinema_hashigo_st
wrangler kv namespace create cinema-kv-st
wrangler r2 bucket create cinema-snapshots-st
wrangler queues create cinema-ingest-queue-st
```

（コマンドの正確な形は実行時に Claude Code が確認する。）出力された各 ID の wrangler.toml `[env.st]` への反映も Claude Code が行う（リソース ID は機密ではない）。反映先は api・ingest の `REPLACE_WITH_ST_D1_ID` / `REPLACE_WITH_ST_KV_ID`（D1・KV は両 Worker で同一 ID を共有。R2・Queue は名前参照のため ID 反映不要）。**web（`cinema-web-st`）はバインディング無しの Worker のため、作成するリソースは無い**（デプロイのみ）。

### 3.3 Cloudflare API トークン発行（ST 用・GitHub Actions デプロイ用）

1. dash.cloudflare.com → 右上プロフィール → My Profile → API Tokens → Create Token。
2. テンプレート「Edit Cloudflare Workers」をベースに、権限を以下になるよう追加。Account Resources は自分のアカウントに限定:
   - Account / Workers Scripts / Edit
   - Account / D1 / Edit
   - Account / Workers KV Storage / Edit
   - Account / Workers R2 Storage / Edit
   - Account / Queues / Edit
   - （web も Worker としてデプロイするため Pages 権限は不要。ADR-0013。「Workers Scripts / Edit」で api・ingest・web の3 Worker すべてを賄う）
3. 名前 `cineplan-st-deploy` で作成し、トークン値を控える（**再表示不可**）。権限不足は deploy-st の失敗ログで判明するので、その際に追補すればよい。
4. Account ID を控える: Workers & Pages Overview の右カラム、または `wrangler whoami`。

### 3.4 GitHub Environments と Secrets

1. https://github.com/yasudaProduct/cineplan → Settings → Environments → New environment で `st` と `prod` を作成。
2. `prod` に Deployment protection rules → **Required reviewers → 自分を追加**（本番承認ゲート。`14` §5.1）。
3. `st` の Environment secrets に登録:
   - `CLOUDFLARE_API_TOKEN` =（§3.3 の ST 用トークン）
   - `CLOUDFLARE_ACCOUNT_ID`
4. prod の Secrets は §5.2 で **prod 用トークンを別発行**して登録する（ST 用の使い回しをしない。越境デプロイ防止。`14` §5.6）。

### 3.5 wrangler login（このマシンでは不要）

このマシンは認証済み。別マシンで作業する場合のみ `wrangler login`（Claude Code セッション内で行うならプロンプトに `! wrangler login` と打つとブラウザ認証が開く）。

### 3.6 アプリシークレット投入（ST）

**P4-0 の初回 ST デプロイ後に実行するのが確実**（未デプロイだと Worker 作成確認が出る）。Claude Code が P4-0 の途中で声をかけるので、**自分のターミナル**（セッション外。値をログに残さないため）で:

```
cd packages/ingest
wrangler secret put GEMINI_API_KEY --env st    # 実行するとプロンプトが出るので値を貼る
wrangler secret put SLACK_WEBHOOK_URL --env st
wrangler secret put ADMIN_TOKEN --env st       # 手動取込エンドポイント保護用。ランダム文字列で可
                                                #   例: openssl rand -hex 32 で生成
# EKISPERT_API_KEY は P4-6 の前でよい（§4.2）
```

**`ADMIN_TOKEN` は Cloudflare Access（§4.1）を設定する P4-1 より前に ST を公開する場合、必ず設定する。** `POST /admin/ingest` は local（`APP_ENV=local`）以外では `x-admin-token` ヘッダの一致を要求し、未設定のまま ST にデプロイすると常に 401 を返す（fail closed）。手動取込確認時は `curl -H "x-admin-token: <値>" ...` で呼ぶ。

api パッケージ側に必要なシークレットが生じた場合は Claude Code が同じ形式で案内する。

### 3.7 完了の伝え方

§3.1〜3.4 が済んだら「§3 完了」と伝える。Claude Code が P4-0（ID 反映 → ST デプロイ + migrate + seed → §3.6 の依頼 → 手動取込 1 件 → /plan 疎通確認）を実施し結果を報告する。

## 4. P4 で必要になる作業

### 4.1 Cloudflare Access（管理サイト保護。P4-1）

1. dash.cloudflare.com → Zero Trust（初回はチーム名を設定。Free プランで可）。
2. Access → Applications → Add an application → **Self-hosted**。
   - Application domain: ingest Worker のホスト名 + パス `/admin`（正確な値は P4-0 完了後に Claude Code が提示する）
   - Policy: Allow / Include: Emails = 自分のメールアドレス
3. ログイン方式は既定の **One-time PIN**（メールで PIN が届く）で開始してよい。Google アカウントでログインしたい場合は Settings → Authentication → Login methods → Google を追加（Google Cloud Console での OAuth クライアント作成が必要。任意）。
4. シークレットウィンドウで `/admin` を開き、認証が要求されることを確認 →「§4.1 完了」。
5. **Access 有効化後の注意**: `/admin` 配下は curl も Access に遮られる（302）ため、`x-admin-token` 付き curl での手動取込は ST では使えなくなる。以降の手動取込・再抽出・レビューは**管理サイト UI（P4-3〜P4-5）をブラウザで**操作する（Access ログイン後は Cloudflare がリクエストに `Cf-Access-Jwt-Assertion` を付与し、コード側ガードを通過する）。自動化が必要になったら Access の Service Token を発行して `CF-Access-Client-Id/Secret` ヘッダで呼ぶ（P4 時点では不要）。コード側の JWT 署名検証（team ドメイン・aud 検証）は未実施＝エッジの Access が一次防御（強化する場合は P5 で検討）。

### 4.2 移動時間 API（P4-6）— 人間作業は不要になった（ADR-0014）

当初想定の駅すぱあと Web サービスは実質法人向けのため不採用（2026-07-13 オーナー判断）。代替として **ls8h Transit API**（`https://api.transit.ls8h.com`・無料・認証不要・非公式）を採用した（ADR-0014。利用規約はオーナーが 2026-07-13 に実査: 商用禁止条項なし・無保証・個人運営）。

- **API キーの取得・シークレット投入は不要**。向き先 `TRANSIT_API_BASE` は非機密 var（既定は実 API）。
- 劇場間行列は週次 Cron（prod）+ 管理サイトのダッシュボードから手動再生成できる。
- 留意: 個人運営のため予告なく停止しうる。停止しても /plan は最後に生成した行列＋直線距離推定で動き続ける。長期停止時は Google Routes API 等への差し替えを ADR で再決定する（ビルダーとジオコーダの差し替えのみで済む設計）。

### 4.3 劇場 2〜5 館目の採用確認とレビュー目視（P4-8）

- 各館について §2.2 と同一の確認を実施。
- 受入フロー（`06` §9 / `07` §2.3。管理サイトが UI で担保）: 登録は `paused` → 手動取込 → **レビューキューで全件目視（あなたの作業）** → 3日連続 succeeded → `active` 化。
- 3日間の観察は複数館並行でよい。JS 描画サイト（大手チェーン）は P4-7（rendered 対応）完了後に追加する。

### 4.4 P1-6 の ST 検証（実 Queues 再配信 / 実 Cron 発火）

P1-6（Cron + Queues 配線）の実装は P1 で完了しているが、**ローカルのエミュレーションでは再現しない2点**（Queues のネイティブ再配信・Cron の実発火）を ST で観測して初めて Done になる（`09_roadmap.md` P1-6 / P4-0 の残項目）。判定ロジック自体は `packages/ingest/src/__tests__/index.spec.ts` で固定済みなので、ここで見るのは「実インフラが設定どおりに振る舞うか」だけ。

**前提**: 5館 active（§4.3 / P4-8）完了後。

**取得マナー上の注意**: ST での検証も先方サイトへの実アクセスを消費する。N-06（1劇場1日1セッション）により、Step B を実施する日は**手動取込を一切行わない**こと。

#### Step A: Queues の実リトライ（先方サイトへのアクセス **ゼロ**・所要約15分）

実劇場を故意に失敗させる必要はない。到達不能な URL を持つ **`paused` の検証用ダミー劇場**で観測する。`paused` でも手動取込が通るのは、`assertComplianceGate` の status チェックが `trigger='cron'` のときだけ効くため（`active` ではないので `/plan` にも出ない）。

1. ST の D1 にダミーを1件だけ投入する。`schedule_url` の `.invalid` は RFC 6761 の予約 TLD で、**名前解決されない＝どのサーバにも接続しない**。

```
pnpm -F @cinema/api exec wrangler d1 execute cinema_hashigo_st --remote --command "
INSERT INTO theaters (id,name,short_name,status,lat,lng,nearest_station,walk_min_from_sta,
  schedule_url,fetch_method,extract_method,fetch_day_mode,fetch_days,official_url,
  terms_note,terms_checked_at,robots_status)
VALUES ('thr_verify_retry','【検証用】到達不能ダミー','検証用','paused',34.7025,135.4959,'梅田',1,
  'https://unreachable.invalid/schedule','static','text','single',1,'https://unreachable.invalid/',
  'P1-6 Queues再配信の検証用。実在の劇場ではない。検証後 retired にする','2026-07-26T00:00:00Z','allowed');
"
```

2. 管理サイト（ブラウザ・Access ログイン）→ 劇場マスタ →「【検証用】到達不能ダミー」→「取込を実行」。
3. Workers Logs（§6.1）を約15分追い、以下の順で出ることを確認する:

| 経過 | イベント | 見るポイント |
|---|---|---|
| t+0 | `admin.enqueue.ingest` → `queue.ingest.start attempt=1` → `run.fetch.fail` → `queue.ingest.retry delaySeconds=300` | 1回目で即 ack されない |
| t+5分 | `queue.ingest.start attempt=2` → `queue.ingest.retry delaySeconds=600` | **指定した遅延で実際に再配信されるか**（本命） |
| t+15分 | `queue.ingest.start attempt=3` → `queue.ingest.done status=fetch_failed` | 打ち切り |
| t+15分 | Slack に `🛑 取込失敗(fetch_failed)` が **1通だけ** | attempt 1・2 が silent で抑止されているか |
| 以降 | 4回目が来ない | `max_retries=3` + `ack` が効いているか |

4. 後片付け: 管理サイトでダミーを **retired** にする（DELETE しない。`ingest_runs` の履歴と参照整合を残すため）。`fetch_failed` の run が3行残るが、これは実際に3回アクセスを試みた記録なので正しい（`countTodaySiteFetches` にも3回と数えられる）。

#### Step B: 実 Cron の発火（実5館・その日の唯一のセッション）

ST の cron は「revert 忘れで毎日先方を叩く」のが最大のリスクなので、**日付を固定した one-shot 式**を使う（消し忘れても年1回しか鳴らない）。

1. `packages/ingest/wrangler.toml` の `[env.st]` に一時追加（例: 7/28 15:30 JST = 06:30 UTC）:

```toml
[env.st.triggers]
crons = ["30 6 28 7 *"]
```

2. `chore/p1-6-st-cron-verify` ブランチ → `develop` にマージ（Actions が ST に自動デプロイ。ADR-0016）。**発火予定時刻の10分前までに**デプロイを終えておく。
3. 発火後に確認:
   - `cron.dispatch.done theaters=5`
   - `queue.ingest.start trigger=cron` が **5件直列**に流れる（`max_batch_size=1` / `max_concurrency=1`）
   - 各 `run.done status=succeeded`。管理サイトのダッシュボードで「本日の取込状況」5/5
4. **所要時間を記録する**（Step C）。
5. 追加した `[env.st.triggers]` を revert して `develop` へ（ST の Cron を原則 OFF に戻す）。

#### Step C: サイクル時間の実測と N-02 の突合

Step B のログで **`cron.dispatch.done` から最後の `run.done` までの経過時間**を必ず記録する。現状これはどこにも実測がなく、N-02（対象日の前日 06:00 JST までに取込完了）を満たせるかの判断材料が無い。

- consumer は `max_concurrency=1` の完全直列、1 run の予算は `RUN_BUDGET_MS`=12分 → 最悪 5館 × 12分 ≒ **60分**
- prod の取込 cron は 21:00 UTC = **06:00 JST 開始**。最悪ケースでは完了が 07:00 JST になり、N-02 を額面上満たさない
- 実測が十分短ければ現行のままでよい。長ければ prod の cron 前倒し（例 20:00 UTC = 05:00 JST）を **P5-7 の前に**判断する

#### 検証できないもの（既知）

`scheduled()` の TravelMatrix 分岐は `controller.cron` の**文字列リテラル完全一致**（`'0 18 * * 1'`）なので、one-shot 式では必ず取込側に落ちる。ST で実 cron から通すには `"0 18 * * 1"` をそのまま入れて月曜まで待つしかない。手動再生成ボタンは P4-6 で E2E 済み・分岐はユニットテストで固定済みのため、**実 cron での確認は prod 初回の月曜にログで行う**運用とする。

## 5. 本番昇格（P5-7 の前後）

### 5.1 独自ドメイン

1. 推奨: Cloudflare Registrar（dash → Domain Registration → Register domains）で取得（.com で年 1,000〜1,500 円程度・原価販売）。他社で取得済みなら zone を Cloudflare に追加。
2. ドメイン名が決まったら Claude Code に伝える。反映先: api/web のカスタムドメイン、共有 URL、OGP、`/bot` ページ URL、User-Agent 文字列（`08` §3 の `CinemaHashigoBot/0.1 (+https://<domain>/bot)`）。

### 5.2 prod リソース・トークン・Secrets

1. §3.2 と同様に prod リソースを作成（Claude Code 代行可）: `cinema_hashigo_prod` / `cinema-kv-prod` / `cinema-snapshots-prod` / `cinema-ingest-queue-prod`。
2. §3.3 と同様に **prod 用 API トークン** `cineplan-prod-deploy` を別発行。
3. GitHub Environment `prod` の Secrets に `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` を登録（§3.4）。Required reviewers 設定済みであることを再確認。

### 5.3 prod アプリシークレット

初回 prod デプロイ後、自分のターミナルで:

```
cd packages/ingest
wrangler secret put GEMINI_API_KEY --env prod   # prod 用に別発行したキー（無料枠は共用でも可）
wrangler secret put SLACK_WEBHOOK_URL --env prod
wrangler secret put EKISPERT_API_KEY --env prod
```

### 5.4 法務ページの最終確認（P5-4 の成果物レビュー）

Claude Code が用意する文面（利用規約 / プライバシーポリシー / `/bot` ページ / 免責表示）を読み、特に以下を確認・決定する:

- 停止依頼の連絡先メールアドレス（**あなたが決める**。`/bot` と規約に記載）
- 「個人情報を保持しない」記載が実装と一致しているか
- `/bot` の目的・連絡先・停止依頼手順が `08` §3 と一致しているか
- 免責「上映時間は変更される場合があります。必ず各劇場の公式サイトでご確認ください。」が全ページフッターにあるか

### 5.5 リリース実施（P5-7）

1. ST での動作確認チェックリスト（Claude Code が提示）を確認。
2. タグを打つ: `git tag v0.1.0 && git push origin v0.1.0`（Claude Code に依頼してもよい）。
3. GitHub → Actions → deploy-prod が**承認待ち**になるので Review deployments → `prod` → **Approve**（この承認があなたの最終ゲート）。
4. デプロイ後スモークテスト（Claude Code が手順提示）: `/healthz` → 手動取込1件 → `/plan` → Web でプラン作成 → 共有 URL → `/admin` に Access が効いていること → 翌朝、Cron 取込の成功を Slack/管理サイトで確認。

## 6. 継続運用（リリース後）

| 頻度 | 作業 |
|---|---|
| 日次（Slack を見るだけ） | 取込失敗・検証NG 通知の確認。NG があれば管理サイトのレビューキューで承認/破棄 |
| 週次 | ダッシュボードで LLM トークン消費・取込成功率・データ鮮度（N-02）を確認 |
| 90日毎 | 管理サイトの警告に従い各劇場の robots.txt / 規約を再確認 → terms_checked_at を更新（§2.2 の手順） |
| 随時 | 劇場からの停止依頼 → 当該劇場を即 `paused`/`retired`（`08` §3） |
| 随時 | Google AI Studio（無料枠の消費/超過）・Cloudflare の請求額確認（N-04: 月 3,000 円以内） |

### 6.1 ログの見方（Workers Logs。取込の調査手順）

取込が失敗した・件数が想定と違う等の調査は、まず管理サイトの取込詳細（`error_message`。LLM 失敗は timeout / 429 等に分類済み）を見て、足りなければ Workers Logs を開く。

1. Cloudflare ダッシュボード → Workers & Pages → `cinema-ingest-st`（prod は `cinema-ingest-prod`）→ **Logs**。
2. 構造化フィールドで絞り込む（イベント台帳は `packages/ingest/README.md`）。よく使うフィルタ:
   - `event = "run.done"` … 取込1回ごとの最終結果一覧（status / extracted / written）
   - `runId = "run_xxxx"` … その取込の全行程（fetch → 抽出 → 書込）を時系列表示
   - `event = "llm.call.fail"` … LLM 呼出失敗の分類（kind: timeout / http / network。http の status=429 ならレート制限）
   - `event = "reap.done"` … 孤児 run 掃除の記録（どの run がいつ確定されたか）
3. リアルタイム確認は手元から: `pnpm -F @cinema/ingest exec wrangler tail --env st --format pretty`
- ログ保持は7日（Workers Paid）。それより古い調査は D1 の `ingest_runs` と R2 スナップショットが正。

## 7. ランニングコスト概算（N-04 との突合・2026-07 時点の概算）

| 項目 | 月額目安 |
|---|---|
| Workers Paid | $5 ≒ 800円 |
| 独自ドメイン（年額按分） | 〜130円 |
| LLM 抽出（Gemini Flash 無料ティア・5〜10館×日次1回） | 0円（無料枠 1,500 req/日 に対し数十 req/日。ADR-0011） |
| D1 / R2 / KV / Queues / Browser Rendering | Paid 込み枠内でほぼ 0円 |
| 駅すぱあと | フリープラン前提 0円（§4.2） |
| **合計** | **≒ 900〜950円**（上限 3,000円に対し十分な余裕） |

- LLM を Gemini 無料枠にしたことで固定費はほぼ Workers Paid のみになり、N-04 に大きく余裕ができた。
- 監視は残す: ingest_runs の provider/model/トークン記録（`03` §3.4）と管理サイトのコストウィジェット（`07` §2.2）で、無料枠の消費・検証NG率を追う。
- 無料枠超過（30館超・高頻度化）や有料ティア移行が必要になったら、`06` §8 の最適化（前日スナップショット diff スキップ → 前処理強化 → プロンプトキャッシュ）を優先順どおり着手し、必要なら Workers AI へ差し替える。
- 劇場を 10 館超に拡げる場合はこの表を再計算してから拡充する。
