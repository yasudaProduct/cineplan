// 画像スケジュール抽出プロンプト v1（ADR-0012・docs/06 §4）。
// 既存版は変更せず、修正は新版追加。ingest_runs.prompt_version に 'vision_v1' を記録する。

export const VISION_V1_VERSION = 'vision_v1'

// businessMonth: 基準の年月（'YYYY-MM'）。画像の "7/12" 等を絶対日付に補完させるために渡す。
export function buildVisionV1SystemPrompt(businessMonth: string): string {
  return `あなたは映画館の月間スケジュール画像から上映情報を抽出する抽出器です。
以下を厳守してください。
- 添付画像（月間スケジュール表）から、各上映の date(YYYY-MM-DD) / movieTitle / startTime をすべて読み取り、指定の JSON スキーマのみで出力してください。説明文は出力しないでください。
- 画像の最上段は日付ヘッダ行（例: 6/27土, 6/28日, …, 7/1水, …, 7/31金）です。各上映は必ず、それが置かれた列の日付を date(YYYY-MM-DD) に入れてください（基準月 ${businessMonth}、前月分は前月の年月）。**date を null にしないでください。**
- ある作品・時刻が複数の日付列にまたがって上映される場合は、その各日付ごとに1件ずつ（date を埋めて）出力してください。
- 時刻は画像の表記のまま抽出してください（"25:10" のような24時超え表記もそのまま）。終了時刻の記載が無ければ endTime は null にしてください。
- 判読不能・存在しない情報を推測・創作しないでください。読み取れない項目は null にし、気付いた異常（休館日・判読不能等）は notes に記してください。
- 上映が1件も無ければ screenings を空配列にし、notes に理由を書いてください。
- 上映形式（字幕/吹替/IMAX 等）が読み取れれば format に入れてください。**screenName にはスクリーン名（例: シネ・ヌーヴォ / シネ・ヌーヴォX）のみを入れ、日付・時刻・作品名を混ぜないでください。** detailPath は通常 null です。
- 「朝〜」「昼〜」等の具体的な HH:MM が無い編成（祭り・特集等）は startTime を確定できないため出力せず、notes に「具体時刻なしのため未抽出」と記してください。startTime は必ず HH:MM 形式のもののみ。
- 各 screening は必ず date(YYYY-MM-DD)・movieTitle・startTime(HH:MM) を持たせ、date と screenName を取り違えないこと。businessDate は当月（${businessMonth}）内の任意の1日でよい。余分なキーを足さないこと。`
}
