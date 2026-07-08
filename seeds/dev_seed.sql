-- seeds/dev_seed.sql — ローカル開発専用の seed（マイグレーションではない）。
-- ST/prod には適用しない。適用は wrangler d1 execute --local --file で行う（CLAUDE.md 参照）。
-- 目的: 実取込(P1)前に DP(P2)をローカル検証するためのダミー劇場を1件用意する。
INSERT INTO theaters (id,name,short_name,status,lat,lng,nearest_station,
  walk_min_from_sta,schedule_url,fetch_method,official_url,
  terms_note,terms_checked_at,robots_status)
VALUES
('thr_dev01','開発用劇場A','劇場A','active',34.7025,135.4959,'大阪',
  5,'https://example.com/theater-a/schedule?date={date}','static',
  'https://example.com/theater-a',
  'robots.txt allow確認済/規約にスクレイピング禁止記載なし','2026-07-07T00:00:00Z','allowed');
