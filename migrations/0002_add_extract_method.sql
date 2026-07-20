-- 0002_add_extract_method.sql — 劇場の抽出方式（ADR-0012）。
-- text = HTML→テキスト抽出 / vision = 画像→マルチモーダル抽出。
-- SQLite の ALTER ADD COLUMN は単一列 CHECK を許容する。既定は後方互換で 'text'。
ALTER TABLE theaters
  ADD COLUMN extract_method TEXT NOT NULL DEFAULT 'text'
  CHECK (extract_method IN ('text','vision'));
