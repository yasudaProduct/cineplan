import type { TheaterRecord } from '@cinema/shared'
import type { RunRow } from '../../db/ingest-runs'
import { Flash, jst, StatusChip } from '../components'

// 取込履歴（docs/07 §2.4）。一覧 + 詳細 + R2 再抽出（F-21・先方再取得なし）。

const STATUSES = [
  'succeeded',
  'validation_failed',
  'fetch_failed',
  'extraction_failed',
  'queued',
  'fetching',
  'extracting',
]

function durationSec(r: RunRow): string {
  if (!r.finished_at) return '—'
  return `${Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000)}s`
}

export function RunListPage(props: {
  runs: RunRow[]
  theaters: TheaterRecord[]
  filter: { theaterId?: string; status?: string; page: number }
  msg?: string
  err?: string
}) {
  const { filter } = props
  const qs = (page: number) => {
    const p = new URLSearchParams()
    if (filter.theaterId) p.set('theaterId', filter.theaterId)
    if (filter.status) p.set('status', filter.status)
    if (page > 1) p.set('page', String(page))
    const s = p.toString()
    return s ? `?${s}` : ''
  }
  const nameOf = new Map(props.theaters.map((t) => [t.id, t.shortName ?? t.name]))
  return (
    <>
      <h1>取込履歴</h1>
      <Flash msg={props.msg} err={props.err} />
      <form method="get" action="/admin/runs" class="actions">
        <select name="theaterId">
          <option value="">（全劇場）</option>
          {props.theaters.map((t) => (
            <option value={t.id} selected={filter.theaterId === t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select name="status">
          <option value="">（全 status）</option>
          {STATUSES.map((s) => (
            <option value={s} selected={filter.status === s}>
              {s}
            </option>
          ))}
        </select>
        <button type="submit" class="secondary">
          絞り込む
        </button>
      </form>
      <table>
        <thead>
          <tr>
            <th>開始(JST)</th>
            <th>劇場</th>
            <th>trigger</th>
            <th>status</th>
            <th>抽出/書込</th>
            <th>tokens(in/out)</th>
            <th>所要</th>
          </tr>
        </thead>
        <tbody>
          {props.runs.map((r) => (
            <tr>
              <td>
                <a href={`/admin/runs/${r.id}`}>{jst(r.started_at)}</a>
              </td>
              <td>{nameOf.get(r.theater_id) ?? r.theater_id}</td>
              <td>{r.trigger}</td>
              <td>
                <StatusChip status={r.status} />
              </td>
              <td>
                {r.extracted_count ?? '—'}/{r.written_count ?? '—'}
              </td>
              <td>
                {r.llm_in_tokens ?? '—'}/{r.llm_out_tokens ?? '—'}
              </td>
              <td>{durationSec(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="actions">
        {filter.page > 1 && <a href={qs(filter.page - 1)}>← 前の50件</a>}
        {props.runs.length === 50 && <a href={qs(filter.page + 1)}>次の50件 →</a>}
      </div>
    </>
  )
}

export function RunDetailPage(props: {
  run: RunRow
  theaterName: string
  snapshotKeys: string[]
  msg?: string
  err?: string
}) {
  const r = props.run
  const rows: [string, unknown][] = [
    ['id', r.id],
    ['劇場', `${props.theaterName}（${r.theater_id}）`],
    ['business_date', r.business_date],
    ['trigger / status', `${r.trigger} / ${r.status}`],
    ['開始〜終了(JST)', `${jst(r.started_at)} 〜 ${jst(r.finished_at)}`],
    ['抽出/書込件数', `${r.extracted_count ?? '—'} / ${r.written_count ?? '—'}`],
    [
      'LLM',
      `${r.llm_model ?? '—'}（in ${r.llm_in_tokens ?? '—'} / out ${r.llm_out_tokens ?? '—'}）`,
    ],
    ['prompt_version', r.prompt_version ?? '—'],
    ['snapshot_key', r.snapshot_key ?? '—'],
    ['error_message', r.error_message ?? '—'],
  ]
  return (
    <>
      <h1>
        取込詳細 <StatusChip status={r.status} />
      </h1>
      <Flash msg={props.msg} err={props.err} />
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr>
              <th style="width:180px">{k}</th>
              <td>{String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>R2 スナップショット</h2>
      {props.snapshotKeys.length === 0 ? (
        <p class="small">スナップショットはありません。</p>
      ) : (
        <ul>
          {props.snapshotKeys.map((k) => (
            <li>
              <a href={`/admin/r2/${k}`} target="_blank" rel="noopener noreferrer">
                {k}
              </a>
            </li>
          ))}
        </ul>
      )}

      <h2>再抽出（F-21）</h2>
      <p class="small">
        保存済みスナップショットを入力に、最新プロンプトで抽出をやり直す。
        <b>先方サイトへの再取得は行わない</b>
        （docs/08 §3）。結果は新しい run（trigger=retry）として記録される。
      </p>
      <form method="post" action={`/admin/runs/${r.id}/reextract`}>
        <button type="submit" disabled={!r.snapshot_key}>
          このスナップショットで再抽出
        </button>
      </form>
    </>
  )
}
