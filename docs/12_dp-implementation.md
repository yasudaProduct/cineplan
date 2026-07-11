# ルート算出 DP 実装詳細 — 参照実装とテスト

- Version: 0.1
- 親ドキュメント: `05_routing-algorithm.md`（定式化）。本書はその実装レベル詳細。
- 対象: `packages/api/src/planner/`
- **本書の §7 テストケースの期待値は手計算で検証済み。実装はこの期待値に一致させる。**

## 1. モジュール構成

```
packages/api/src/planner/
  types.ts        # 内部型（Candidate, State, PlanInternal 等）
  travel.ts       # 移動時間解決（KV行列 + origin/dest動的）
  dp.ts           # ビットマスクDP本体
  kbest.ts        # k-best列挙とラベリング
  build.ts        # State → API Plan(legs) 変換
  index.ts        # plan(request) エントリ
  __tests__/
    dp.spec.ts        # §7 の期待値テスト（最重要）
    travel.spec.ts
    build.spec.ts
```

## 2. 内部型

```ts
// 分単位・UTCエポック分で内部計算（ISO変換は build.ts のみ）
export interface Candidate {
  screeningId: string;
  theaterId: string;
  movieId: string;
  startMin: number;      // UTCエポック分
  endMin: number;
  format: string | null;
  detailUrl: string | null;
  movieTitle: string;
  theaterName: string;
  officialUrl: string;
}

// DP値。目的関数の比較キーそのもの。
export interface Score {
  count: number;         // 鑑賞本数（多いほど良い）
  travel: number;        // 総移動分（少ないほど良い）
  wait: number;          // 総待ち分（少ないほど良い）
  endMin: number;        // 終了時刻（早いほど良い）
  lastId: string;        // タイブレーク最終手段（辞書順）
}

// DPエントリ（k-best保持のため配列で持つ）
export interface Entry {
  score: Score;
  path: number[];        // candidate index の列
  mask: number;          // マスト達成ビットマスク
}

export interface PlanContext {
  cands: Candidate[];              // startMin昇順ソート済み
  mustMovieIds: string[];          // index順がビット位置
  arrivalMarginMin: number;        // 劇場間マージン
  windowStartMin: number;
  windowEndMin: number;
  travel: TravelResolver;          // travel.ts
  originToTheaterMin: Map<string, number>;   // 劇場ID→origin所要分
  theaterToDestMin: Map<string, number> | null; // dest指定時のみ
}
```

## 3. 目的関数の比較（決定性の要）

`05 §1` の辞書式順序を関数化する。**この関数がすべての最適性判断の単一の基準。** 乱数・Mapイテレーション順に依存しない。

```ts
// a が b より良ければ負、悪ければ正、同値0
export function compareScore(a: Score, b: Score): number {
  if (a.count !== b.count) return b.count - a.count;    // 本数: 多い方が良い
  if (a.travel !== b.travel) return a.travel - b.travel; // 移動: 少ない方が良い
  if (a.wait !== b.wait) return a.wait - b.wait;         // 待ち: 少ない方が良い
  if (a.endMin !== b.endMin) return a.endMin - b.endMin; // 終了: 早い方が良い
  return a.lastId < b.lastId ? -1 : a.lastId > b.lastId ? 1 : 0; // id辞書順
}
export const isBetter = (a: Score, b: Score) => compareScore(a, b) < 0;
```

## 4. 待ち時間・移動時間の定義（実装で固定）

`05 §8` の期待値を再現するための厳密な定義。テストの数値はこれに基づく。

### 移動時間（travel）
- 総移動 = `origin→first劇場` + 各区間 `travel(劇場i, 劇場i+1)`。
- destination 指定時も、DP の score.travel には **dest への移動を含めない**（終了条件の判定にのみ使う）。含めると「dest が遠い経路」が本数最大解より不利になり比較軸が濁るため。dest 移動は build 時に travel leg として付与する。

### 待ち時間（wait）
- 各上映 i(≥2本目) について:
  `earliestReady_i = end_{i-1} + travel(劇場_{i-1}, 劇場_i) + margin_i`
  （margin_i は同一劇場なら館内マージン `m_in=10`、別劇場なら `arrivalMarginMin`）
  `wait_i = start_i − earliestReady_i`（連結条件により ≥ 0）
- 初手の待ちは 0（origin から最遅出発すれば待たずに済むため、初手 wait は常に0とする）。
- 総待ち = Σ wait_i。

### マージンの扱い（重要）
- 同一劇場内の連続鑑賞: `m_in = 10分`（固定。館内移動・清掃時間の想定）。
- 別劇場: `arrivalMarginMin`（ユーザー指定、デフォルト15、範囲5〜60）。
- 初手の開始可否: `(start_first − arrivalMarginMin) − originToTheater ≥ windowStart`。
  ※ 初手も到着マージンは `arrivalMarginMin` を使う（origin からの初回訪問のため）。

## 5. DP 本体（dp.ts）

```ts
const M_IN = 10;                    // 同一劇場内マージン（定数）
const K_KEEP = 9;                   // 各状態で保持する上位件数（maxResults*3）

export function runDp(ctx: PlanContext): Entry[] {
  const n = ctx.cands.length;
  const fullMask = (1 << ctx.mustMovieIds.length) - 1;  // must全達成
  const maskOf = (movieId: string): number => {
    const i = ctx.mustMovieIds.indexOf(movieId);
    return i >= 0 ? (1 << i) : 0;
  };

  // dp[i] = その i を最後に観る Entry のリスト（mask別に混在、compareScoreで上位K保持）
  const dp: Entry[][] = Array.from({ length: n }, () => []);

  // 初期化: origin から間に合う各 i
  for (let i = 0; i < n; i++) {
    const c = ctx.cands[i];
    const oto = ctx.originToTheaterMin.get(c.theaterId);
    if (oto === undefined) continue;                 // 到達不能劇場
    const latestDepart = (c.startMin - ctx.arrivalMarginMin) - oto;
    if (latestDepart < ctx.windowStartMin) continue; // 初手に間に合わない
    dp[i].push({
      score: { count: 1, travel: oto, wait: 0, endMin: c.endMin, lastId: c.screeningId },
      path: [i],
      mask: maskOf(c.movieId),
    });
  }

  // 遷移: i < j（startMin昇順なので i<j で時系列前後が保証される）
  for (let i = 0; i < n; i++) {
    if (dp[i].length === 0) continue;
    const ci = ctx.cands[i];
    for (let j = i + 1; j < n; j++) {
      const cj = ctx.cands[j];
      const m = ci.theaterId === cj.theaterId ? M_IN : ctx.arrivalMarginMin;
      const tv = ctx.travel.between(ci.theaterId, cj.theaterId);
      const earliestReady = ci.endMin + tv + m;
      if (earliestReady > cj.startMin) continue;      // 連結不可

      for (const e of dp[i]) {
        // 作品重複は k-best 段階で棄却（05 §3 の妥協）→ ここでは通す
        // ただし同一作品の即時重複だけは明らかに無駄なので早期スキップ
        if (ci.movieId === cj.movieId) continue;
        const waitJ = cj.startMin - earliestReady;
        const next: Entry = {
          score: {
            count: e.score.count + 1,
            travel: e.score.travel + tv,
            wait: e.score.wait + waitJ,
            endMin: cj.endMin,
            lastId: cj.screeningId,
          },
          path: [...e.path, j],
          mask: e.mask | maskOf(cj.movieId),
        };
        insertTopK(dp[j], next, K_KEEP);
      }
    }
  }

  // 解の収集: destination条件を満たし、must全達成(mask==fullMask)の Entry
  const solutions: Entry[] = [];
  for (let i = 0; i < n; i++) {
    for (const e of dp[i]) {
      if (e.mask !== fullMask) continue;              // must未達は除外
      const last = ctx.cands[i];
      if (ctx.theaterToDestMin) {
        const td = ctx.theaterToDestMin.get(last.theaterId);
        if (td === undefined) continue;
        if (last.endMin + td > ctx.windowEndMin) continue;
      } else {
        if (last.endMin > ctx.windowEndMin) continue;
      }
      solutions.push(e);
    }
  }
  return solutions;
}

// compareScore順に上位K件を保持（重複pathは入れない）
function insertTopK(list: Entry[], e: Entry, k: number): void {
  // 同一(movie集合, theater列)の重複を避ける簡易キー
  const key = e.path.join(',');
  if (list.some(x => x.path.join(',') === key)) return;
  list.push(e);
  list.sort((a, b) => compareScore(a.score, b.score));
  if (list.length > k) list.length = k;
}
```

### 計算量メモ
- 遷移は O(n²) ペア × dp[i] の保持件数 K。実効 n はフィルタ後 ≤ 300 想定、K=9 で軽量。
- n が 800 を超える場合は index.ts で移動圏プルーニング（origin/dest から 60分超の劇場を除外）を先に適用。

## 6. k-best とラベリング（kbest.ts）

```ts
export function selectPlans(solutions: Entry[], maxResults: number): LabeledPlan[] {
  if (solutions.length === 0) return [];
  const sorted = [...solutions].sort((a, b) => compareScore(a.score, b.score));
  // 作品重複を含む解をここで棄却（05 §3 の妥協）
  const valid = sorted.filter(e => !hasDupMovie(e));
  if (valid.length === 0) return [];

  const best = valid[0];
  const picked: LabeledPlan[] = [{ label: 'most_movies', entry: best }];
  const seen = new Set([sig(best)]);

  const pick = (label: PlanLabel, pred: (e: Entry) => boolean, cmp: (a:Entry,b:Entry)=>number) => {
    const cand = valid.filter(e => !seen.has(sig(e)) && pred(e)).sort(cmp);
    if (cand[0]) { picked.push({ label, entry: cand[0] }); seen.add(sig(cand[0])); }
  };

  // less_travel: 本数 best-1以内 で総移動最小
  pick('less_travel',
    e => e.score.count >= best.score.count - 1,
    (a,b) => a.score.travel - b.score.travel || compareScore(a.score,b.score));

  // relaxed: 本数 best-1以内 かつ 1本あたり待ち≤30分 で終了最早
  pick('relaxed',
    e => e.score.count >= best.score.count - 1
      && e.score.wait <= 30 * e.score.count,
    (a,b) => a.score.endMin - b.score.endMin || compareScore(a.score,b.score));

  // must_priority: must指定時、must作品が最も早い時間帯に入る解（fullMask前提で全解が満たすため
  //   「最初のmust作品のstartMinが最小」で選抜）。must未指定なら出さない。
  // （呼び出し側で must.length>0 のときのみ pick する）

  return picked.slice(0, maxResults);
}

function hasDupMovie(e: Entry): boolean {
  // path から movieId 列を復元して重複判定（呼び出し側で cands を bind）
  // 実装では Entry に movieIds を持たせるか、クロージャで cands 参照
  ...
}
const sig = (e: Entry) => e.path.join('>');   // theater列/movie集合の同一性近似
```

- **重複 movie の棄却で解が枯れた場合**: valid が maxResults に満たなくても、あるだけ返す（パディングしない）。most_movies すら重複を含み棄却されるケースは、次善（本数−1）の valid 解を most_movies に繰り上げる。この挙動は ADR-0006 に記録済み。

## 7. テストケース（dp.spec.ts）— 期待値は検証済み

`05 §8` の具体例。**以下の数値は手計算で確定済み。実装をこれに合わせる。**

### セットアップ
```
劇場A, B。travel(A,B)=travel(B,A)=20分、同一劇場=0分。
m_in=10分、arrivalMargin=15分。
origin→A=10分、origin→B=30分。destination なし。
windowStart=10:00、windowEnd=19:00。

上映:
  s1: A / 作品X / 10:30-12:30
  s2: A / 作品Y / 12:50-14:30
  s3: B / 作品Z / 13:30-15:30
  s4: B / 作品Y / 15:10-16:50
  s5: B / 作品W / 16:00-18:00
```

### 期待値（確定）

**most_movies（最適解）:**
```
ルート: s1 > s3 > s5   （作品 X, Z, W）
本数: 3
総移動: 30分   （origin→A=10 + A→B=20 + B→B=0）
総待ち: 45分
終了: 18:00
```

総待ち45分の内訳（検算）:
- s3 の待ち: earliestReady = 12:30(s1終) + 20(A→B) + 15(margin) = 13:05。start 13:30 → 待ち25分。
- s5 の待ち: earliestReady = 15:30(s3終) + 0(B→B) + 10(m_in) = 15:40。start 16:00 → 待ち20分。
- 合計 45分。

**3本解は2つ存在し、タイブレークで s1>s3>s5 が選ばれる:**
```
s1>s3>s5 : 移動30 待ち45 終了18:00 （X,Z,W） ← most_movies
s1>s2>s5 : 移動30 待ち65 終了18:00 （X,Y,W）
```
本数3で同値 → 移動30で同値 → 待ち45 < 65 で s1>s3>s5 が優先。**この比較が正しく効くことをテストで固定する。**

**代替案ラベリング（maxResults=3）:**
```
most_movies : s1>s3>s5  (3本, 移動30, 待ち45)
less_travel : （本数3以内で移動最小）候補は上記2つとも移動30。
              most_movies と同一のため、次に移動が小さい2本解 s1>s2(移動10) が該当。
              → s1>s2 (2本, 移動10, 待ち10)
relaxed     : 本数2以上 かつ 待ち≤30*count。s1>s2(待ち10≤60) 終了14:30 が最早終了。
              ただし less_travel と同一(s1>s2)なら seen で除外され、次点を探す。
              → seen 除外後の候補で終了最早を選ぶ（実装挙動をテストで固定）。
```
※ less_travel と relaxed が同じ解を指す場合の重複除外挙動は、実装で確定させテストに明記する。上表は「除外が効いて異なる解が選ばれる」ことを確認するケース。

**must={作品Z} の場合:**
```
有効解は Z を含むもののみ:
  s1>s3>s5 (X,Z,W) 3本 ← most_movies
  s3>s5    (Z,W)   2本
  s1>s3    (X,Z)   2本
most_movies = s1>s3>s5。
```

**windowStart=13:00 の場合（★05の旧記述を修正）:**
```
初手可否（latestDepart = start - margin - originTo ≥ 13:00 か）:
  s1: (10:30-15)-10 = 10:05  < 13:00 ✗
  s2: (12:50-15)-10 = 12:25  < 13:00 ✗
  s3: (13:30-15)-30 = 12:45  < 13:00 ✗   ← s3も初手にできない
  s4: (15:10-15)-30 = 14:25  ≥ 13:00 ✓
  s5: (16:00-15)-30 = 15:15  ≥ 13:00 ✓
初手になれるのは s4, s5 のみ。両者とも後続なし（s4→s5 は作品Y/Wだが
  s4終16:50 + 0 + 10 = 17:00 > s5開始16:00 で時系列逆、不可）。
→ 最大 1本。
```
**注意**: これは `05_routing-algorithm.md` の旧 §8 にあった「最大2本」という記述の誤りを修正したもの。windowStart=13:00 では s3 に間に合わず、正しくは **最大1本**。（2本にするには windowStart≤12:30 が必要で、その場合 s3>s5 の2本が成立する。）

### テストコード骨子
```ts
describe('planner DP - 05 §8 の具体例', () => {
  const base = makeContext({ /* 上記セットアップ */ });

  it('most_movies は s1>s3>s5、本数3・移動30・待ち45・終了18:00', () => {
    const sols = runDp(base);
    const best = selectPlans(sols, 3)[0];
    expect(best.entry.path.map(i => base.cands[i].screeningId))
      .toEqual(['s1','s3','s5']);
    expect(best.entry.score).toMatchObject({ count:3, travel:30, wait:45 });
    expect(best.entry.score.endMin).toBe(min('18:00'));
  });

  it('3本解のタイブレーク: 待ち時間で s1>s3>s5 が s1>s2>s5 に優先', () => {
    const sols = runDp(base).filter(e => e.score.count === 3);
    const sorted = [...sols].sort((a,b) => compareScore(a.score,b.score));
    expect(ids(sorted[0])).toEqual(['s1','s3','s5']);
    expect(sorted[0].score.wait).toBe(45);
    expect(sorted[1].score.wait).toBe(65);
  });

  it('must=Z: most_movies は s1>s3>s5', () => {
    const ctx = { ...base, mustMovieIds: [movieIdOf('Z')] };
    const best = selectPlans(runDp(ctx), 3)[0];
    expect(ids(best.entry)).toEqual(['s1','s3','s5']);
  });

  it('windowStart=13:00 では最大1本（旧仕様の2本は誤り）', () => {
    const ctx = { ...base, windowStartMin: min('13:00') };
    const sols = runDp(ctx);
    const maxCount = Math.max(0, ...sols.map(e => e.score.count));
    expect(maxCount).toBe(1);
  });

  it('windowStart=12:30 では s3>s5 の2本が成立', () => {
    const ctx = { ...base, windowStartMin: min('12:30') };
    const best = selectPlans(runDp(ctx), 3)[0];
    expect(best.entry.score.count).toBe(2);
  });
});
```

## 8. infeasible 判定（index.ts）

```ts
export async function plan(db, kv, req): Promise<PlanResponse> {
  const businessDate = req.date;
  // 1. データ未取込 → 422（DBアクセス層 5.4）
  await assertDataReady(db, businessDate);

  const ctx = await buildContext(db, kv, req);   // 候補ロード・travel解決

  // 2. 対象日の上映が0件（取込済みだが上映なし）
  //    ※ 判定は wish・時間帯フィルタ「前」のロード結果で行う（05 §7 の区別。
  //      フィルタ後に0件になったケースは time_window_too_narrow 側 = 「時間帯を広げれば観られる」）
  if (ctx.loadedCount === 0) {
    return { plans: [], infeasible: { reason: 'no_screenings', relaxSuggestions: [] } };
  }
  // 3. must作品が候補に存在しない
  if (req.mustMovieIds.some(id => !ctx.cands.some(c => c.movieId === id))) {
    return { plans: [], infeasible: {
      reason: 'must_movie_unreachable',
      relaxSuggestions: ['drop_must_movie','widen_time_window'] } };
  }

  const solutions = runDp(ctx);

  // 4. must達成解が0（mustは候補にあるが経路に組み込めない）
  if (req.mustMovieIds.length > 0 && solutions.length === 0) {
    return { plans: [], infeasible: {
      reason: 'must_movie_unreachable',
      relaxSuggestions: ['drop_must_movie','widen_time_window','increase_margin_tolerance'] } };
  }
  // 5. 1本も観られない（must無し・解0）
  if (solutions.length === 0) {
    return { plans: [], infeasible: {
      reason: 'time_window_too_narrow',
      relaxSuggestions: ['widen_time_window','remove_destination'] } };
  }

  const labeled = selectPlans(solutions, req.maxResults);
  // mustあり時のみ must_priority を追加検討（selectPlans内 or ここ）
  return { plans: labeled.map(lp => buildPlan(lp, ctx)) };
}
```

判定順は `05 §7` 準拠。「1本は観られるが must を含められない」は `must_movie_unreachable`（解0だが must>0）。

## 9. State → API Plan 変換（build.ts）

DP の path（candidate index 列）を `04_api-spec.md` の legs 配列に変換する。

```
各 Plan の legs 構築:
1. travel leg: origin → cands[path[0]] の劇場（durationMin = originToTheater）
2. path を順に:
   - screening leg: cands[path[k]]（startAt/endAt を ISO変換, officialUrl は detail_url ?? theater.official_url）
   - 次があれば:
       travel leg（同一劇場なら durationMin=0 だが leg は出す or 省略。UIは0分travelを表示しない方針なら省略）
       wait leg（wait_k > 0 のときのみ）
3. destination 指定時: 最後の劇場 → destination の travel leg
stats: { movieCount, totalTravelMin, totalWaitMin, endTime(ISO) }
```

- 内部の分（UTCエポック分）→ ISO 文字列変換はこの層だけで行う（DP は分で計算）。
- `summary`（"梅田→なんば（御堂筋線）"）は KV の travelMatrix.summaries から引く。無ければ null。

## 10. 実装上の注意（まとめ）

1. **compareScore が唯一の比較基準**。ソート・最良判定はすべてこれ経由。独自比較を書かない。
2. **DP は分単位・UTCエポック分で計算**。ISO 変換は build.ts のみ。境界バグを避ける。
3. **作品重複は k-best 後に棄却**（ADR-0006 の妥協）。DP 遷移では「同一作品への即時遷移」だけ早期スキップ。
4. **§7 の期待値は動かさない**。実装が合わないときは実装を直す。仕様変更が必要なら本書と 05 を先に直す。
5. **待ち時間・マージンの定義（§4）を厳守**。ここがズレると全期待値が崩れる。
