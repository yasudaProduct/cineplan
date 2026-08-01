-- 0001_init.sql — 全テーブル定義・インデックス（docs/spec/09 §1 / docs/spec/03 §3）
-- D1 (SQLite)。FK は宣言のみ（PRAGMA foreign_keys は接続ごと OFF。整合性はアプリ側で担保）。

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
