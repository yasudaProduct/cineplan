-- seeds/dev_seed_screenings.sql — ローカル開発専用の上映データ seed（マイグレーションではない）。
-- ST/prod には適用しない。dev_seed.sql（劇場マスタ）の後に適用する。
--
-- 目的: /plan のローカル動作確認用に「今日・明日（JST）」の上映データを用意する。
-- 実在の劇場（thr_cnv01）は docs/spec/08 §0 の受入プロセス（手動取込→レビュー→3日連続成功）を
-- 経て人間が active 化するものなので、このファイルでは触らない。代わりに完全に架空の
-- 開発専用劇場（thr_dev01・thr_dev02。実在しない）を active にして使う。
--
-- 日付は固定値ではなく SQLite の日時関数で「適用時点の JST 今日/明日」を都度算出する
-- （date('now','+9 hours') が UTC+9h の日付 = JST の日付になる近似）。screenings/ingest_runs は
-- id を固定し INSERT OR REPLACE にしているため、日をまたいで再適用すれば常に最新の今日/明日に
-- 更新される（idempotent）。
--
-- 適用例（CLAUDE.md 参照）:
--   pnpm -F @cinema/api exec wrangler d1 execute cinema_hashigo --local --persist-to ../../.wrangler-state --file ../../seeds/dev_seed.sql
--   pnpm -F @cinema/api exec wrangler d1 execute cinema_hashigo --local --persist-to ../../.wrangler-state --file ../../seeds/dev_seed_screenings.sql

-- ---- 開発専用劇場（実在しない） ----

-- thr_dev01 は dev_seed.sql で status='paused' として定義済み（TravelMatrix 検証用）。
-- 未適用でも本ファイル単体で動くよう INSERT OR IGNORE しつつ、既存行があれば UPDATE で active 化する。
INSERT OR IGNORE INTO theaters (id,name,short_name,status,lat,lng,nearest_station,
  walk_min_from_sta,schedule_url,fetch_method,extract_method,official_url,
  terms_note,terms_checked_at,robots_status)
VALUES
('thr_dev01','デモシアター梅田（開発用）','デモ梅田','active',34.7025,135.4959,'梅田',
  3,'http://localhost:9999/dev-only','static','vision','http://localhost:9999/',
  'ローカル開発専用のダミー劇場（実在しない）。screenings シード検証用（seeds/dev_seed_screenings.sql）。',
  '2026-08-01T00:00:00Z','allowed');

UPDATE theaters
   SET status = 'active', robots_status = 'allowed', terms_checked_at = '2026-08-01T00:00:00Z'
 WHERE id = 'thr_dev01';

-- thr_dev02 は本ファイルで新規に追加する2館目（実在しない）。はしご（劇場間移動）を
-- ローカルで確認するための対。
INSERT OR IGNORE INTO theaters (id,name,short_name,status,lat,lng,nearest_station,
  walk_min_from_sta,schedule_url,fetch_method,extract_method,official_url,
  terms_note,terms_checked_at,robots_status)
VALUES
('thr_dev02','デモシアターなんば（開発用）','デモなんば','active',34.6656,135.5008,'なんば',
  4,'http://localhost:9999/dev-only-2','static','vision','http://localhost:9999/',
  'ローカル開発専用のダミー劇場（実在しない）。screenings シード検証用（seeds/dev_seed_screenings.sql）。',
  '2026-08-01T00:00:00Z','allowed');

-- ---- 作品（9本。8本超で MoviePicker の絞り込み検索が出る閾値を超えるよう意図的に用意） ----

INSERT OR IGNORE INTO movies (id,title,title_key,runtime_min) VALUES
('mov_seed01','はしごの朝','seed:はしごの朝',105),
('mov_seed02','夜明けのリール','seed:夜明けのリール',128),
('mov_seed03','スクリーン・オブ・ドリームズ','seed:スクリーン・オブ・ドリームズ',95),
('mov_seed04','青の劇場','seed:青の劇場',140),
('mov_seed05','午後のプレビュー','seed:午後のプレビュー',110),
('mov_seed06','終電のシネマ','seed:終電のシネマ',118),
('mov_seed07','夏のシネマテーブル','seed:夏のシネマテーブル',100),
('mov_seed08','銀幕のかけら','seed:銀幕のかけら',132),
('mov_seed09','九条ノスタルジア','seed:九条ノスタルジア',90);

-- ---- 取込実行（screenings の FK 用のダミー run） ----

INSERT OR REPLACE INTO ingest_runs
  (id, theater_id, business_date, trigger, status, extracted_count, written_count, started_at, finished_at)
SELECT v.id, v.theater_id,
       CASE v.day_offset WHEN 0 THEN d.jst0 ELSE d.jst1 END,
       'manual', 'succeeded', v.cnt, v.cnt, datetime('now'), datetime('now')
  FROM (SELECT date('now','+9 hours') AS jst0, date('now','+9 hours','+1 day') AS jst1) d
  JOIN (
    SELECT column1 AS id, column2 AS theater_id, column3 AS day_offset, column4 AS cnt
      FROM (VALUES
        ('run_seed_a0','thr_dev01',0,5),
        ('run_seed_a1','thr_dev01',1,4),
        ('run_seed_b0','thr_dev02',0,5),
        ('run_seed_b1','thr_dev02',1,4)
      )
  ) AS v;

-- ---- 上映（今日 10本 + 明日 8本。2館はしご・複数プラン案が出るように時間をずらして配置） ----
-- 21:30〜 の1本（scr_seed_b0_5）はデフォルト時間帯(〜22:00)の外に意図的に配置。
-- 時間帯を広げた場合の挙動（終電注意バッジ・緩和提案）の確認用。

INSERT OR REPLACE INTO screenings
  (id, theater_id, movie_id, business_date, start_at, end_at, end_at_source, format, screen_name, ingest_run_id)
SELECT
  v.id, v.theater_id, v.movie_id,
  (CASE v.day_offset WHEN 0 THEN d.jst0 ELSE d.jst1 END) AS business_date,
  strftime('%Y-%m-%dT%H:%M:%fZ',
    datetime((CASE v.day_offset WHEN 0 THEN d.jst0 ELSE d.jst1 END) || ' ' || v.start_time, '-9 hours')) AS start_at,
  strftime('%Y-%m-%dT%H:%M:%fZ',
    datetime((CASE v.day_offset WHEN 0 THEN d.jst0 ELSE d.jst1 END) || ' ' || v.end_time, '-9 hours')) AS end_at,
  'site', v.format, '', v.run_id
  FROM (SELECT date('now','+9 hours') AS jst0, date('now','+9 hours','+1 day') AS jst1) d
  JOIN (
    SELECT column1 AS id, column2 AS theater_id, column3 AS movie_id, column4 AS day_offset,
           column5 AS start_time, column6 AS end_time, column7 AS format, column8 AS run_id
      FROM (VALUES
        -- 今日 / デモ梅田(thr_dev01)
        ('scr_seed_a0_1','thr_dev01','mov_seed01',0,'09:30:00','11:30:00',NULL,'run_seed_a0'),
        ('scr_seed_a0_2','thr_dev01','mov_seed03',0,'12:00:00','13:45:00',NULL,'run_seed_a0'),
        ('scr_seed_a0_3','thr_dev01','mov_seed05',0,'14:15:00','16:15:00',NULL,'run_seed_a0'),
        ('scr_seed_a0_4','thr_dev01','mov_seed02',0,'17:00:00','19:20:00','IMAX','run_seed_a0'),
        ('scr_seed_a0_5','thr_dev01','mov_seed07',0,'20:00:00','21:40:00',NULL,'run_seed_a0'),
        -- 今日 / デモなんば(thr_dev02)
        ('scr_seed_b0_1','thr_dev02','mov_seed04',0,'10:00:00','12:30:00',NULL,'run_seed_b0'),
        ('scr_seed_b0_2','thr_dev02','mov_seed09',0,'13:00:00','14:50:00',NULL,'run_seed_b0'),
        ('scr_seed_b0_3','thr_dev02','mov_seed06',0,'15:30:00','17:35:00','字幕版','run_seed_b0'),
        ('scr_seed_b0_4','thr_dev02','mov_seed08',0,'18:15:00','19:55:00',NULL,'run_seed_b0'),
        ('scr_seed_b0_5','thr_dev02','mov_seed01',0,'21:30:00','23:15:00',NULL,'run_seed_b0'),
        -- 明日 / デモ梅田(thr_dev01)
        ('scr_seed_a1_1','thr_dev01','mov_seed03',1,'09:45:00','11:25:00',NULL,'run_seed_a1'),
        ('scr_seed_a1_2','thr_dev01','mov_seed02',1,'12:00:00','14:10:00','IMAX','run_seed_a1'),
        ('scr_seed_a1_3','thr_dev01','mov_seed07',1,'15:00:00','16:40:00',NULL,'run_seed_a1'),
        ('scr_seed_a1_4','thr_dev01','mov_seed01',1,'17:30:00','19:15:00',NULL,'run_seed_a1'),
        -- 明日 / デモなんば(thr_dev02)
        ('scr_seed_b1_1','thr_dev02','mov_seed04',1,'10:15:00','12:45:00',NULL,'run_seed_b1'),
        ('scr_seed_b1_2','thr_dev02','mov_seed06',1,'13:20:00','15:15:00','字幕版','run_seed_b1'),
        ('scr_seed_b1_3','thr_dev02','mov_seed09',1,'15:45:00','17:15:00',NULL,'run_seed_b1'),
        ('scr_seed_b1_4','thr_dev02','mov_seed08',1,'18:00:00','20:12:00',NULL,'run_seed_b1')
      )
  ) AS v;
