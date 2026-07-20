-- seeds/st_seed.sql — ST 環境の劇場マスタ seed（P4-0）。
-- 適用: wrangler d1 execute cinema_hashigo_st --remote --file ../../seeds/st_seed.sql（api パッケージから）。
--
-- ST には「採用プロセス（docs/08 §2・docs/16 §2.2）を通過した実劇場」のみを入れる。
-- 開発用ダミーは含めない（それは dev_seed.sql／ローカル限定）。P4-3 の劇場マスタ CRUD が
-- 入るまでの暫定手段として SQL で投入する。
--
-- シネ・ヌーヴォは status=paused で投入。受入プロセス（手動取込→レビュー全件目視→
-- 3日連続 succeeded）を経て、人間が active 昇格するまで公開 API には出さない（docs/08 §0）。
-- INSERT OR IGNORE: 再実行で既存行（人間が active 昇格した後など）を paused に戻さない。
INSERT OR IGNORE INTO theaters (id,name,short_name,status,lat,lng,nearest_station,
  walk_min_from_sta,schedule_url,fetch_method,extract_method,official_url,
  terms_note,terms_checked_at,robots_status)
VALUES
('thr_cnv01','シネ・ヌーヴォ','シネ・ヌーヴォ','paused',34.6692,135.4781,'九条',
  5,'http://www.cinenouveau.com/schedule/schedule1.html','static','vision',
  'http://www.cinenouveau.com/',
  'robots.txt無し(許容)/規約にスクレイピング禁止記載なし/アグリゲーター非経由/月間スケジュールは画像(GIF)をvision抽出。2026-07-10確認',
  '2026-07-10T00:00:00Z','allowed');
