-- 0003_screenings_screen_name.sql — 多スクリーン対応（cinenouveau は2スクリーン）。
-- screenings に screen_name を追加し、一意性をスクリーン込みにする。
-- SQLite は UNIQUE 制約の変更にテーブル再作成が必要。screenings は洗い替えで再生成される
-- （公開側は最後に成功したデータで応答継続）ため、DROP→CREATE で作り直す（前方のみ）。
DROP INDEX IF EXISTS idx_screenings_lookup;
DROP INDEX IF EXISTS idx_screenings_movie;
DROP TABLE screenings;

CREATE TABLE screenings (
  id             TEXT PRIMARY KEY,
  theater_id     TEXT NOT NULL REFERENCES theaters(id),
  movie_id       TEXT NOT NULL REFERENCES movies(id),
  business_date  TEXT NOT NULL,
  start_at       TEXT NOT NULL,
  end_at         TEXT NOT NULL,
  end_at_source  TEXT NOT NULL DEFAULT 'site',
  format         TEXT,
  screen_name    TEXT NOT NULL DEFAULT '',       -- スクリーン名（単一館は ''）。多スクリーン一意性用
  detail_url     TEXT,
  ingest_run_id  TEXT NOT NULL REFERENCES ingest_runs(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (theater_id, business_date, movie_id, start_at, screen_name),
  CHECK (end_at_source IN ('site','estimated'))
);
CREATE INDEX idx_screenings_lookup ON screenings (business_date, theater_id, start_at);
CREATE INDEX idx_screenings_movie ON screenings (business_date, movie_id);
