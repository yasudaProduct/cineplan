// アセット import の型（P5-2・OGP 動的画像）。
// .wasm は @cloudflare/vite-plugin が WebAssembly.Module として解決する
// （Workers の ES module ルール互換）。vite/client の型には含まれないため自前宣言。
declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}
