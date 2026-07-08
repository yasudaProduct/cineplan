# ルート算出アルゴリズム設計

- Version: 0.1
- 対象: `POST /v1/plan` の内部ロジック（`packages/api/src/planner/`）
- 性質: 本サービスの心臓部。実装前に本ドキュメントの具体例（§8）をテストケースとして写経すること。

## 1. 問題定義

**時間制約付き・移動時間付きの区間スケジューリング問題**として定式化する。

- 入力: 対象日の Screening 集合 S、移動時間行列 T、利用可能時間帯 [Ws, We]、origin/destination、マスト集合 M（|M| ≤ 3）、到着マージン m。
- 出力: Screening の列 P = (s₁, s₂, ..., sₙ) で以下を満たすもの。

### 実行可能条件（すべて満たす）

```
(a) 開始条件 : depart(origin → theater(s₁)) ≥ Ws
               arrive(theater(s₁)) + 0 ≤ start(s₁) − m
(b) 連結条件 : ∀i: end(sᵢ) + travel(theater(sᵢ), theater(sᵢ₊₁)) + m ≤ start(sᵢ₊₁)
               ※ 同一劇場なら travel = 0、マージンは館内移動として m' = 10分（固定）を適用
(c) 終了条件 : destination 指定時、end(sₙ) + travel(theater(sₙ), destination) ≤ We
               destination 未指定時、end(sₙ) ≤ We
(d) 重複禁止 : ∀i≠j: movie(sᵢ) ≠ movie(sⱼ)
(e) マスト   : M ⊆ { movie(sᵢ) }
(f) 候補限定 : wishMovieIds 指定時、movie(sᵢ) ∈ wish ∪ M
```

### 目的関数（辞書式順序）

第1案（most_movies）の最適性基準:

```
1. 鑑賞本数 n を最大化
2. 同数なら 総移動時間 Σ travel を最小化
3. 同値なら 総待ち時間 Σ wait を最小化
4. 同値なら 終了時刻 end(sₙ) が早い方
5. なお同値なら screening id の辞書順（決定性の担保）
```

**タイブレークまで固定するのは、テストの再現性と「同じ入力には同じ出力」を保証するため。** 実装で乱数・Map の挿入順等に依存しないこと。

## 2. 前処理

1. D1 から対象日・active 劇場の Screening を全件ロード（想定 ≤ 1,500件）。
2. wish/must でフィルタ（f）。must 作品が S に1件も存在しなければ即 infeasible（reason: `must_movie_unreachable`）。
3. `[Ws − 最大移動時間, We]` の範囲外の Screening を除外。
4. origin/destination の解決:
   - `station` 指定 → 駅すぱあと API で各劇場の nearest_station への所要分を取得（劇場数 × 2 回。KV に 24h キャッシュ）。
   - `geo` 指定 → 最寄駅を解決してから同上。
5. start_at 昇順にソートし、配列 `scr[0..N-1]` とする。

## 3. コアアルゴリズム: マストビットマスク付き DP

|M| ≤ 3 なので、マスト達成状況を 3bit のビットマスクで状態に持つ。

### 状態定義

```
dp[i][mask] = 「最後に観た上映が scr[i] で、マスト達成状況が mask」のときの最良値
値 = (count, totalTravel, totalWait, endAt) を辞書式に比較
parent[i][mask] = 直前の (j, prevMask) 復元用ポインタ
```

### 遷移

```
初期化: 各 i について、origin から scr[i] に条件(a)で間に合うなら
        dp[i][maskOf(scr[i])] = (1, travelFromOrigin, waitAtFirst, end(scr[i]))

遷移:   i < j かつ end(scr[i]) + T[thr(i)][thr(j)] + margin ≤ start(scr[j])
        かつ movie(scr[j]) が経路上未出現* のとき
        dp[j][mask | maskOf(scr[j])] ← better(dp[j][...], extend(dp[i][mask], scr[j]))

解:     destination 条件(c)を満たす全 (i, mask=111...) のうち最良の dp 値
```

*「経路上未出現」の厳密判定は parent 鎖を遡る必要があり O(n) かかる。実用上は次の簡略化を採る:
**同一 movie の Screening は、DP 候補列挙時に「各 (movie, theater) につき時間帯が近い代表数回」に間引かず全件残すが、遷移時に movie の重複だけ Bloom 的に禁止するのではなく、状態に「観た movie 集合」は持たない。** 代わりに後述の k-best 列挙後に重複 movie を含む解を棄却する。これで解が失われるケース（同一作品を2回観る経路だけが最長）は実用上無視できるが、棄却後に案数が不足する場合は次善解を繰り上げる。この妥協は ADR に記録すること。

### 計算量

- 遷移は i < j の全ペア × mask 8通り = O(N² × 8)。N=1,500 で約 1,800万回の軽量比較。Workers の CPU 上限に対しては、対象を wish フィルタ後の実効 N（通常 ≤ 300）に抑えることで p95 1秒以内（N-01）を満たす。
- wish 未指定で N が 800 を超える場合は、劇場を origin/destination から移動 60分圏に限定するプルーニングを先に行う。

## 4. k-best 列挙

第1案だけでなく複数案（F-05）を出すため、DP を k-best 化する。

- `dp[i][mask]` に最良値 1 件ではなく **上位 k 件（k = maxResults × 3、既定 9）のリスト**を保持する（ビームサーチ相当。厳密 k-best でなくてよい）。
- 各リスト内は目的関数§1 の辞書式で保持し、`(count, theater 列, movie 集合)` が同一の重複エントリは弾く。
- 最終解集合から §6 のラベリングで代表案を選抜する。

## 5. 移動時間の解決

```
travel(A, B) =
  A == B                    → 0（マージンは館内 10分固定）
  A, B ともに劇場           → TravelMatrix[A][B]（KV、事前計算）
  A = origin / B = destination → リクエスト時に解決した値（§2-4）
```

- TravelMatrix 欠損ペア（新劇場追加直後など）は「直線距離 ÷ 20km/h + 15分」のフォールバック推定を使い、Plan の該当 TravelLeg に `summary: "推定値"` を付ける。
- 深夜時間帯（終電）は MVP では考慮しない。ただし end が 23:00 を超える Plan には UI 側で「終電にご注意」を表示する（API は `stats.endTime` を返すのみ）。

## 6. 代替案のラベリング

k-best の解プールから、以下の規則で最大 maxResults 件を選抜する。

| 順序 | ラベル | 選抜規則 |
|---|---|---|
| 1 | `most_movies` | 目的関数§1 の最良解 |
| 2 | `less_travel` | 本数が最良解 −0〜1 の中で 総移動時間最小。1と同一 Plan なら省略 |
| 3 | `relaxed` | 本数が最良解 −1 以内の中で 総待ち時間が最大 30分/本 以内かつ最小終了時刻。「各作品の間に余裕がある」案 |
| 4 | `must_priority` | must 指定があるとき、must 作品を最も早い時間帯に配置する解。must 未指定なら出さない |
| 5 | `alt` | 上記と theater 列 or movie 集合 が異なる次善解 |

- 選抜済み Plan と「movie 集合と theater 列が完全一致」する解は重複としてスキップする。
- プールが枯れて maxResults に満たない場合は、あるだけ返す（パディングしない）。

## 7. infeasible 判定と緩和提案

| 状況 | reason | relaxSuggestions |
|---|---|---|
| 対象日 Screening 0件 | `no_screenings` | —（422 DATA_NOT_READY と区別: データ未取込は 422、取込済みで0件はこちら） |
| must 作品が候補に不在/どの経路にも組込不能 | `must_movie_unreachable` | `drop_must_movie`, `widen_time_window` |
| 1本も観られない | `time_window_too_narrow` | `widen_time_window`, `remove_destination` |

判定順は上から。「1本は観られるが must を含められない」は `must_movie_unreachable`。

## 8. 具体例（実装時の必須テストケース）

劇場: A, B（T[A][B] = T[B][A] = 20分）。margin = 15分。origin→A = 10分, origin→B = 30分。Ws=10:00, We=19:00, destination なし。

| id | 劇場 | 作品 | 開始 | 終了 |
|---|---|---|---|---|
| s1 | A | 作品X | 10:30 | 12:30 |
| s2 | A | 作品Y | 12:50 | 14:30 |
| s3 | B | 作品Z | 13:30 | 15:30 |
| s4 | B | 作品Y | 15:10 | 16:50 |
| s5 | B | 作品W | 16:00 | 18:00 |

**期待値は検算済み・確定**（待ち時間等の定義は `12_dp-implementation.md` §4 を正とする）。

- **most_movies = s1 > s3 > s5（作品 X, Z, W）: 3本 / 総移動30分 / 総待ち45分 / 終了18:00**
  - 連結検証: s1終 12:30 + 20(A→B) + 15(margin) = 13:05 ≤ 13:30 で s3 可。s3終 15:30 + 0 + 10(館内) = 15:40 ≤ 16:00 で s5 可。
  - 待ち内訳: s3 の待ち = 13:30 − 13:05 = 25分、s5 の待ち = 16:00 − 15:40 = 20分。計45分。初手の待ちは0（最遅出発）。
- 3本解はもう1つ存在: s1 > s2 > s5（X, Y, W）= 移動30分 / 待ち65分 / 終了18:00。
  - タイブレーク: 本数3で同値 → 移動30で同値 → **待ち 45 < 65 で s1>s3>s5 が優先**。この比較が効くことをテストで固定する。
- 全実行可能解（参考・目的関数順）: s1>s3>s5(3本) → s1>s2>s5(3本) → s1>s2(2本,移動10,待ち10) → s3>s5(2本,移動30,待ち20) → s1>s3(2本) → …
- must = {作品Z} の場合: Z を含む解のみ有効（s1>s3>s5 / s3>s5 / s1>s3 / s3 単体）。most_movies は変わらず s1>s3>s5。
- Ws = 13:00 の場合: **最大1本**。初手可否（最遅出発 = start − margin − originTo が Ws 以降か）を全上映で確認すると、s4（14:25）と s5（15:15）のみ可で、s3 は 12:45 < 13:00 で間に合わない。s4→s5 は s4終 16:50 > s5開始 16:00 で連結不可。
- Ws = 12:30 の場合: s3 に間に合い（最遅出発12:45 ≥ 12:30）、**s3 > s5 の2本**が最良。

（本期待値と実装が食い違ったら、まず定義（12 §4）と本表の手計算を再確認し、それでも仕様側が誤りなら本ドキュメントを先に直す。）

## 9. 非採用とした代替案（記録）

- **巡回セールスマン/MIP ソルバ**: 上映開始時刻が離散固定なので DP で十分。外部ソルバは Workers で動かせずオーバーキル。
- **リクエスト毎の経路検索 API 呼出**: コスト・レイテンシとも不成立。事前計算行列で代替（ADR 参照）。
- **同一作品の重複を DP 状態で厳密管理**: 状態爆発（movie 集合 2^N）。§3 の棄却方式で妥協。
