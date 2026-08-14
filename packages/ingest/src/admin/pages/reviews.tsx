import { ExtractionResult } from '@cinema/shared'
import type { ReviewDetail, ReviewListItem } from '../../db/reviews'
import { Flash, jst, StatusChip } from '../components'

// レビューキュー（docs/spec/07 §2.5）。左に抽出結果・右にスナップショット画像で突合し、
// 承認（通常書込パスで反映）/ 破棄（メモ必須）/ プロンプト再実行。

export function ReviewListPage(props: {
  reviews: ReviewListItem[]
  filter: 'pending' | 'all'
  msg?: string
  err?: string
}) {
  return (
    <>
      <h1>レビューキュー</h1>
      <Flash msg={props.msg} err={props.err} />
      <div class="actions">
        <a href="/admin/reviews">{props.filter === 'pending' ? <b>pending</b> : 'pending'}</a>
        <a href="/admin/reviews?status=all">{props.filter === 'all' ? <b>すべて</b> : 'すべて'}</a>
      </div>
      {props.reviews.length === 0 ? (
        <p class="small">対象はありません。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>作成(JST)</th>
              <th>劇場</th>
              <th>reason</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody>
            {props.reviews.map((v) => (
              <tr>
                <td>
                  <a href={`/admin/reviews/${v.id}`}>{jst(v.created_at)}</a>
                </td>
                <td>{v.theater_name}</td>
                <td>
                  <span class="chip warn">{v.reason.split(':')[0]}</span>{' '}
                  <span class="small">{v.reason.slice(0, 80)}</span>
                </td>
                <td>
                  <StatusChip status={v.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function PayloadTable({ payloadJson }: { payloadJson: string }) {
  let parsed: ExtractionResult | null = null
  try {
    parsed = ExtractionResult.parse(JSON.parse(payloadJson))
  } catch {
    parsed = null
  }
  if (!parsed) {
    return (
      <>
        <p class="small warn-text">payload が ExtractionResult として解釈できません（raw 表示）:</p>
        <pre style="overflow-x:auto; background:#fff; border:1px solid #ddd; padding:8px">
          {payloadJson}
        </pre>
      </>
    )
  }
  return (
    <>
      <p class="small">
        businessDate: <code>{parsed.businessDate}</code> / {parsed.screenings.length} 件 / notes:{' '}
        {parsed.notes ?? '—'}
      </p>
      <table>
        <thead>
          <tr>
            <th>date</th>
            <th>title</th>
            <th>start</th>
            <th>end</th>
            <th>screen</th>
            <th>format</th>
          </tr>
        </thead>
        <tbody>
          {parsed.screenings.map((s) => (
            <tr>
              <td>{s.date ?? '—'}</td>
              <td>{s.movieTitle}</td>
              <td>{s.startTime}</td>
              <td>{s.endTime ?? '—'}</td>
              <td>{s.screenName ?? '—'}</td>
              <td>{s.format ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function ReviewDetailPage(props: {
  review: ReviewDetail
  imageKeys: string[]
  msg?: string
  err?: string
}) {
  const v = props.review
  const pending = v.status === 'pending'
  return (
    <>
      <h1>
        レビュー詳細 <StatusChip status={v.status} />
      </h1>
      <Flash msg={props.msg} err={props.err} />
      <p>
        {v.theater_name} / 取込日 {v.business_date} / reason:{' '}
        <span class="chip warn">{v.reason}</span> /{' '}
        <a href={`/admin/runs/${v.ingest_run_id}`}>run 詳細 →</a>
      </p>
      {v.review_note && (
        <p class="small">
          メモ: <b>{v.review_note}</b>（{jst(v.reviewed_at)}）
        </p>
      )}

      <div class="grid2">
        <section>
          <h2>抽出結果（payload）</h2>
          <PayloadTable payloadJson={v.payload_json} />
        </section>
        <section>
          <h2>スナップショット（突合用）</h2>
          {props.imageKeys.length === 0 ? (
            <p class="small">画像スナップショットはありません。</p>
          ) : (
            props.imageKeys.map((k) => (
              <p>
                <img class="snapshot-img" src={`/admin/r2/${k}`} alt={k} />
                <br />
                <a href={`/admin/r2/${k}`} target="_blank" rel="noopener noreferrer" class="small">
                  {k} ↗
                </a>
              </p>
            ))
          )}
        </section>
      </div>

      {pending && (
        <>
          <h2>判定</h2>
          <div class="grid2">
            <form method="post" action={`/admin/reviews/${v.id}/approve`}>
              <label for="approve-note">メモ（任意）</label>
              <input
                id="approve-note"
                type="text"
                name="note"
                placeholder="例: 件数減は正当（休映週）"
              />
              <div class="actions">
                <button type="submit">承認して反映（通常書込パス）</button>
              </div>
            </form>
            <form method="post" action={`/admin/reviews/${v.id}/reject`}>
              <label for="reject-note">破棄理由（必須。docs/spec/07 §2.5）</label>
              <input
                id="reject-note"
                type="text"
                name="note"
                required
                placeholder="例: 別月の抽出が混入している"
              />
              <div class="actions">
                <button type="submit" class="danger">
                  破棄する
                </button>
              </div>
            </form>
          </div>
          <h2>プロンプト再実行</h2>
          <p class="small">
            最新プロンプトで R2 スナップショットから再抽出する（先方再取得なし・新しい run
            として記録）。
          </p>
          <form method="post" action={`/admin/runs/${v.ingest_run_id}/reextract`}>
            <button type="submit" class="secondary">
              再抽出を実行
            </button>
          </form>
        </>
      )}
    </>
  )
}
