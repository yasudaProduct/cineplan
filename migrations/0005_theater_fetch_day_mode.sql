-- 0005_theater_fetch_day_mode.sql — 劇場ごとの複数日取得（ADR-0019・docs/06 §2.2）。
-- 1ページに1日分しか掲載しないサイト（T・ジョイ梅田等）から複数日を取り込むための設定。
--   fetch_day_mode: single       = 現行（1取込 = 1ページロード）
--                   tabs         = 日付タブを順にクリック（fetch_method=rendered 必須）
--                   url_template = schedule_url の {date} を置換して日付ごとに静的取得
--   fetch_days:     取得日数。0 = 検出したタブ全件（tabs のみ）。コード側 MAX_FETCH_DAYS(=10) で頭打ち。
--
-- theaters には 0001 由来のテーブル制約 CHECK (fetch_method IN ('static','rendered')) があり、
-- SQLite ではテーブル再作成なしに削除できない。よって fetch_method の値は増やさず、
-- 単一列 CHECK を持つ新規カラムで直交に表現する（docs/11 §1・ADR-0019）。
-- 既定値は後方互換（single / 1）のため backfill UPDATE は不要。
ALTER TABLE theaters
  ADD COLUMN fetch_day_mode TEXT NOT NULL DEFAULT 'single'
  CHECK (fetch_day_mode IN ('single','tabs','url_template'));

-- 上限10は packages/shared の MAX_FETCH_DAYS と一致させる（手書き SQL への最終防御）。
-- 引き上げには docs/08 §6 の変更手続き（ADR + ポリシー改定）が必要。
ALTER TABLE theaters
  ADD COLUMN fetch_days INTEGER NOT NULL DEFAULT 1
  CHECK (fetch_days >= 0 AND fetch_days <= 10);
