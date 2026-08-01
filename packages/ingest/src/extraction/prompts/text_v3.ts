// HTML（text）スケジュール抽出プロンプト v3 — 日単位分割（docs/spec/06 §4・ADR-0017）。
// v2 からの変更点（既存版 text_v2.ts は変更せず新版追加）:
//  - 発見・日別の両コールに基準日 businessDate（当日）を渡す。
//  - 「ページ先頭に日付見出し無しで並ぶ当日スケジュールブロック」を basisDate の分として
//    扱うよう明示。T・ジョイ梅田(tjoy.jp/KINEZO系)のように、当日分が日付見出し無し
//    （日付はタブの "7/22" のみ）で、先行販売の将来日だけ見出し付きのページで、
//    v2 が当日分を丸ごと取りこぼした事例への対策（2026-07-22 実データで確認・実証）。
// ingest_runs.prompt_version に 'text_v3' を記録する。

export const TEXT_V3_VERSION = 'text_v3'

// businessMonth: 基準の年月（'YYYY-MM'）。ページ内の "7/12(土)" 等を絶対日付に補完させる。
export function buildTextV3SystemPrompt(businessMonth: string): string {
  return `あなたは映画館の上映スケジュールページ（HTML）から情報を抽出する抽出器です。
ユーザーメッセージ末尾の <task> の指示に従い、指定の JSON スキーマのみで出力してください。説明文は出力しないでください。
以下を厳守してください。
- 日付(YYYY-MM-DD)はページの表記（例: 7/12(土)、22(水)）から補完してください（基準月 ${businessMonth}。前月・翌月の表記はその月で）。
- ページ先頭付近に日付見出しが無いまま上映（HH:MM）が並ぶブロックがある場合、それはページが既定で表示している当日分です。ユーザー指示で与える基準日（当日）の上映として扱ってください。
- ページに存在しない情報を補完・創作しないでください。読み取れない項目は null にし、気付いた異常（休館日・判読不能等）は notes に記してください。
- 時刻はページの表記のまま抽出してください（"25:10" のような24時超え表記もそのまま）。終了時刻の記載が無ければ endTime は null にしてください。推測しないでください。
- 広告・公開予定・イベント告知など、上映スケジュール表の外にある作品・日付は含めないでください。
- 上映形式（字幕/吹替/IMAX/4DX 等）が読み取れれば format に、スクリーン名（例: スクリーン1）が読み取れれば screenName に入れてください（日付・時刻・作品名を混ぜない）。
- 作品詳細ページへの <a href=...> があれば、その href の値を detailPath に入れてください（無ければ null）。
- 「朝〜」「昼〜」等の具体的な HH:MM が無い上映は出力せず、notes に「具体時刻なしのため未抽出」と記してください。startTime は必ず HH:MM 形式のもののみ。
- 余分なキーを足さないこと。`
}

// 全呼出共通のプレフィックス（<page> ラッパ）。発見・日別で完全一致させる（キャッシュ親和）。
function pagePrefix(
  scheduleUrl: string,
  businessMonth: string,
  businessDate: string,
  preprocessedHtml: string,
): string {
  return `<page url="${scheduleUrl}" businessMonth="${businessMonth}" businessDate="${businessDate}">\n${preprocessedHtml}\n</page>`
}

// 日付発見コール（responseFormat='dateList' → ExtractedDateList）
export function buildTextV3UserTextForDates(
  scheduleUrl: string,
  businessMonth: string,
  businessDate: string,
  preprocessedHtml: string,
): string {
  return `${pagePrefix(scheduleUrl, businessMonth, businessDate, preprocessedHtml)}
<task>このページに上映スケジュール（具体的な上映時刻）が掲載されている営業日付を、すべて YYYY-MM-DD で dates に列挙してください。
- 日付タブや見出しの表記（例: 7/22、22(水)、7/24（金））は基準月 ${businessMonth} で YYYY-MM-DD に補完してください。
- ページ先頭に日付見出し無しで上映が並ぶ当日ブロックがある場合、その日付は基準日 ${businessDate} です。上映があれば必ず ${businessDate} を含めてください。
- 上映時刻の掲載が無い日付・ナビゲーションのみで中身の無い日付・公開予定作品の公開日は含めないでください。
- 1件も無ければ dates を空配列にし、notes に理由を書いてください。</task>`
}

// 日別抽出コール（responseFormat='extraction' → ExtractionResult）。date: 対象日 'YYYY-MM-DD'
export function buildTextV3UserTextForDay(
  scheduleUrl: string,
  businessMonth: string,
  businessDate: string,
  preprocessedHtml: string,
  date: string,
): string {
  return `${pagePrefix(scheduleUrl, businessMonth, businessDate, preprocessedHtml)}
<task>対象日 ${date} の上映情報のみをすべて抽出してください。businessDate は ${date} にしてください。
- ページ内で ${date}（${date} の月日表記を含む）の見出しの配下にある上映を対象にしてください。
- ${date} が当日（基準日 ${businessDate}）と同じ場合、ページ先頭にある日付見出しの無い当日スケジュールブロックの上映も ${date} のものとして抽出してください。
- 他の日付の見出しの配下にある上映は出力しないでください。
- 対象日の上映が1件も無ければ screenings を空配列にし、notes に理由を書いてください。</task>`
}
