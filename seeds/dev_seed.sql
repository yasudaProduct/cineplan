-- seeds/dev_seed.sql — ローカル開発専用の seed（マイグレーションではない）。
-- ST/prod には適用しない。適用は wrangler d1 execute --local --file で行う（CLAUDE.md 参照）。
-- 目的: P1 の取込対象 1館目（シネ・ヌーヴォ）をローカルに用意する。
--
-- 採用状態は paused。docs/08 §0・docs/16 §2.2 の受入プロセス（手動取込→レビュー全件目視→
-- 3日連続 succeeded）を経て人間が active 昇格するまで公開 API には出さない。
-- 抽出は vision（月間スケジュール画像 GIF を Gemini/Ollama で抽出。ADR-0012）。
-- robots.txt 無し（許容）・規約にスクレイピング禁止記載なし・アグリゲーター非経由（2026-07-10 確認）。
-- lat/lng は九条エリアの概算値（実装時に精緻化）。
INSERT OR IGNORE INTO theaters (id,name,short_name,status,lat,lng,nearest_station,
  walk_min_from_sta,schedule_url,fetch_method,extract_method,official_url,
  terms_note,terms_checked_at,robots_status)
VALUES
('thr_cnv01','シネ・ヌーヴォ','シネ・ヌーヴォ','paused',34.6692,135.4781,'九条',
  5,'http://www.cinenouveau.com/schedule/schedule1.html','static','vision',
  'http://www.cinenouveau.com/',
  'robots.txt無し(許容)/規約にスクレイピング禁止記載なし/アグリゲーター非経由/月間スケジュールは画像(GIF)をvision抽出。2026-07-10確認',
  '2026-07-10T00:00:00Z','allowed');

-- 開発用ダミー2館目（P4-6 の TravelMatrix ローカル検証用。実在劇場ではない）。
-- schedule_url はローカルを指す（誤って先方サイトへ取込しないため）。robots/terms 未確認の
-- paused なのでコンプラゲート（compliance-guard）が取込を拒否する。行列生成は座標のみ使用。
INSERT OR IGNORE INTO theaters (id,name,short_name,status,lat,lng,nearest_station,
  walk_min_from_sta,schedule_url,fetch_method,extract_method,official_url,
  terms_note,terms_checked_at,robots_status)
VALUES
('thr_dev01','デモシアター梅田（開発用）','デモ梅田','paused',34.7025,135.4959,'梅田',
  3,'http://localhost:9999/dev-only','static','vision','http://localhost:9999/',
  NULL,NULL,'unknown');
