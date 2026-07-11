-- seeds/dev_seed.sql — ローカル開発専用の seed（マイグレーションではない）。
-- ST/prod には適用しない。適用は wrangler d1 execute --local --file で行う（CLAUDE.md 参照）。
-- 目的: P1 の取込対象 1館目（シネ・ヌーヴォ）をローカルに用意する。
--
-- 採用状態は paused。docs/08 §0・docs/16 §2.2 の受入プロセス（手動取込→レビュー全件目視→
-- 3日連続 succeeded）を経て人間が active 昇格するまで公開 API には出さない。
-- 抽出は vision（月間スケジュール画像 GIF を Gemini/Ollama で抽出。ADR-0012）。
-- robots.txt 無し（許容）・規約にスクレイピング禁止記載なし・アグリゲーター非経由（2026-07-10 確認）。
-- lat/lng は九条エリアの概算値（実装時に精緻化）。
INSERT INTO theaters (id,name,short_name,status,lat,lng,nearest_station,
  walk_min_from_sta,schedule_url,fetch_method,extract_method,official_url,
  terms_note,terms_checked_at,robots_status)
VALUES
('thr_cnv01','シネ・ヌーヴォ','シネ・ヌーヴォ','paused',34.6692,135.4781,'九条',
  5,'http://www.cinenouveau.com/schedule/schedule1.html','static','vision',
  'http://www.cinenouveau.com/',
  'robots.txt無し(許容)/規約にスクレイピング禁止記載なし/アグリゲーター非経由/月間スケジュールは画像(GIF)をvision抽出。2026-07-10確認',
  '2026-07-10T00:00:00Z','allowed');
