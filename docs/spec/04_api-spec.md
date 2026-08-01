# API 仕様 — コア API (Workers + Hono)

- Version: 0.1
- ベース URL: `https://api.<domain>/v1`
- 認証: MVP では公開 API に認証なし。レート制限（IP ベース、60 req/min）を Workers 側で実施。
- 本ファイルの OpenAPI 定義を正とする。`packages/shared` の zod スキーマは本定義から乖離させないこと（zod → OpenAPI 生成の運用を推奨: `@hono/zod-openapi`）。

## エンドポイント一覧

| Method | Path | 用途 | 消費者 |
|---|---|---|---|
| GET | `/v1/theaters` | 対応劇場一覧 | Web/App（条件入力画面） |
| GET | `/v1/movies?date=` | 対象日に上映がある作品一覧 | Web/App（マスト/ウィッシュ選択） |
| POST | `/v1/plan` | はしごルート算出 | Web/App |
| POST | `/v1/plans` | 共有プラン発行 | Web/App |
| GET | `/v1/plans/{planId}` | 共有プラン取得 | 共有ページ |
| GET | `/v1/plans/{planId}/ics` | .ics ダウンロード | 共有ページ/結果画面 |
| GET | `/healthz` | 死活監視 | 内部 |

補足: 「劇場×日付の上映一覧を返すエンドポイントは提供しない」（内部利用限定の原則）。`/v1/movies` は作品名のみで、上映時刻は返さない。

## OpenAPI 3.1 定義

```yaml
openapi: 3.1.0
info:
  title: Cinema Hashigo Core API
  version: 0.1.0
servers:
  - url: https://api.example.com/v1
paths:
  /theaters:
    get:
      operationId: listTheaters
      responses:
        "200":
          description: 対応劇場一覧
          content:
            application/json:
              schema:
                type: object
                properties:
                  theaters:
                    type: array
                    items: { $ref: "#/components/schemas/Theater" }

  /movies:
    get:
      operationId: listMovies
      parameters:
        - name: date
          in: query
          required: true
          schema: { type: string, format: date }
          description: 対象日 (JST)
      responses:
        "200":
          description: 対象日に上映がある作品（上映時刻は含まない）
          content:
            application/json:
              schema:
                type: object
                properties:
                  movies:
                    type: array
                    items: { $ref: "#/components/schemas/Movie" }

  /plan:
    post:
      operationId: createPlan
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PlanRequest" }
      responses:
        "200":
          description: ルート案。実行可能な案がない場合も 200 で infeasible を返す
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PlanResponse" }
        "400":
          description: 入力不正（zod 検証エラー）
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ApiError" }
        "422":
          description: 対象日のデータ未取込
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ApiError" }

  /plans:
    post:
      operationId: sharePlan
      description: 表示中の Plan を共有用に永続化し planId を返す
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [plan]
              properties:
                plan: { $ref: "#/components/schemas/Plan" }
      responses:
        "201":
          content:
            application/json:
              schema:
                type: object
                properties:
                  planId: { type: string, example: "pln_8f2kq0" }
                  url: { type: string, format: uri }
                  expiresAt: { type: string, format: date-time }

  /plans/{planId}:
    get:
      operationId: getSharedPlan
      parameters:
        - name: planId
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Plan" }
        "404": { description: 期限切れ or 不存在 }

  /plans/{planId}/ics:
    get:
      operationId: getPlanIcs
      parameters:
        - name: planId
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          content:
            text/calendar: { schema: { type: string } }

components:
  schemas:
    Theater:
      type: object
      required: [id, name, lat, lng, officialUrl]
      properties:
        id: { type: string, example: "thr_umeda01" }
        name: { type: string, example: "TOHOシネマズ梅田" }
        shortName: { type: string }
        lat: { type: number }
        lng: { type: number }
        officialUrl: { type: string, format: uri }

    Movie:
      type: object
      required: [id, title]
      properties:
        id: { type: string, example: "mov_x1y2z3" }
        title: { type: string }
        runtimeMin: { type: integer, nullable: true }

    Location:
      type: object
      required: [type, value]
      properties:
        type: { type: string, enum: [station, geo] }
        value:
          oneOf:
            - type: string                      # type=station: 駅名
            - type: object                      # type=geo
              required: [lat, lng]
              properties:
                lat: { type: number }
                lng: { type: number }

    PlanRequest:
      type: object
      required: [date, timeWindow, origin]
      properties:
        date: { type: string, format: date }
        timeWindow:
          type: object
          required: [start, end]
          properties:
            start: { type: string, pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", example: "09:00" }
            end: { type: string, pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", example: "22:00" }
        origin: { $ref: "#/components/schemas/Location" }
        destination:
          oneOf:
            - $ref: "#/components/schemas/Location"
            - type: "null"
        mustMovieIds:
          type: array
          maxItems: 3
          items: { type: string }
        wishMovieIds:
          type: array
          items: { type: string }
        arrivalMarginMin: { type: integer, minimum: 5, maximum: 60, default: 15 }
        maxResults: { type: integer, minimum: 1, maximum: 5, default: 3 }

    PlanResponse:
      type: object
      required: [plans]
      properties:
        plans:
          type: array
          items: { $ref: "#/components/schemas/Plan" }
        infeasible:
          type: object
          nullable: true
          properties:
            reason:
              type: string
              enum: [no_screenings, must_movie_unreachable, time_window_too_narrow]
            relaxSuggestions:
              type: array
              items:
                type: string
                enum: [widen_time_window, drop_must_movie, increase_margin_tolerance, remove_destination]

    Plan:
      type: object
      required: [label, stats, legs]
      properties:
        label:
          type: string
          enum: [most_movies, less_travel, relaxed, must_priority, alt]
        stats:
          type: object
          required: [movieCount, totalTravelMin, totalWaitMin, endTime]
          properties:
            movieCount: { type: integer }
            totalTravelMin: { type: integer }
            totalWaitMin: { type: integer }
            endTime: { type: string, format: date-time }
        legs:
          type: array
          items:
            oneOf:
              - $ref: "#/components/schemas/ScreeningLeg"
              - $ref: "#/components/schemas/TravelLeg"
              - $ref: "#/components/schemas/WaitLeg"
          discriminator:
            propertyName: kind

    ScreeningLeg:
      type: object
      required: [kind, theaterId, theaterName, movieId, movieTitle, startAt, endAt, officialUrl]
      properties:
        kind: { type: string, const: screening }
        theaterId: { type: string }
        theaterName: { type: string }
        movieId: { type: string }
        movieTitle: { type: string }
        format: { type: string, nullable: true }
        startAt: { type: string, format: date-time }
        endAt: { type: string, format: date-time }
        officialUrl: { type: string, format: uri }

    TravelLeg:
      type: object
      required: [kind, departAt, arriveAt, durationMin]
      properties:
        kind: { type: string, const: travel }
        fromTheaterId: { type: string, nullable: true }   # null = origin から
        toTheaterId: { type: string, nullable: true }     # null = destination へ
        departAt: { type: string, format: date-time }
        arriveAt: { type: string, format: date-time }
        durationMin: { type: integer }
        summary: { type: string, nullable: true, example: "梅田→なんば（御堂筋線）" }

    WaitLeg:
      type: object
      required: [kind, minutes]
      properties:
        kind: { type: string, const: wait }
        minutes: { type: integer }

    ApiError:
      type: object
      required: [code, message]
      properties:
        code: { type: string, example: "VALIDATION_ERROR" }
        message: { type: string }
        details: { type: object, additionalProperties: true }
```

## 設計メモ

1. **infeasible を 200 で返す理由**: 「案がない」はエラーではなく正常な算出結果であり、UI は relaxSuggestions を使って緩和 UI を出す（F-09）。
2. **共有は POST /plans で二段階**: `/plan` 結果はステートレス。ユーザーが共有ボタンを押した Plan だけを永続化する（不要な書込を避ける）。
3. **Googleカレンダー URL はクライアント生成**: `ScreeningLeg` の情報だけで `calendar.google.com/render?action=TEMPLATE` URL を組み立てられるため、専用エンドポイントは持たない。**結果画面の .ics も同様にクライアント生成**（`Plan` の legs だけで組み立てられ、共有前の Plan には ID が無いため）。`GET /plans/{planId}/ics` は**共有ページ用**（永続化済み Plan が対象。P5-1）。
4. **キャッシュ**: `GET /theaters` は `Cache-Control: max-age=3600`。`/movies` は `max-age=600`。`POST /plan` はキャッシュしない。
5. **エラーコード体系**: `VALIDATION_ERROR` / `DATA_NOT_READY`（422）/ `NOT_FOUND`（404。共有プランの不存在・期限切れ）/ `RATE_LIMITED`（429）/ `INTERNAL`（500）。
6. **CORS**: web は別オリジン（`api.<domain>` と web ドメイン / ローカルは :5173 と :8788）からブラウザ直接 fetch するため、`/v1/*` に CORS を許可する。MVP は認証なしの公開 API のため `Access-Control-Allow-Origin: *`（全許可）。認証・宛先制限を導入する際にオリジン許可リストへ切替える。
7. **origin/destination の station 解決**（P4-6・ADR-0014）: ①対応劇場の `nearest_station` 一致（`walk_min_from_sta`）→ ②不一致なら `station-geo`（KV 30日）経由のジオコーディングで座標化し直線距離推定 → ③それでも不明なら 400 VALIDATION_ERROR。ジオコーディングの外部呼出はキャッシュ未ヒットの初出駅名のみ。
8. **共有プランの運用防御（P5-1）**: `POST /plans` は zod（`Plan`）検証に加えて①リクエストボディ 64KB 上限（413）②`legs` 最大 50 件③`screening` の leg を最少1件含む（共有する意味のない空プランの排除）を検証する（②③違反は 400 VALIDATION_ERROR）。認証なし公開 API で D1 書込を伴うため、ゴミデータの大量投入をレート制限（60/min）と合わせて抑止する。id は `newId('pln')`（base58 12桁 ≒ 70bit・docs/spec/09 §2）で推測困難。
9. **共有プランの期限（F-13）**: `expires_at = 発行時刻 + 30日`（UTC ISO）。`GET /plans/{planId}`（/ics 含む）は読み取り時に期限を判定し、期限切れは不存在と同じ 404 NOT_FOUND を返す（存在の痕跡を返さない）。**物理削除は P5-5 のデータ保持 Cron**（docs/spec/03 §4）が行い、読み取り判定はそれに依存しない（Cron 停止中も 404 が保たれる）。
10. **共有 URL の組み立て**: `POST /plans` レスポンスの `url` は `{WEB_BASE_URL}/p/{planId}`。`WEB_BASE_URL` は api の環境 var（local=`http://localhost:5173` / st=web の workers.dev / prod=P5-7 のドメイン確定時に設定）。api 自身のオリジンからは導出しない（api と web は別オリジン。設計メモ6）。
11. **共有プランのキャッシュ**: `GET /plans/{planId}` と `/ics` は不変スナップショットのため `Cache-Control: public, max-age=300`。期限切れへの遷移が最大5分遅れて見えるのは許容（`expiresAt` は30日単位）。404 はキャッシュしない。
