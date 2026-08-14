# D1 実装詳細 — マイグレーション・クエリ・アクセス層

- Version: 0.1
- 親ドキュメント: `03_data-model.md`（論理設計）。本書はその実装レベル詳細。
- 対象: `packages/ingest`（書込）/ `packages/api`（読取）/ マイグレーション。

## 1. マイグレーション運用

- ツール: `wrangler d1 migrations`。ファイルは `migrations/NNNN_description.sql`（連番）。
- 各マイグレーションは前方のみ（ロールバックは新規マイグレーションで対応）。
- ローカル: `pnpm -F @cinema/api exec wrangler d1 migrations apply cinema_hashigo --local --persist-to ../../.wrangler-state`
- 本番: Actions 経由（`--env st|prod --remote`。docs/spec/11 §5）。手動時も同形式。
- `migrations_dir` は `packages/api/wrangler.toml` の各 D1 バインディングで `../../migrations`（リポジトリルート）を指す。migrations の apply は api パッケージから実行する。
- **seed（開発ダミーデータ）はマイグレーションに含めない。** `seeds/dev_seed.sql` として分離し、ローカルのみ `wrangler d1 execute ... --file` で投入する（下記）。migrations/ に seed を置くと deploy 時に ST/prod へ誤って適用されるため。
- D1 は SQLite。外部キーは `PRAGMA foreign_keys=ON` が必要だが、D1 は接続ごとに OFF がデフォルト。**アプリ側で整合性を担保し、FK 制約は宣言のみ（ドキュメント目的）とする**。実削除は洗い替え（DELETE→INSERT）で行うため FK カスケードに依存しない。

### 0001_init.sql

```sql
-- 劇場マスタ
CREATE TABLE theaters (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  short_name        TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  lat               REAL NOT NULL,
  lng               REAL NOT NULL,
  nearest_station   TEXT NOT NULL,
  walk_min_from_sta INTEGER NOT NULL DEFAULT 5,
  schedule_url      TEXT NOT NULL,
  fetch_method      TEXT NOT NULL DEFAULT 'static',
  official_url      TEXT NOT NULL,
  terms_note        TEXT,
  terms_checked_at  TEXT,
  robots_status     TEXT NOT NULL DEFAULT 'unknown',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (status IN ('active','paused','retired')),
  CHECK (fetch_method IN ('static','rendered')),
  CHECK (robots_status IN ('allowed','disallowed','unknown'))
);

CREATE TABLE movies (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  title_key     TEXT NOT NULL,
  runtime_min   INTEGER,
  official_site TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (title_key)
);

CREATE TABLE ingest_runs (
  id              TEXT PRIMARY KEY,
  theater_id      TEXT NOT NULL REFERENCES theaters(id),
  business_date   TEXT NOT NULL,
  trigger         TEXT NOT NULL,
  status          TEXT NOT NULL,
  snapshot_key    TEXT,
  extracted_count INTEGER,
  written_count   INTEGER,
  error_message   TEXT,
  llm_model       TEXT,
  llm_in_tokens   INTEGER,
  llm_out_tokens  INTEGER,
  prompt_version  TEXT,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  CHECK (trigger IN ('cron','manual','retry')),
  CHECK (status IN ('queued','fetching','extracting','succeeded',
                    'validation_failed','fetch_failed','extraction_failed'))
);
CREATE INDEX idx_ingest_runs_list ON ingest_runs (theater_id, started_at DESC);
CREATE INDEX idx_ingest_runs_status ON ingest_runs (status, started_at DESC);

CREATE TABLE screenings (
  id             TEXT PRIMARY KEY,
  theater_id     TEXT NOT NULL REFERENCES theaters(id),
  movie_id       TEXT NOT NULL REFERENCES movies(id),
  business_date  TEXT NOT NULL,
  start_at       TEXT NOT NULL,
  end_at         TEXT NOT NULL,
  end_at_source  TEXT NOT NULL DEFAULT 'site',
  format         TEXT,
  detail_url     TEXT,
  ingest_run_id  TEXT NOT NULL REFERENCES ingest_runs(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (theater_id, business_date, movie_id, start_at),
  CHECK (end_at_source IN ('site','estimated'))
);
CREATE INDEX idx_screenings_lookup ON screenings (business_date, theater_id, start_at);
CREATE INDEX idx_screenings_movie ON screenings (business_date, movie_id);

CREATE TABLE extraction_reviews (
  id             TEXT PRIMARY KEY,
  ingest_run_id  TEXT NOT NULL REFERENCES ingest_runs(id),
  status         TEXT NOT NULL DEFAULT 'pending',
  reason         TEXT NOT NULL,
  payload_json   TEXT NOT NULL,
  reviewed_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (status IN ('pending','approved','rejected'))
);
CREATE INDEX idx_reviews_pending ON extraction_reviews (status, created_at DESC);

CREATE TABLE shared_plans (
  id          TEXT PRIMARY KEY,
  plan_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX idx_shared_plans_expiry ON shared_plans (expires_at);
```

### 0002_add_extract_method.sql（ADR-0012）

劇場ごとの抽出方式 `extract_method`（`text` | `vision`）を追加。SQLite の ALTER ADD COLUMN は単一列 CHECK を許容する。既定は後方互換で `text`。

```sql
ALTER TABLE theaters
  ADD COLUMN extract_method TEXT NOT NULL DEFAULT 'text'
  CHECK (extract_method IN ('text','vision'));
```

### 0003_screenings_screen_name.sql（多スクリーン対応）

多スクリーン館（cinenouveau は2スクリーン）は同一作品・同時刻を別スクリーンで上映しうる。screenings に `screen_name` を追加し、一意性をスクリーン込みにする。SQLite は UNIQUE 変更にテーブル再作成が要るが、screenings は洗い替えで再生成されるため DROP→CREATE で作り直す（前方のみ）。

```sql
DROP INDEX IF EXISTS idx_screenings_lookup;
DROP INDEX IF EXISTS idx_screenings_movie;
DROP TABLE screenings;
CREATE TABLE screenings (
  ... (03 §3.3 の定義 + screen_name TEXT NOT NULL DEFAULT '') ...
  UNIQUE (theater_id, business_date, movie_id, start_at, screen_name)
);
CREATE INDEX idx_screenings_lookup ON screenings (business_date, theater_id, start_at);
CREATE INDEX idx_screenings_movie ON screenings (business_date, movie_id);
```

### 0005_theater_fetch_day_mode.sql（ADR-0019）

1ページに1日分しか掲載しないサイト（T・ジョイ梅田等）から複数日を取り込むための劇場ごと設定。`theaters` には 0001 由来の**テーブル制約** `CHECK (fetch_method IN ('static','rendered'))` があり SQLite ではテーブル再作成なしに削除できないため、`fetch_method` の値は増やさず、単一列 CHECK を持つ新規カラムで直交に表現する。既定値は後方互換（`single` / `1`）で backfill は不要。

```sql
ALTER TABLE theaters
  ADD COLUMN fetch_day_mode TEXT NOT NULL DEFAULT 'single'
  CHECK (fetch_day_mode IN ('single','tabs','url_template'));

-- 上限10は packages/shared の MAX_FETCH_DAYS と一致させる（手書き SQL への最終防御）
ALTER TABLE theaters
  ADD COLUMN fetch_days INTEGER NOT NULL DEFAULT 1
  CHECK (fetch_days >= 0 AND fetch_days <= 10);
```

### seeds/dev_seed.sql（ローカル専用・マイグレーションではない）

マイグレーション列に入れず、ローカルでのみ次で投入する（ST/prod には流さない）:

```
pnpm -F @cinema/api exec wrangler d1 execute cinema_hashigo --local \
  --persist-to ../../.wrangler-state --file ../../seeds/dev_seed.sql
```

P1 の取込対象 1館目（シネ・ヌーヴォ）を `paused`・`extract_method=vision` で投入する。受入プロセス（docs/guides/01 §2.2）を経て人間が active 昇格するまで公開 API には出さない。

```sql
INSERT INTO theaters (id,name,short_name,status,lat,lng,nearest_station,
  walk_min_from_sta,schedule_url,fetch_method,extract_method,official_url,
  terms_note,terms_checked_at,robots_status)
VALUES
('thr_cnv01','シネ・ヌーヴォ','シネ・ヌーヴォ','paused',34.6692,135.4781,'九条',
  5,'http://www.cinenouveau.com/schedule/schedule1.html','static','vision',
  'http://www.cinenouveau.com/',
  'robots.txt無し(許容)/規約にスクレイピング禁止記載なし/アグリゲーター非経由/画像(GIF)をvision抽出。2026-07-10確認',
  '2026-07-10T00:00:00Z','allowed');
```

## 2. ID 生成

- 形式: `{prefix}_{base58(12桁)}`。プレフィックスは `02_glossary.md` 準拠（thr/mov/scr/pln/run/rev）。
- 実装（shared）:

```ts
import { customAlphabet } from 'nanoid';
const b58 = customAlphabet('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', 12);
export const newId = (p: 'thr'|'mov'|'scr'|'pln'|'run'|'rev') => `${p}_${b58()}`;
```

- `shared_plans.id`（pln）は共有 URL に載るため、推測困難性が重要。12桁 base58 ≒ 70bit で十分。

## 3. 時刻の扱い（実装規約）

- DB 保存: **ISO 8601 UTC 文字列**（例 `2026-07-12T01:30:00Z`）。SQLite の datetime 関数と比較互換にするため `Z` 付き ISO を一貫使用。
- `business_date`: JST の `YYYY-MM-DD` 文字列。興行日（レイトショーで日付跨ぎでも変えない）。
- 変換ヘルパ（shared）:

```ts
// JST 実時刻 → business_date（05:00 JST 未満は前日扱い）
export function toBusinessDate(startUtc: string): string {
  const jst = new Date(new Date(startUtc).getTime() + 9*3600*1000);
  const h = jst.getUTCHours();
  const d = new Date(jst);
  if (h < 5) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0,10);
}
// "25:10" + business_date(JST) → UTC ISO
export function normalizeStart(businessDate: string, hhmm: string): string {
  let [h,m] = hhmm.split(':').map(Number);
  let addDay = 0;
  if (h >= 24) { h -= 24; addDay = 1; }
  const jst = new Date(`${businessDate}T00:00:00+09:00`);
  jst.setHours(jst.getHours() + h + addDay*24, m);
  return jst.toISOString(); // UTC Z
}
```

## 4. アクセス層 — 書込（ingest）

### 4.1 洗い替え書込（中核）

同一 `(theater_id, business_date)` を DELETE してから INSERT する。D1 は `batch()` で複数文をまとめて実行する（トランザクション的にアトミック）。

```ts
export async function replaceScreenings(
  db: D1Database,
  theaterId: string,
  businessDate: string,
  runId: string,
  rows: NormalizedScreening[]   // movie_id 解決済み・UTC 化済み
): Promise<number> {
  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    db.prepare(`DELETE FROM screenings WHERE theater_id = ? AND business_date = ?`)
      .bind(theaterId, businessDate)
  );
  for (const r of rows) {
    stmts.push(
      db.prepare(
        `INSERT INTO screenings
           (id, theater_id, movie_id, business_date, start_at, end_at,
            end_at_source, format, detail_url, ingest_run_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        newId('scr'), theaterId, r.movieId, businessDate,
        r.startAt, r.endAt, r.endAtSource, r.format ?? null,
        r.detailUrl ?? null, runId
      )
    );
  }
  await db.batch(stmts);   // 全文まとめて実行
  return rows.length;
}
```

**注意**: この関数は「通常取込」と「レビュー承認時の反映」の両方から呼ぶ。反映ロジックを二重実装しない（03 §7）。

### 4.2 movie 名寄せ（UPSERT）

```ts
export async function resolveMovieId(
  db: D1Database, title: string, runtimeMin: number|null
): Promise<string> {
  const key = titleKey(title);   // 正規化 → 03 §6 / 06 §6
  const found = await db.prepare(
    `SELECT id FROM movies WHERE title_key = ?`
  ).bind(key).first<{id:string}>();
  if (found) return found.id;
  const id = newId('mov');
  await db.prepare(
    `INSERT INTO movies (id, title, title_key, runtime_min)
     VALUES (?,?,?,?)
     ON CONFLICT(title_key) DO NOTHING`
  ).bind(id, title, key, runtimeMin).run();
  // 競合時は既存を取り直す
  const row = await db.prepare(`SELECT id FROM movies WHERE title_key = ?`)
    .bind(key).first<{id:string}>();
  return row!.id;
}

export function titleKey(t: string): string {
  return t
    .normalize('NFKC')                    // 全半角統一
    .replace(/[\s!?！？・:：\-─【】()（）「」『』]/g, '')
    .toLowerCase();
}
```

### 4.3 IngestRun のライフサイクル更新

```ts
// 開始
await db.prepare(
  `INSERT INTO ingest_runs (id,theater_id,business_date,trigger,status,started_at)
   VALUES (?,?,?,?,'fetching',?)`
).bind(runId, theaterId, businessDate, trigger, nowIso()).run();

// 進行（例: 抽出へ）
await db.prepare(`UPDATE ingest_runs SET status=? WHERE id=?`)
  .bind('extracting', runId).run();

// 完了
await db.prepare(
  `UPDATE ingest_runs
     SET status=?, snapshot_key=?, extracted_count=?, written_count=?,
         llm_model=?, llm_in_tokens=?, llm_out_tokens=?, prompt_version=?,
         finished_at=?
   WHERE id=?`
).bind('succeeded', snapshotKey, extracted, written,
       model, inTok, outTok, promptVer, nowIso(), runId).run();
```

## 5. アクセス層 — 読取（api）

### 5.1 planner 用: 対象日の候補 Screening ロード

active 劇場のみ、必要列を JOIN で一括取得。

```ts
export async function loadCandidates(
  db: D1Database, businessDate: string
): Promise<CandidateScreening[]> {
  const { results } = await db.prepare(
    `SELECT s.id            AS screeningId,
            s.theater_id    AS theaterId,
            s.movie_id      AS movieId,
            s.start_at      AS startAt,
            s.end_at        AS endAt,
            s.format        AS format,
            s.detail_url    AS detailUrl,
            m.title         AS movieTitle,
            t.name          AS theaterName,
            t.official_url  AS officialUrl
       FROM screenings s
       JOIN theaters t ON t.id = s.theater_id
       JOIN movies   m ON m.id = s.movie_id
      WHERE s.business_date = ?
        AND t.status = 'active'
      ORDER BY s.start_at ASC`
  ).bind(businessDate).all<CandidateScreening>();
  return results;
}
```

- planner はこの配列（通常 ≤ 1,500件）をメモリに載せて DP する。D1 への追加クエリは行わない。
- `detail_url` があれば ScreeningLeg.officialUrl に優先使用、なければ theater.official_url。

### 5.2 `/movies`（上映時刻を返さない）

```sql
SELECT DISTINCT m.id, m.title, m.runtime_min
FROM screenings s
JOIN movies m ON m.id = s.movie_id
JOIN theaters t ON t.id = s.theater_id
WHERE s.business_date = ?1 AND t.status = 'active'
ORDER BY m.title;
```

- 原則1（内部利用限定）: 作品の存在のみ返し、時刻・劇場別内訳は返さない。

### 5.3 `/theaters`

```sql
SELECT id, name, short_name, lat, lng, official_url
FROM theaters WHERE status = 'active' ORDER BY name;
```

### 5.4 データ未取込の判定（422 分岐）

`/plan` で対象日データがあるかを先に判定し、`no_screenings`(0件) と `DATA_NOT_READY`(未取込) を区別する。

月間画像の vision 取込（ADR-0012）では 1 回の取込が複数 businessDate を書き込む一方、`ingest_runs.business_date` は実行日である。したがって ready 判定は「対象日の screenings が存在する **or** 対象日を business_date とする succeeded run が存在する」とする（前者が月間取込を、後者が日次取込・休館日 0 件を拾う）。

**いずれの判定も `theaters.status='active'` の劇場に限定する。** `/plan` の候補ロード・origin 解決（§5.1・planner）は active 劇場のみを対象にするため、ready 判定だけが paused 劇場のデータを拾うと不整合になる（採用プロセス中の paused 劇場を手動取込した ST 等で、ready=true なのに active 劇場が 0 件 → origin 解決不能の 400 になる。P4-0 で検出）。active 劇場に限定すれば、そのようなケースは 422 DATA_NOT_READY で明快に返る。

```ts
// active 劇場について、対象日の screenings が1件も無く succeeded run も無い = 未取込 → 422
export async function isDataReady(db: D1Database, businessDate: string): Promise<boolean> {
  const scr = await db.prepare(
    `SELECT 1 FROM screenings s
       JOIN theaters t ON t.id = s.theater_id
      WHERE s.business_date=?1 AND t.status='active' LIMIT 1`
  ).bind(businessDate).first();
  if (scr) return true;
  const run = await db.prepare(
    `SELECT 1 FROM ingest_runs r
       JOIN theaters t ON t.id = r.theater_id
      WHERE r.business_date=?1 AND r.status='succeeded' AND t.status='active' LIMIT 1`
  ).bind(businessDate).first();
  return run !== null;
}
```

- 既知の限界: 月間取込の対象月内で「休館日等により 0 件」の日は 422 になる（本来は no_screenings が正しい）。運用上まれで実害が小さいため P2 では許容し、必要になったら run にカバー範囲（from/to）を持たせて解消する。

## 6. レビュー承認の反映

```ts
export async function approveReview(db: D1Database, reviewId: string) {
  const rev = await db.prepare(
    `SELECT ingest_run_id, payload_json FROM extraction_reviews
      WHERE id=?1 AND status='pending'`
  ).bind(reviewId).first<{ingest_run_id:string; payload_json:string}>();
  if (!rev) throw new Error('review not found or not pending');

  const payload = ExtractionResult.parse(JSON.parse(rev.payload_json));
  const run = await getRun(db, rev.ingest_run_id);

  // 正規化 + movie 解決（通常パスと同一関数）
  const rows = await normalizeAndResolve(db, run.theater_id, payload);
  await replaceScreenings(db, run.theater_id, payload.businessDate,
                          rev.ingest_run_id, rows);   // ← 4.1 を再利用

  await db.batch([
    db.prepare(`UPDATE extraction_reviews SET status='approved', reviewed_at=?2 WHERE id=?1`)
      .bind(reviewId, nowIso()),
    db.prepare(`UPDATE ingest_runs SET status='succeeded', written_count=?2, finished_at=?3 WHERE id=?1`)
      .bind(rev.ingest_run_id, rows.length, nowIso()),
  ]);
}
```

## 7. データ保持 Cron（日次）

`03_data-model.md` §4 の期限削除を1つの Cron で実行する。

```sql
-- screenings: business_date が 30日以上前（YYYY-MM-DD 同士の文字列比較で安全）
DELETE FROM screenings
 WHERE business_date < date('now','-30 days');

-- ingest_runs: started_at が 180日以上前。
-- extraction_reviews から参照されている行は消さない（pending が長期残存した場合の
-- FK 違反ガード。D1 は FK を既定で強制するため、違反すると batch 全体が rollback する。
-- 当該 run はレビュー解決→90日経過後の Cron で自然に消える）
DELETE FROM ingest_runs
 WHERE datetime(started_at) < datetime('now','-180 days')
   AND id NOT IN (SELECT ingest_run_id FROM extraction_reviews);

-- shared_plans: 期限切れ
DELETE FROM shared_plans
 WHERE datetime(expires_at) < datetime('now');

-- extraction_reviews: 解決済み(approved/rejected)かつ 90日以上前
DELETE FROM extraction_reviews
 WHERE status <> 'pending'
   AND datetime(created_at) < datetime('now','-90 days');
```

- **左辺を `datetime()` でラップする理由（2026-07-28 修正・P5-5）**: アプリが書く列（`started_at`・`expires_at`）は ISO `T`+`Z` 形式（§3）、`datetime('now')` はスペース区切り形式で、生の文字列比較では `'T'(0x54) > ' '(0x20)` により**同日内の期限切れ判定が最大1日遅れる**。`datetime()` は両形式をパースして正規形に揃える。インデックスは効かなくなるが対象テーブルは最大でも数万行（N-05 前提で screenings 45,000行）・日次1回のため問題ない。`business_date` は `YYYY-MM-DD` 同士なのでラップ不要。
- R2 スナップショット（90日）は R2 のライフサイクルルールで別途削除（D1 Cron の対象外）。ST/prod のバケットへのルール適用は P5-5（ST）/ P5-7（prod）。
- 削除順は screenings → ingest_runs の順（screenings が ingest_run を参照するため、参照先を後に消す）。ただし FK は宣言のみなので順序は厳密には問わない。運用上は上記順を推奨。extraction_reviews も ingest_runs を参照するため ingest_runs より先に消す。

## 8. D1 固有の注意点

- **1クエリの結果サイズ・実行時間に上限**がある。planner の候補ロード（5.1）は business_date 1日分に限定し、全期間スキャンしない（インデックス `idx_screenings_lookup` が効く）。
- **`batch()` はアトミック**だが、`prepare().run()` を個別に連続実行してもトランザクションにはならない。洗い替え（4.1）と承認反映（6）は必ず `batch()` を使う。
- **`ON CONFLICT` は使えるが、複合的な UPSERT は避け**、SELECT→分岐→INSERT の明示フローにする（4.2）。競合時の取り直しを忘れない。
- boolean 型はない。フラグは `INTEGER 0/1` か status 文字列で表現（本設計は status 文字列で統一）。
- `datetime('now')` は UTC を返す。business_date 比較で JST 境界が要る箇所はアプリ側で計算する。
