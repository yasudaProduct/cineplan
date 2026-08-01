# ADR-0004: 抽出モデルに Claude Haiku を採用
- Status: Superseded by ADR-0011
- Date: 2026-07-07

## Context
抽出は日次・劇場数分だけ実行され、トークンコストが運用費の主変動要因。一方で抽出精度はサービス品質に直結する。

## Decision
まず Claude Haiku で実装する。管理サイトの検証NG率を見て、精度不足が観測されたら Sonnet へ引き上げる判断を行う。

## Consequences
- 初期コストを抑えられる。prompt_version と in/out トークンを ingest_runs に記録し、モデル変更の効果を計測可能にする。
- モデル差し替えを前提に、抽出呼出はモデル名を設定値として外出しする。

## Alternatives considered
- 最初から Sonnet: 精度は高いがコスト過大。まず Haiku で十分か検証してから上げる方が合理的。
- Workers AI のオープンモデル: さらに安いが、抽出品質がサービスの根幹なので、品質が読めるうちは API モデルを使う。コスト逼迫時に再評価。
