// .ics 生成（F-11）。結果画面はクライアント生成（docs/04 設計メモ3）。
// 実体は P5-1 で @cinema/shared へ移動（GET /v1/plans/{id}/ics のサーバ生成と共通化）。
export { buildIcs, icsFilename } from '@cinema/shared'
