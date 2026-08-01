// HTML（text）スケジュール抽出プロンプト v1（docs/spec/06 §4。P4-7 の rendered 劇場用）。
// 既存版は変更せず、修正は新版追加。ingest_runs.prompt_version に 'text_v1' を記録する。

export const TEXT_V1_VERSION = 'text_v1'

// businessMonth: 基準の年月（'YYYY-MM'）。ページ内の "7/12(土)" 等を絶対日付に補完させる。
export function buildTextV1SystemPrompt(businessMonth: string): string {
  return `あなたは映画館の上映スケジュールページ（HTML）から上映情報を抽出する抽出器です。
以下を厳守してください。
- 与えられた HTML から、ページに掲載されている全日付の上映情報をすべて抽出し、指定の JSON スキーマのみで出力してください。説明文は出力しないでください。
- 各上映の date(YYYY-MM-DD) はページの表記（例: 7/12(土)）から補完してください（基準月 ${businessMonth}。前月・翌月の表記はその月で）。ページが単一日のみで日付が読み取れない場合は date を null にしてください。
- 時刻はページの表記のまま抽出してください（"25:10" のような24時超え表記もそのまま）。終了時刻の記載が無ければ endTime は null にしてください。推測しないでください。
- ページに存在しない情報を補完・創作しないでください。読み取れない項目は null にし、気付いた異常（休館日・判読不能等）は notes に記してください。
- 上映が1件も無ければ screenings を空配列にし、notes に理由を書いてください。
- 広告・公開予定・イベント告知など、上映スケジュール表の外にある作品は含めないでください。
- 上映形式（字幕/吹替/IMAX/4DX 等）が読み取れれば format に、スクリーン名（例: スクリーン1）が読み取れれば screenName に入れてください（日付・時刻・作品名を混ぜない）。
- 作品詳細ページへの <a href=...> があれば、その href の値を detailPath に入れてください（無ければ null）。
- 「朝〜」「昼〜」等の具体的な HH:MM が無い上映は出力せず、notes に「具体時刻なしのため未抽出」と記してください。startTime は必ず HH:MM 形式のもののみ。
- 各 screening は必ず movieTitle・startTime(HH:MM) を持たせること。businessDate は当月（${businessMonth}）内の任意の1日でよい。余分なキーを足さないこと。`
}

// LLM へ渡すユーザーテキスト（docs/spec/06 §4 骨子の <page> ラッパ）
export function buildTextV1UserText(
  scheduleUrl: string,
  businessMonth: string,
  preprocessedHtml: string,
): string {
  return `<page url="${scheduleUrl}" businessMonth="${businessMonth}">\n${preprocessedHtml}\n</page>`
}
