import type { TheaterRecord } from '@cinema/shared'
import type { ScreeningDateCount, ScreeningListRow } from '../../db/screenings'
import { jst } from '../components'

// 上映データ（抽出検証・ADR-0015。docs/spec/07 §2.6）。取込済み screenings を公式サイトと
// 目視突合するための内部表示。利用者向け機能ではない（docs/spec/08 §1 原則1 注記）。
// SSR 画面のみ・エクスポート/共有機能を付けない。

export function ScreeningsPage(props: {
  theaters: TheaterRecord[]
  theater?: TheaterRecord
  dates: ScreeningDateCount[]
  date: string | null
  rows: ScreeningListRow[]
}) {
  const t = props.theater
  return (
    <>
      <h1>上映データ（抽出検証）</h1>
      <p class="small">
        抽出品質の検証・障害調査のための内部表示です（ADR-0015）。利用者向けに公開しない・
        スケジュール閲覧用途に常用しない。上映情報の最終確認は各劇場の公式サイトで。
      </p>

      <form method="get" action="/admin/screenings" class="actions">
        <select name="theaterId" style="max-width:320px">
          {props.theaters.map((v) => (
            <option value={v.id} selected={v.id === t?.id}>
              {v.name}（{v.status}）
            </option>
          ))}
        </select>
        <button type="submit" class="secondary">
          表示
        </button>
        {t && (
          <>
            <a href={t.scheduleUrl} target="_blank" rel="noopener noreferrer">
              公式スケジュールと突合 ↗
            </a>
            <a href={`/admin/theaters/${t.id}`} class="small">
              劇場編集 →
            </a>
          </>
        )}
      </form>

      {!t ? (
        <p class="small">劇場が未登録です。</p>
      ) : props.dates.length === 0 ? (
        <p class="small">この劇場の screenings はありません。</p>
      ) : (
        <>
          <div class="actions">
            {props.dates.map((d) => (
              <a href={`/admin/screenings?theaterId=${t.id}&date=${d.business_date}`}>
                {d.business_date === props.date ? <b>{d.business_date}</b> : d.business_date}{' '}
                <span class="small">({d.count})</span>
              </a>
            ))}
          </div>

          {props.rows.length === 0 ? (
            <p class="small">{props.date} の screenings はありません。</p>
          ) : (
            <>
              <p class="small">
                {props.date} / {props.rows.length} 件（時刻は JST 表示）
              </p>
              <table>
                <thead>
                  <tr>
                    <th>開始</th>
                    <th>終了</th>
                    <th>作品</th>
                    <th>形式</th>
                    <th>スクリーン</th>
                    <th>公式</th>
                    <th>取込 run / 取得日時</th>
                  </tr>
                </thead>
                <tbody>
                  {props.rows.map((r) => (
                    <tr>
                      <td>{jst(r.start_at)}</td>
                      <td>
                        {jst(r.end_at)}{' '}
                        {r.end_at_source === 'estimated' && <span class="chip warn">推定</span>}
                      </td>
                      <td>
                        {r.movie_title}
                        {r.runtime_min != null && <span class="small">（{r.runtime_min}分）</span>}
                      </td>
                      <td>{r.format ?? '—'}</td>
                      <td>{r.screen_name || '—'}</td>
                      <td>
                        {r.detail_url ? (
                          <a href={r.detail_url} target="_blank" rel="noopener noreferrer">
                            ↗
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <a href={`/admin/runs/${r.ingest_run_id}`} class="small">
                          {r.ingest_run_id}
                        </a>
                        <br />
                        <span class="small">{jst(r.created_at)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </>
  )
}
