# データモデル設計 — D1 / R2 / KV

- Version: 0.1
- 前提: Cloudflare D1 (SQLite)。取込サービスが書込、コアAPIは読取専用。マイグレーションは wrangler d1 migrations で管理。

## 1. 全体像

```
D1 (正)         : theaters, movies, screenings, ingest_runs, extraction_reviews, shared_plans
R2 (スナップショット): raw/{theaterId}/{businessDate}/{fetchedAt}.html
KV (キャッシュ)   : travel-matrix:{version}, station-geo:{stationName}
```

- Screening が唯一の「取込 → 公開」結合点。公開側は theaters / movies / screenings / shared_plans のみ参照する。
- R2 は再抽出のための一次資料。D1 と不整合が出た場合は R2 → 再抽出で復元する。

## 2. ER 図

```
theaters 1 ──── * screenings * ──── 1 movies
    │                 ▲
    │                 │ (produces)
    └──── * ingest_runs 1 ──── * extraction_reviews

shared_plans（独立。screenings のスナップショットを JSON で内包）
```

## 3. テーブル定義（DDL）

```sql
-- 3.1 劇場マスタ
CREATE TABLE theaters (
  id                TEXT PRIMARY KEY,             -- thr_xxxx
  name              TEXT NOT NULL,                -- 表示名（例: TOHOシネマズ梅田）
  short_name        TEXT,                         -- UI 用短縮名
  status            TEXT NOT NULL DEFAULT 'active', -- active | paused | retired
  -- 位置情報（移動時間行列・最寄り駅解決に使用）
  lat               REAL NOT NULL,
  lng               REAL NOT NULL,
  nearest_station   TEXT NOT NULL,                -- 駅すぱあと互換の駅名
  walk_min_from_sta INTEGER NOT NULL DEFAULT 5,   -- 最寄駅からの徒歩分
  -- 取込設定
  schedule_url      TEXT NOT NULL,                -- 取得対象 URL（日付はテンプレート可: {date}）
  fetch_method      TEXT NOT NULL DEFAULT 'static', -- static | rendered
  official_url      TEXT NOT NULL,                -- 利用者誘導先（予約はこちら）
  -- コンプライアンス記録（F-24）
  terms_note        TEXT,                         -- 規約確認メモ
  terms_checked_at  TEXT,                         -- ISO8601。90日超過で管理UI警告
  robots_status     TEXT,                         -- allowed | disallowed | unknown
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3.2 作品マスタ
CREATE TABLE movies (
  id            TEXT PRIMARY KEY,                 -- mov_xxxx
  title         TEXT NOT NULL,                    -- 正規化済みタイトル
  title_key     TEXT NOT NULL,                    -- 名寄せキー（記号・空白除去/小文字化）
  runtime_min   INTEGER,                          -- 上映時間（抽出 or 手動補完）
  official_site TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (title_key)
);

-- 3.3 上映（中核テーブル）
CREATE TABLE screenings (
  id             TEXT PRIMARY KEY,                -- scr_xxxx
  theater_id     TEXT NOT NULL REFERENCES theaters(id),
  movie_id       TEXT NOT NULL REFERENCES movies(id),
  business_date  TEXT NOT NULL,                   -- 興行日 YYYY-MM-DD (JST)
  start_at       TEXT NOT NULL,                   -- ISO8601 UTC（24時超え表記は実時刻に正規化済み）
  end_at         TEXT NOT NULL,                   -- 不明時は start_at + movies.runtime_min + 10分(予告)
  end_at_source  TEXT NOT NULL DEFAULT 'site',    -- site | estimated
  format         TEXT,                            -- 2D | IMAX | 4DX | SUB | DUB 等（複合は "IMAX,SUB"）
  detail_url     TEXT,                            -- 該当作品の劇場公式ページ（F-07）
  ingest_run_id  TEXT NOT NULL REFERENCES ingest_runs(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (theater_id, business_date, movie_id, start_at)
);
CREATE INDEX idx_screenings_lookup ON screenings (business_date, theater_id, start_at);

-- 3.4 取込実行履歴
CREATE TABLE ingest_runs (
  id              TEXT PRIMARY KEY,               -- run_xxxx
  theater_id      TEXT NOT NULL REFERENCES theaters(id),
  business_date   TEXT NOT NULL,                  -- 取得対象日
  trigger         TEXT NOT NULL,                  -- cron | manual | retry
  status          TEXT NOT NULL,                  -- 用語集のステータス定義に従う
  snapshot_key    TEXT,                           -- R2 キー
  extracted_count INTEGER,
  written_count   INTEGER,
  error_message   TEXT,
  llm_model       TEXT,                           -- 例: claude-haiku-4-5
  llm_in_tokens   INTEGER,
  llm_out_tokens  INTEGER,
  prompt_version  TEXT,                           -- 抽出プロンプトのバージョン（06_extraction-spec.md）
  started_at      TEXT NOT NULL,
  finished_at     TEXT
);
CREATE INDEX idx_ingest_runs_list ON ingest_runs (theater_id, started_at DESC);

-- 3.5 レビューキュー（検証NG時）
CREATE TABLE extraction_reviews (
  id             TEXT PRIMARY KEY,                -- rev_xxxx
  ingest_run_id  TEXT NOT NULL REFERENCES ingest_runs(id),
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reason         TEXT NOT NULL,                   -- 検証NGの理由（machine-readable コード + 詳細）
  payload_json   TEXT NOT NULL,                   -- 抽出結果全体（承認時にこれを screenings へ反映）
  reviewed_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3.6 共有プラン（F-12, F-13）
CREATE TABLE shared_plans (
  id          TEXT PRIMARY KEY,                   -- pln_xxxx（推測困難なランダム）
  plan_json   TEXT NOT NULL,                      -- Plan のスナップショット（API レスポンス形式）
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL                       -- created_at + 30日
);
```

## 4. データ保持・ライフサイクル

| データ | 保持期間 | 削除方式 |
|---|---|---|
| screenings | business_date から 30日 | 日次 Cron で削除（分析用途が出たら R2 へアーカイブ） |
| ingest_runs | 180日 | 日次 Cron |
| R2 スナップショット | 90日 | R2 ライフサイクルルール |
| shared_plans | expires_at 経過後 | 日次 Cron |
| extraction_reviews | 解決後 90日 | 日次 Cron |

## 5. KV 設計

### 5.1 travel-matrix

- キー: `travel-matrix:v{n}`（世代管理。切替はアトミックにキー差し替え）
- 値: JSON

```jsonc
{
  "generatedAt": "2026-07-06T21:00:00Z",
  "unit": "minutes",
  "theaters": ["thr_a", "thr_b", ...],
  // matrix[i][j] = theaters[i] から theaters[j] への所要分（駅→駅 + 両端徒歩）
  "matrix": [[0, 24, ...], [26, 0, ...], ...],
  // 経路概要（UI 表示用、任意）
  "summaries": { "thr_a>thr_b": "梅田→なんば（御堂筋線）" }
}
```

- 生成: 週次バッチ（ingest パッケージの Cron）。駅すぱあと API で `nearest_station` 間を検索し、`walk_min_from_sta` を両端に加算。
- 非対称（i→j ≠ j→i）を許容する。
- 30館で 870 要素。フリープラン枠を考慮し、差分更新（新規劇場追加時はその行・列のみ計算）を基本とする。

### 5.2 station-geo

- キー: `station-geo:{駅名}` → `{ lat, lng }`。origin の geo→最寄駅解決の補助キャッシュ。TTL 30日。

## 6. 名寄せ規則（movies）

1. 抽出タイトルから `title_key` を生成: 全半角統一 → 空白・記号（!?！？・:：-─【】()（）)除去 → 小文字化。
2. `title_key` 完全一致で既存 Movie に紐付け。なければ新規作成。
3. 劇場間で表記揺れが激しい場合（副題の有無等）は管理サイトから手動マージできる余地を残す（MVP では手動 SQL で可）。
4. `runtime_min` はサイトから取れた値を優先。取れない場合は null とし、end_at 推定時は同一 movie の他劇場値を流用。

## 7. 整合性ルール

- screenings の書込は「同一 (theater_id, business_date) を DELETE → INSERT」のトランザクションで置換する（部分更新はしない）。取込は洗い替えが正。
- 公開 API は `theaters.status = 'active'` の劇場の screenings のみ返す。paused/retired にしても既存データは物理削除しない。
- extraction_reviews の approve 時は、payload_json を通常の書込パスと同一の関数で反映する（反映ロジックを二重実装しない）。
