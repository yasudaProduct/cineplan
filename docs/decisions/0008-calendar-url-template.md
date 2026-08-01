# ADR-0008: カレンダー連携を URL テンプレート方式で行う
- Status: Accepted
- Date: 2026-07-07

## Context
ルートをカレンダー登録したい（F-10）。OAuth を実装するとバックエンドに認証基盤・トークン管理が必要になり、MVP の「認証なし・個人情報を持たない」方針と衝突する。

## Decision
Google カレンダーは `calendar.google.com/render?action=TEMPLATE` の URL 生成（クライアント側）で対応。複数予定の一括登録は .ics ファイル生成（サーバ側）で対応する。Calendar API・OAuth は使わない。

## Consequences
- バックエンドに認証基盤を持たずに済み、初期実装が大幅に軽い。個人情報も保持しない。
- Apple/Outlook も .ics でカバーできる。
- 制約: 「既存予定との重複チェック」等の高度な連携はできない（MVP では不要）。

## Alternatives considered
- Google Calendar API + OAuth: 高機能だが認証基盤が必要でオーバースペック。将来ログイン機能を入れる段階で再検討。
