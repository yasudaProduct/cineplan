-- 0004_reviews_note.sql — レビュー時のメモ列を追加（P4-5）。
-- docs/07 §2.5: 破棄（rejected）は理由メモ必須。承認時のメモは任意。
ALTER TABLE extraction_reviews ADD COLUMN review_note TEXT;
