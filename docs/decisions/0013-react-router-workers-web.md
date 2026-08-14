# ADR-0013: Web を React Router v8（旧 Remix）+ Cloudflare Workers で実装
- Status: Accepted
- Date: 2026-07-12

## Context
docs/15 は web パッケージを「Next.js App Router 想定・Cloudflare Pages」としていた（docs/07 §3 の選択肢は「Next.js on Cloudflare / Remix」）。P3-1 着手時点（2026-07）の Cloudflare の推奨は、新規 Web アプリを **Workers + 公式 Vite プラグイン**で構築する方向であり、公式テンプレート（create-cloudflare）は React Router（framework mode・旧 Remix）を第一級サポートする。Next.js を Workers で動かすには OpenNext アダプタ層が必要で、本プロジェクトの規模（数ページ・単一開発者・N-04 コスト制約）にはオーバーヘッドが大きい。P5-2 の共有ページは OGP のため SSR 必須。

## Decision
web は **React Router v8（framework mode・旧 Remix）+ Cloudflare Workers（@cloudflare/vite-plugin・静的アセット）** で実装する。docs/07 §3 の選択肢「Remix」の後継を採用するものであり、スコープ（画面構成・遷移は docs/07 が正）は変えない。構成は create-cloudflare の公式テンプレート（wrangler.jsonc・workers/app.ts・react-router.config.ts・Tailwind v4）に従う。デプロイは Pages ではなく Worker（`cinema-web-st` / `cinema-web-prod`。docs/14 §3.1 を更新）。

## Consequences
- SSR 内蔵のため P5-2（共有ページ SSR + OGP）に追加基盤なしで進める。Vite ベースで開発が高速。
- Cloudflare 公式サポート経路（Vite プラグイン）に乗るため、アダプタ起因の破損リスクが小さい。
- web パッケージのみ wrangler.jsonc・独自 tsconfig（React Router の型生成 `.react-router/types` 都合）となり、api/ingest（wrangler.toml・tsconfig.base 継承）と形式が異なる。テンプレート準拠を優先する。
- 環境切替は build 時の `CLOUDFLARE_ENV`（vite プラグインの env 選択）+ `wrangler deploy`。実デプロイの検証は P4-0（ST）で行う。
- モバイル（P6・Expo）へは従来どおり shared の型・API クライアントを流用する方針のまま（web の UI フレームワークに依存しない）。

## Alternatives considered
- **Next.js + OpenNext アダプタ（Workers）**: 実績はあるがアダプタ層のバージョン追従リスクとビルド複雑性が本規模に見合わない。
- **Cloudflare Pages（旧 next-on-pages 等）**: 新規開発の推奨が Workers に移行しており、採用しない。
- **Vite + React SPA（SSRなし）**: 最軽量だが P5-2 の SSR/OGP で行き詰まる。共有ページだけ Worker で meta 生成する変則案は描画ロジックが分裂するため不採用。
