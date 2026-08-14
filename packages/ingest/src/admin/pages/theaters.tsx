import type { TheaterRecord } from '@cinema/shared'
import type { RunRow } from '../../db/ingest-runs'
import { Flash, jst, StatusChip, TheaterStatusChip } from '../components'

// 劇場マスタ（docs/spec/07 §2.3）。新規は必ず paused 起票・active 昇格はサーバ側ゲート。

const TERMS_WARN_MS = 90 * 86_400_000 // docs/spec/08 §2

function termsCell(termsCheckedAt: string | null) {
  if (!termsCheckedAt) return <span class="warn-text">未確認</span>
  const expired = Date.now() - Date.parse(termsCheckedAt) > TERMS_WARN_MS
  return <span class={expired ? 'warn-text' : ''}>{termsCheckedAt.slice(0, 10)}</span>
}

export function TheaterListPage(props: {
  theaters: TheaterRecord[]
  lastRuns: Map<string, Pick<RunRow, 'status' | 'started_at'>>
  msg?: string
  err?: string
}) {
  return (
    <>
      <h1>劇場マスタ</h1>
      <Flash msg={props.msg} err={props.err} />
      <div class="actions">
        <a href="/admin/theaters/new">
          <button type="button">＋ 新規劇場（paused で起票）</button>
        </a>
      </div>
      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>name</th>
            <th>status</th>
            <th>fetch/extract</th>
            <th>直近取込</th>
            <th>terms_checked_at</th>
          </tr>
        </thead>
        <tbody>
          {props.theaters.map((t) => {
            const last = props.lastRuns.get(t.id)
            return (
              <tr>
                <td>
                  <a href={`/admin/theaters/${t.id}`}>{t.id}</a>
                </td>
                <td>{t.name}</td>
                <td>
                  <TheaterStatusChip status={t.status} />
                </td>
                <td>
                  {t.fetchMethod}/{t.extractMethod}
                  {t.fetchDayMode !== 'single' && (
                    <span class="small">
                      {' '}
                      {t.fetchDayMode}×{t.fetchDays === 0 ? '全' : t.fetchDays}
                    </span>
                  )}
                </td>
                <td>
                  {last ? (
                    <>
                      <StatusChip status={last.status} />{' '}
                      <span class="small">{jst(last.started_at)}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{termsCell(t.termsCheckedAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

function UpsertFields({ t }: { t?: TheaterRecord }) {
  return (
    <>
      <label for="f-name">name（正式名称）</label>
      <input id="f-name" type="text" name="name" required value={t?.name ?? ''} />
      <label for="f-shortName">shortName（表示用略称・任意）</label>
      <input id="f-shortName" type="text" name="shortName" value={t?.shortName ?? ''} />
      <label for="f-scheduleUrl">scheduleUrl（スケジュールページ）</label>
      <input
        id="f-scheduleUrl"
        type="url"
        name="scheduleUrl"
        required
        value={t?.scheduleUrl ?? ''}
      />
      <label for="f-officialUrl">officialUrl（公式トップ）</label>
      <input
        id="f-officialUrl"
        type="url"
        name="officialUrl"
        required
        value={t?.officialUrl ?? ''}
      />
      <label for="f-lat">lat / lng</label>
      <div style="display:flex; gap:8px; max-width:560px">
        <input
          id="f-lat"
          type="text"
          name="lat"
          required
          value={t ? String(t.lat) : ''}
          placeholder="34.6692"
        />
        <input
          type="text"
          name="lng"
          required
          value={t ? String(t.lng) : ''}
          placeholder="135.4781"
          aria-label="lng"
        />
      </div>
      <label for="f-nearestStation">nearestStation（最寄駅名）/ walkMinFromSta（徒歩分）</label>
      <div style="display:flex; gap:8px; max-width:560px">
        <input
          id="f-nearestStation"
          type="text"
          name="nearestStation"
          required
          value={t?.nearestStation ?? ''}
        />
        <input
          type="number"
          name="walkMinFromSta"
          required
          min="0"
          max="120"
          value={t ? String(t.walkMinFromSta) : '5'}
          aria-label="walkMinFromSta"
        />
      </div>
      <label for="f-fetchMethod">fetchMethod / extractMethod</label>
      <div style="display:flex; gap:8px; max-width:560px">
        <select id="f-fetchMethod" name="fetchMethod">
          <option value="static" selected={(t?.fetchMethod ?? 'static') === 'static'}>
            static
          </option>
          <option value="rendered" selected={t?.fetchMethod === 'rendered'}>
            rendered（P4-7）
          </option>
        </select>
        <select name="extractMethod" aria-label="extractMethod">
          <option value="vision" selected={(t?.extractMethod ?? 'vision') === 'vision'}>
            vision
          </option>
          <option value="text" selected={t?.extractMethod === 'text'}>
            text
          </option>
        </select>
      </div>
      <label for="f-fetchDayMode">
        fetchDayMode / fetchDays（複数日取得。ADR-0019・docs/spec/08 §3）
      </label>
      <div style="display:flex; gap:8px; max-width:560px">
        <select id="f-fetchDayMode" name="fetchDayMode">
          {(['single', 'tabs', 'url_template'] as const).map((v) => (
            <option value={v} selected={(t?.fetchDayMode ?? 'single') === v}>
              {v}
            </option>
          ))}
        </select>
        <input
          type="number"
          name="fetchDays"
          required
          min="0"
          max="10"
          value={t ? String(t.fetchDays) : '1'}
          aria-label="fetchDays"
        />
      </div>
      <p class="small">
        single=1ページ（既定）/ tabs=日付タブを順にクリック（fetchMethod=rendered 必須）/
        url_template=scheduleUrl の {'{date}'} を置換（fetchMethod=static）。fetchDays:
        0=検出タブ全件（tabs のみ）・上限10。1回の取込で最大 1+fetchDays 回先方へアクセスする
        （5秒間隔・直列）。
      </p>
      <label for="f-robotsStatus">
        robotsStatus（人間が robots.txt を確認して選ぶ。docs/guides/01 §2.2）
      </label>
      <select id="f-robotsStatus" name="robotsStatus">
        {(['unknown', 'allowed', 'disallowed'] as const).map((v) => (
          <option value={v} selected={(t?.robotsStatus ?? 'unknown') === v}>
            {v}
          </option>
        ))}
      </select>
      <label for="f-termsCheckedAt">termsCheckedAt（規約確認日。確認したら当日を入れる）</label>
      <input
        id="f-termsCheckedAt"
        type="date"
        name="termsCheckedAt"
        value={t?.termsCheckedAt?.slice(0, 10) ?? ''}
      />
      <label for="f-termsNote">termsNote（規約確認の要点メモ）</label>
      {/* textarea は子の空白が値になるため 1 行で書く */}
      {/* biome-ignore format: 上記理由 */}
      <textarea id="f-termsNote" name="termsNote">{t?.termsNote ?? ''}</textarea>
    </>
  )
}

export function TheaterNewPage({ err }: { err?: string }) {
  return (
    <>
      <h1>新規劇場（paused で起票）</h1>
      <Flash err={err} />
      <p class="small">
        採用プロセス（docs/spec/08 §2・docs/guides/01 §2.2）:
        robots/規約の確認は人間が行い、結果をここに記録する。 登録後は 手動取込 → レビュー全件目視 →
        3日連続 succeeded → active 昇格。
      </p>
      <form method="post" action="/admin/theaters">
        <UpsertFields />
        <div class="actions">
          <button type="submit">paused で登録</button>
        </div>
      </form>
    </>
  )
}

export function TheaterEditPage(props: {
  t: TheaterRecord
  recentRuns: Pick<RunRow, 'id' | 'status' | 'trigger' | 'started_at'>[]
  todayFetches: number
  isProd: boolean
  msg?: string
  err?: string
}) {
  const { t } = props
  const streak = (() => {
    let n = 0
    for (const r of props.recentRuns) {
      if (r.status === 'succeeded') n++
      else if (['queued', 'fetching', 'extracting'].includes(r.status)) continue
      else break
    }
    return n
  })()
  const robotsUrl = (() => {
    try {
      return `${new URL(t.scheduleUrl).origin}/robots.txt`
    } catch {
      return null
    }
  })()
  return (
    <>
      <h1>
        {t.name} <TheaterStatusChip status={t.status} />
      </h1>
      <Flash msg={props.msg} err={props.err} />

      <div class="grid2">
        <section>
          <h2>基本情報</h2>
          <form method="post" action={`/admin/theaters/${t.id}`}>
            <UpsertFields t={t} />
            <div class="actions">
              <button type="submit">保存</button>
              {robotsUrl && (
                <a href={robotsUrl} target="_blank" rel="noopener noreferrer">
                  <button type="button" class="secondary">
                    robots.txt を確認 ↗
                  </button>
                </a>
              )}
            </div>
          </form>
        </section>

        <section>
          <h2>ステータス変更</h2>
          <p class="small">
            active 昇格の条件: robots_status=allowed かつ terms_checked_at
            記入済み（サーバ側で強制。docs/spec/08 §0 ルール5）。3日連続 succeeded（現在{' '}
            <b>{streak}</b> 連続）を確認してから昇格すること（docs/spec/06 §9）。
          </p>
          <form method="post" action={`/admin/theaters/${t.id}/status`}>
            <select name="status">
              {(['paused', 'active', 'retired'] as const).map((v) => (
                <option value={v} selected={t.status === v}>
                  {v}
                </option>
              ))}
            </select>
            <div class="actions">
              <button type="submit">変更</button>
            </div>
          </form>

          <h2>手動取込（F-33）</h2>
          {props.isProd ? (
            <p class="small">prod は cron のみ（手動取込は無効。docs/spec/11 §3.2）。</p>
          ) : (
            <form method="post" action={`/admin/theaters/${t.id}/ingest`}>
              {t.fetchDayMode !== 'single' && (
                <p class="small">
                  この劇場は複数日取得（{t.fetchDayMode}）のため、1回の取込で最大{' '}
                  {1 + (t.fetchDays === 0 ? 10 : t.fetchDays)}{' '}
                  回先方サイトへアクセスします（5秒間隔・直列。docs/spec/08 §3・ADR-0019）。
                </p>
              )}
              {props.todayFetches > 0 && (
                <p class="small warn-text">
                  ⚠ 本日すでに {props.todayFetches}{' '}
                  回取得済み。同一サイト1日1セッション（docs/spec/08
                  §3）を破る2回目の取得は人間の明示判断が必要:
                  <br />
                  <label style="display:inline; font-weight:400">
                    <input type="checkbox" name="force" value="1" /> 2回目の取得を許可する
                  </label>
                </p>
              )}
              <div class="actions">
                <button type="submit">取込を実行（先方サイトへアクセス）</button>
              </div>
            </form>
          )}

          <h2>直近の取込</h2>
          <table>
            <thead>
              <tr>
                <th>開始(JST)</th>
                <th>trigger</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {props.recentRuns.map((r) => (
                <tr>
                  <td>
                    <a href={`/admin/runs/${r.id}`}>{jst(r.started_at)}</a>
                  </td>
                  <td>{r.trigger}</td>
                  <td>
                    <StatusChip status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  )
}
