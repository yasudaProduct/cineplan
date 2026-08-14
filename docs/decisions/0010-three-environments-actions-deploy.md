# ADR-0010: 3環境（local/st/prod）と GitHub Actions デプロイ
- Status: Accepted
- Date: 2026-07-08

## Context
クラウド上の動作確認環境（ST）と本番を分け、デプロイを GitHub Actions で自動化したい。エミュレーションでは再現しない挙動（Queuesリトライ・Browser Rendering・Access・Cron）をクラウド上で確認する場所が必要。

## Decision
local / st / prod の3環境を設ける。Cloudflareリソース（D1/R2/KV/Queues/Worker/Pages）を st・prod で完全分離する。デプロイは Actions で、ST は `main` push で自動、本番は `v*` タグ + GitHub Environment `prod` の required reviewers による承認ゲートを通す。マイグレーションはデプロイ前に該当環境D1へ適用し、テスト（DP期待値含む）通過を前提とする。

## Consequences
- 動作確認を速く回しつつ（ST自動）、本番デプロイは承認必須で誤爆を防げる。
- st の Cron は原則OFFにし、開発検証で先方サイトを毎日叩かない（08 の取得マナー）。
- 資源・シークレット・APIトークンを環境ごとに分離することで越境事故を防ぐ。
- 制約: 環境ごとのリソースID管理が増える。命名規約（14 §3.1）で取り違えを防ぐ。

## Alternatives considered
- 単一環境（本番のみ）: シンプルだが本番で初めて不具合に気付くリスク。不採用。
- Cloudflare のプレビュー機能のみでST代替: Workers環境では機能差があり、独立したST資源の方が確実。ページ系はPagesプレビューを併用。
